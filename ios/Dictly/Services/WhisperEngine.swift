import Foundation
import AVFoundation
import WhisperKit

/// Shared base for chunked utterance transcription engines (Whisper local / GPT API).
/// Energy-RMS VAD mirrors the desktop STT sidecar: an utterance closes after
/// `silenceCloseSec` of silence (configurable in 설정), capped at `maxSegSec`,
/// with a 0.3 s pre-roll so onsets aren't clipped.
class UtteranceVADEngine: DictationEngine, @unchecked Sendable {
    /// volatile-channel status markers the recording UI renders as indicators
    static let listeningMarker = "듣는 중…"
    static let transcribingMarker = "전사 중…"

    static let sampleRate: Double = 16000
    private static let minSegSec: Double = 0.4
    private static let prerollSec: Double = 0.5
    /// adaptive noise floor — tracks ambient level so quiet speech still triggers
    private var noiseFloor: Float = 0.002

    let silenceCloseSec: Double
    let maxSegSec: Double

    private var converter: AVAudioConverter?
    private let targetFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!

    // VAD state (audio tap thread only)
    private var preroll: [Float] = []
    private var utterance: [Float] = []
    private var inUtterance = false
    private var silentSec: Double = 0
    fileprivate var finished = false

    // serial transcription queue
    private var queueContinuation: AsyncStream<[Float]>.Continuation?
    private var transcribeTask: Task<Void, Never>?
    private var pendingCount = 0
    private let lock = NSLock()

    let onVolatile: @MainActor @Sendable (String) -> Void
    let onFinal: @MainActor @Sendable (String) -> Void
    let onError: @MainActor @Sendable (String) -> Void

    init(silence: Double, maxSeg: Double,
         onVolatile: @escaping @MainActor @Sendable (String) -> Void,
         onFinal: @escaping @MainActor @Sendable (String) -> Void,
         onError: @escaping @MainActor @Sendable (String) -> Void) {
        self.silenceCloseSec = max(0.5, silence)
        self.maxSegSec = max(5, maxSeg)
        self.onVolatile = onVolatile
        self.onFinal = onFinal
        self.onError = onError
    }

    // MARK: subclass points

    func prepare(locale: Locale,
                 progress: @escaping @MainActor @Sendable (Double) -> Void,
                 status: @escaping @MainActor @Sendable (String) -> Void) async throws {
        fatalError("subclass must override prepare")
    }

    /// transcribe one closed utterance; return nil/empty to skip
    func transcribeUtterance(_ samples: [Float]) async throws -> String {
        fatalError("subclass must override transcribeUtterance")
    }

    /// call at the end of prepare() to start consuming closed utterances
    func startQueue() {
        let (stream, cont) = AsyncStream<[Float]>.makeStream()
        queueContinuation = cont
        transcribeTask = Task { [weak self] in
            for await samples in stream {
                await self?.handleUtterance(samples)
            }
        }
    }

    private func handleUtterance(_ samples: [Float]) async {
        do {
            let text = try await transcribeUtterance(samples)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            lock.lock(); pendingCount -= 1; let backlog = pendingCount; lock.unlock()
            if !text.isEmpty {
                await onFinal(text)
            }
            if backlog == 0, !finished {
                // queue drained — back to listening so the indicator never disappears
                await onVolatile(Self.listeningMarker)
            }
        } catch {
            lock.lock(); pendingCount -= 1; lock.unlock()
            if !finished {
                await onError(error.localizedDescription)
            }
        }
    }

    // MARK: audio feed + VAD

    func feed(_ buffer: AVAudioPCMBuffer) {
        guard !finished else { return }
        guard let samples = convertTo16k(buffer), !samples.isEmpty else { return }

        let dur = Double(samples.count) / Self.sampleRate
        var sum: Float = 0
        for s in samples { sum += s * s }
        let rms = sqrtf(sum / Float(samples.count))

        // speech starts above ~2.5× ambient floor; ends below a slightly lower bar
        let speechThresh = max(0.0035, noiseFloor * 2.5)
        let silenceThresh = speechThresh * 0.8

        if !inUtterance {
            // track ambient level only while idle
            noiseFloor = min(0.01, max(0.0015, noiseFloor * 0.97 + rms * 0.03))
            preroll.append(contentsOf: samples)
            let maxPre = Int(Self.prerollSec * Self.sampleRate)
            if preroll.count > maxPre { preroll.removeFirst(preroll.count - maxPre) }
            if rms >= speechThresh {
                inUtterance = true
                silentSec = 0
                utterance = preroll
                preroll = []
                Task { @MainActor in self.onVolatile(Self.listeningMarker) }
            }
            return
        }

        utterance.append(contentsOf: samples)
        silentSec = rms < silenceThresh ? silentSec + dur : 0
        let utterDur = Double(utterance.count) / Self.sampleRate

        if silentSec >= silenceCloseSec || utterDur >= maxSegSec {
            closeUtterance()
        }
    }

    private func closeUtterance() {
        let utterDur = Double(utterance.count) / Self.sampleRate
        let samples = utterance
        utterance = []
        inUtterance = false
        silentSec = 0
        guard utterDur >= Self.minSegSec else { return }
        lock.lock(); pendingCount += 1; lock.unlock()
        queueContinuation?.yield(samples)
        // surface the working state so a slow model doesn't look like a dropout
        Task { @MainActor in self.onVolatile(Self.transcribingMarker) }
    }

    private func convertTo16k(_ buffer: AVAudioPCMBuffer) -> [Float]? {
        if buffer.format.sampleRate == Self.sampleRate, buffer.format.channelCount == 1,
           let data = buffer.floatChannelData?[0] {
            return Array(UnsafeBufferPointer(start: data, count: Int(buffer.frameLength)))
        }
        if converter == nil || converter?.inputFormat != buffer.format {
            converter = AVAudioConverter(from: buffer.format, to: targetFormat)
        }
        guard let conv = converter else { return nil }
        let ratio = Self.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 64
        guard let out = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else { return nil }
        var fed = false
        var err: NSError?
        conv.convert(to: out, error: &err) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true
            status.pointee = .haveData
            return buffer
        }
        guard err == nil, out.frameLength > 0, let data = out.floatChannelData?[0] else { return nil }
        return Array(UnsafeBufferPointer(start: data, count: Int(out.frameLength)))
    }

    func finish() async {
        if inUtterance {
            closeUtterance()
        }
        finished = true
        queueContinuation?.finish()
        let deadline = Date().addingTimeInterval(180)
        while Date() < deadline {
            lock.lock(); let backlog = pendingCount; lock.unlock()
            if backlog <= 0 { break }
            try? await Task.sleep(for: .milliseconds(200))
        }
        transcribeTask?.cancel()
        converter = nil
        cleanup()
    }

    /// subclass teardown hook
    func cleanup() {}
}

// MARK: - Whisper local (WhisperKit / CoreML)

final class WhisperEngine: UtteranceVADEngine {
    private var whisper: WhisperKit?
    private var language = "ko"
    private let modelName: String

    init(model: String, silence: Double, maxSeg: Double,
         onVolatile: @escaping @MainActor @Sendable (String) -> Void,
         onFinal: @escaping @MainActor @Sendable (String) -> Void,
         onError: @escaping @MainActor @Sendable (String) -> Void) {
        self.modelName = model
        super.init(silence: silence, maxSeg: maxSeg, onVolatile: onVolatile, onFinal: onFinal, onError: onError)
    }

    override func prepare(locale: Locale,
                          progress: @escaping @MainActor @Sendable (Double) -> Void,
                          status: @escaping @MainActor @Sendable (String) -> Void) async throws {
        language = locale.language.languageCode?.identifier ?? "ko"

        // mirror the preloader's phase into the preparing UI while we wait
        let mirror = Task { @MainActor in
            while !Task.isCancelled {
                switch WhisperPreloader.shared.phase {
                case .downloading(let pct):
                    progress(Double(pct) / 100)
                    status("Whisper 모델 다운로드 중…")
                case .loading:
                    progress(1.0)
                    status("모델 불러오는 중…")
                case .optimizing:
                    progress(1.0)
                    status("모델 최적화 중\n최초 1회는 몇 분 걸릴 수 있어요")
                case .ready:
                    status("전사 엔진 시작 중…")
                default:
                    break
                }
                try? await Task.sleep(for: .milliseconds(250))
            }
        }
        defer { mirror.cancel() }

        whisper = try await WhisperPreloader.shared.ensureLoaded(model: modelName)
        startQueue()
    }

    override func transcribeUtterance(_ samples: [Float]) async throws -> String {
        guard let whisper else { return "" }
        let options = DecodingOptions(
            task: .transcribe,
            language: language,
            temperature: 0,
            skipSpecialTokens: true
        )
        let results = try await whisper.transcribe(audioArray: samples, decodeOptions: options)
        return results.map(\.text).joined(separator: " ")
    }

    override func cleanup() {
        // the WhisperKit instance stays resident in WhisperPreloader for instant restarts
        whisper = nil
    }

    // MARK: model catalog helpers (설정/패널)

    /// curated variants — in preference order. 기본 모델·피커·온보딩이 전부 이 목록 하나를 쓴다.
    /// 전부 argmax 기기 지원표에서 아이폰 지원이 확인된 변형만 (비압축 풀 터보 1.5GB 는 아이폰 미지원)
    static let curatedModels = [
        "openai_whisper-large-v3-v20240930_626MB",      // Turbo — 기본, 다국어
        "openai_whisper-large-v3_turbo_954MB",          // Turbo+ — 더 크지만 더 정확
        "distil-whisper_distil-large-v3_turbo_600MB",   // English — 영어 특화
        "openai_whisper-small"                          // Small — 가볍고 빠름
    ]

    /// 명시적 기본 모델. WhisperKit.recommendedModels() 의 내장 기기표는 iPhone 16 세대까지만
    /// 알아서 그 이후 기기(iPhone18,*)를 base 로 조용히 강등시키므로 쓰지 않는다
    static let defaultModel = curatedModels[0]

    /// Whisper Live (beta) — 실시간 스트리밍 파이프라인(Lightning)을 가리키는 모델 항목.
    /// 실제 Whisper 변형 폴더가 아니라 전용 엔진으로 라우팅되는 센티널 값이다
    static let liveModel = "whisper-live-beta"
    static func isLive(_ model: String) -> Bool { model == liveModel }

    /// 실제 다운로드 용량(MB) — HF 저장소 파일 합계(2026-08 측정). App Review 4.2.3(ii):
    /// 추가 리소스를 받기 전에 크기를 고지하고 사용자가 선택하게 해야 한다
    static let downloadSizeMB: [String: Int] = [
        "openai_whisper-large-v3-v20240930_626MB": 627,
        "openai_whisper-large-v3_turbo_954MB": 1053,
        "distil-whisper_distil-large-v3_turbo_600MB": 607,
        "openai_whisper-small": 486
    ]

    static func downloadSizeMB(_ model: String) -> Int {
        if let known = downloadSizeMB[model] { return known }
        // 이름 끝의 _NNNMB 힌트 → 그마저 없으면 보수적으로 1GB 로 고지
        if let r = model.range(of: #"_(\d+)MB$"#, options: .regularExpression),
           let mb = Int(model[r].dropFirst().dropLast(2)) { return mb }
        return 1000
    }

    /// 메뉴·목록 표시 순서 — Live > Turbo+ > Turbo > Small > English > 기타
    static func displayRank(_ model: String) -> Int {
        if isLive(model) { return 0 }
        switch displayName(model) {
        case "Turbo+": return 1
        case "Turbo": return 2
        case "Small": return 3
        case "English": return 4
        default: return 5
        }
    }

    static func sortedForDisplay(_ models: [String]) -> [String] {
        models.sorted { displayRank($0) < displayRank($1) }
    }

    static func sizeLabel(_ mb: Int) -> String {
        mb >= 1000 ? String(format: "약 %.1fGB", Double(mb) / 1000) : "약 \(mb)MB"
    }

    /// 피커용 — 아직 안 받은 모델은 용량을 함께 보여 선택 전에 크기를 알 수 있게 한다
    /// 다운로드 랜딩에서 보여줄 한 줄 설명
    static func modelDescription(_ model: String) -> String {
        if isLive(model) { return "말하는 순간 글자가 따라오는 실시간 전사" }
        if model.contains("distil") { return "영어 강의 특화 · 빠르고 정확" }
        if model.contains("small") { return "가볍고 빠른 보조 모델" }
        if model.contains("954MB") { return "가장 정확한 모델 · 다국어" }
        return "균형 잡힌 기본 모델 · 다국어"
    }

    static func pickerLabel(_ model: String) -> String {
        if isLive(model) {
            let missing = LightningPreloader.missingDownloads.reduce(0) { $0 + $1.mb }
            return missing > 0 ? "Whisper Live (beta) · \(sizeLabel(missing))" : "Whisper Live (beta)"
        }
        let name = displayName(model)
        return WhisperPreloader.isDownloaded(model) ? name : "\(name) · \(sizeLabel(downloadSizeMB(model)))"
    }

    @MainActor private static var sessionModels: [String]?
    @MainActor private static var refreshTask: Task<[String], Never>?

    /// HF 저장소와 대조한 큐레이션 목록 — 네트워크는 세션당 최초 1회만, 실패 시 정적 목록 폴백
    @MainActor
    static func availableModels() async -> [String] {
        if let sessionModels { return sessionModels }
        if let refreshTask { return await refreshTask.value }
        let task = Task<[String], Never> {
            let all = (try? await WhisperKit.fetchAvailableModels()) ?? []
            let curated = curatedModels.filter { all.contains($0) }
            return curated.isEmpty ? curatedModels : curated
        }
        refreshTask = task
        let result = await task.value
        sessionModels = result
        return result
    }

    /// 심플한 영어 표시명 — 패널에서 "Whisper · Turbo" 처럼 두 토막으로 읽히게 한 단어로 유지
    static func displayName(_ model: String) -> String {
        if isLive(model) { return "Live (beta)" }
        if model.isEmpty { return "자동" }
        if model.contains("distil") { return "English" }
        if model.contains("small") { return "Small" }
        if model.contains("954MB") || model.contains("947MB") { return "Turbo+" }
        if model.contains("turbo") || model.contains("v20240930") { return "Turbo" }
        if model.contains("base") { return "Base" }
        return model.replacingOccurrences(of: "openai_whisper-", with: "")
    }

    static func downloadedModels() -> [String] {
        let base = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("huggingface/models/argmaxinc/whisperkit-coreml")
        let items = (try? FileManager.default.contentsOfDirectory(atPath: base.path)) ?? []
        return items.filter { !$0.hasPrefix(".") }
    }
}
