import Foundation
import AVFoundation
import Speech

enum TranscribeError: LocalizedError {
    case unsupportedLocale
    case notAuthorized
    case noAnalyzerFormat
    case engineFailed(String)

    var errorDescription: String? {
        switch self {
        case .unsupportedLocale: "이 언어는 이 기기의 온디바이스 전사에서 지원되지 않습니다."
        case .notAuthorized: "음성 인식 권한이 필요합니다. 설정 앱에서 허용해 주세요."
        case .noAnalyzerFormat: "전사 엔진 오디오 형식을 초기화하지 못했습니다."
        case .engineFailed(let m): "전사 엔진 오류: \(m)"
        }
    }
}

/// A live speech-to-text engine fed with microphone buffers.
protocol DictationEngine: AnyObject, Sendable {
    /// download/prepare models; `progress` reports model download 0…1,
    /// `status` reports the current preparation step — both on the main actor
    func prepare(locale: Locale,
                 progress: @escaping @MainActor @Sendable (Double) -> Void,
                 status: @escaping @MainActor @Sendable (String) -> Void) async throws
    func feed(_ buffer: AVAudioPCMBuffer)
    /// flush and stop; safe to call once
    func finish() async
}

// MARK: - iOS 26 SpeechAnalyzer / SpeechTranscriber (fully on-device)

final class SpeechAnalyzerEngine: DictationEngine, @unchecked Sendable {
    private var analyzer: SpeechAnalyzer?
    private var transcriber: SpeechTranscriber?
    private var inputContinuation: AsyncStream<AnalyzerInput>.Continuation?
    private var analyzerFormat: AVAudioFormat?
    private var converter: AVAudioConverter?
    private var resultsTask: Task<Void, Never>?

    /// volatile (in-progress) hypothesis for the current utterance
    let onVolatile: @MainActor @Sendable (String) -> Void
    /// finalized utterance text
    let onFinal: @MainActor @Sendable (String) -> Void
    let onError: @MainActor @Sendable (String) -> Void

    init(onVolatile: @escaping @MainActor @Sendable (String) -> Void,
         onFinal: @escaping @MainActor @Sendable (String) -> Void,
         onError: @escaping @MainActor @Sendable (String) -> Void) {
        self.onVolatile = onVolatile
        self.onFinal = onFinal
        self.onError = onError
    }

    static func supportedLocales() async -> [Locale] {
        await SpeechTranscriber.supportedLocales
    }

    static func supports(locale: Locale) async -> Bool {
        let sup = await SpeechTranscriber.supportedLocales
        let target = locale.identifier(.bcp47)
        return sup.contains { $0.identifier(.bcp47) == target }
    }

    static func isInstalled(locale: Locale) async -> Bool {
        let installed = await SpeechTranscriber.installedLocales
        let target = locale.identifier(.bcp47)
        return installed.contains { $0.identifier(.bcp47) == target }
    }

    func prepare(locale: Locale,
                 progress: @escaping @MainActor @Sendable (Double) -> Void,
                 status: @escaping @MainActor @Sendable (String) -> Void) async throws {
        await MainActor.run { status("전사 언어 확인 중…") }
        guard await Self.supports(locale: locale) else { throw TranscribeError.unsupportedLocale }

        let t = SpeechTranscriber(
            locale: locale,
            transcriptionOptions: [],
            reportingOptions: [.volatileResults],
            attributeOptions: []
        )
        transcriber = t

        // download the on-device model if this locale isn't installed yet
        if await !Self.isInstalled(locale: locale) {
            await MainActor.run { status("언어 모델 다운로드 중…") }
            if let request = try await AssetInventory.assetInstallationRequest(supporting: [t]) {
                let p = request.progress
                let poll = Task { @MainActor in
                    while !Task.isCancelled {
                        progress(p.fractionCompleted)
                        try? await Task.sleep(for: .milliseconds(300))
                    }
                }
                defer { poll.cancel() }
                try await request.downloadAndInstall()
            }
        }
        await MainActor.run {
            progress(1.0)
            status("전사 엔진 시작 중…")
        }

        let a = SpeechAnalyzer(modules: [t])
        analyzer = a
        analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [t])
        guard analyzerFormat != nil else { throw TranscribeError.noAnalyzerFormat }

        let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream()
        inputContinuation = continuation

        resultsTask = Task { [weak self] in
            guard let t = self?.transcriber else { return }
            do {
                for try await result in t.results {
                    let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !text.isEmpty else { continue }
                    if result.isFinal {
                        await self?.onFinal(text)
                    } else {
                        await self?.onVolatile(text)
                    }
                }
            } catch {
                if !Task.isCancelled {
                    await self?.onError(error.localizedDescription)
                }
            }
        }

        try await a.start(inputSequence: stream)
    }

    func feed(_ buffer: AVAudioPCMBuffer) {
        guard let fmt = analyzerFormat, let continuation = inputContinuation else { return }
        if buffer.format == fmt {
            continuation.yield(AnalyzerInput(buffer: buffer))
            return
        }
        if converter == nil || converter?.inputFormat != buffer.format {
            converter = AVAudioConverter(from: buffer.format, to: fmt)
        }
        guard let conv = converter else { return }
        let ratio = fmt.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 64
        guard let out = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: capacity) else { return }
        var fed = false
        var err: NSError?
        conv.convert(to: out, error: &err) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true
            status.pointee = .haveData
            return buffer
        }
        if err == nil, out.frameLength > 0 {
            continuation.yield(AnalyzerInput(buffer: out))
        }
    }

    func finish() async {
        inputContinuation?.finish()
        inputContinuation = nil
        try? await analyzer?.finalizeAndFinishThroughEndOfInput()
        resultsTask?.cancel()
        resultsTask = nil
        analyzer = nil
        transcriber = nil
        converter = nil
    }
}

// MARK: - SFSpeechRecognizer fallback (locales SpeechTranscriber doesn't cover)

final class LegacyRecognizerEngine: NSObject, DictationEngine, @unchecked Sendable {
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var lastPartial = ""
    private var lastPartialAt = Date()
    private var watchdog: Task<Void, Never>?
    private var finished = false

    let onVolatile: @MainActor @Sendable (String) -> Void
    let onFinal: @MainActor @Sendable (String) -> Void
    let onError: @MainActor @Sendable (String) -> Void

    init(onVolatile: @escaping @MainActor @Sendable (String) -> Void,
         onFinal: @escaping @MainActor @Sendable (String) -> Void,
         onError: @escaping @MainActor @Sendable (String) -> Void) {
        self.onVolatile = onVolatile
        self.onFinal = onFinal
        self.onError = onError
    }

    func prepare(locale: Locale,
                 progress: @escaping @MainActor @Sendable (Double) -> Void,
                 status: @escaping @MainActor @Sendable (String) -> Void) async throws {
        await MainActor.run { status("음성 인식 권한 확인 중…") }
        let auth = await withCheckedContinuation { cont in
            SFSpeechRecognizer.requestAuthorization { cont.resume(returning: $0) }
        }
        guard auth == .authorized else { throw TranscribeError.notAuthorized }
        guard let rec = SFSpeechRecognizer(locale: locale), rec.isAvailable else {
            throw TranscribeError.unsupportedLocale
        }
        recognizer = rec
        await MainActor.run { progress(1.0) }
        startSegmentTask()

        // finalize an utterance after ~1.4 s of hypothesis stability (mimics the desktop VAD close)
        watchdog = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(500))
                guard let self, !self.finished else { return }
                if !self.lastPartial.isEmpty, Date().timeIntervalSince(self.lastPartialAt) > 1.4 {
                    self.rotateSegment()
                }
            }
        }
    }

    private func startSegmentTask() {
        guard let rec = recognizer else { return }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if rec.supportsOnDeviceRecognition {
            req.requiresOnDeviceRecognition = true
        }
        request = req
        lastPartial = ""
        task = rec.recognitionTask(with: req) { [weak self] result, error in
            guard let self, !self.finished else { return }
            if let result {
                let text = result.bestTranscription.formattedString
                if result.isFinal {
                    self.lastPartial = ""
                    if !text.isEmpty {
                        Task { @MainActor in self.onFinal(text) }
                    }
                } else {
                    self.lastPartial = text
                    self.lastPartialAt = Date()
                    Task { @MainActor in self.onVolatile(text) }
                }
            }
            if error != nil, !self.finished {
                // session hiccup — restart the segment task and keep going
                self.lastPartial = ""
                self.startSegmentTask()
            }
        }
    }

    /// close the current utterance and open the next one
    private func rotateSegment() {
        request?.endAudio()
    }

    func feed(_ buffer: AVAudioPCMBuffer) {
        request?.append(buffer)
    }

    func finish() async {
        finished = true
        watchdog?.cancel()
        request?.endAudio()
        // give the recognizer a moment to emit the trailing final
        try? await Task.sleep(for: .milliseconds(900))
        task?.cancel()
        task = nil
        request = nil
        recognizer = nil
    }
}
