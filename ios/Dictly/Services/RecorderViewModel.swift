import Foundation
import AVFoundation
import Observation

/// one live transcript chunk shown while recording
struct LiveSegment: Identifiable, Hashable {
    let id = UUID()
    var tStart: Double
    var tEnd: Double
    var text: String
    var origText: String?          // set when live correction changed the text
    var corrSpans: [CorrSpan]?     // 적극 교정(지식/추론) 구간 — 파란 표시
    var correcting = false
    var userEdited = false
}

/// finished-recording payload handed to the save sheet
struct RecordingDraft: Identifiable {
    let id = UUID()
    var segments: [MemoSegment]
    var durationSec: Double
    var audioFileName: String
    var language: String
    var suggestedTitle: String
}

/// Orchestrates mic capture → live transcription → live correction, mirroring the
/// desktop recorderController: corrections run FOLLOW_DELAY=2 chunks behind the
/// transcript head with bounded concurrency, seeing 6 chunks of leading and 2 of
/// trailing context.
@MainActor
@Observable
final class RecorderViewModel {
    enum Phase: Equatable {
        case idle
        case preparing(String)      // status line (권한/모델 다운로드…)
        case recording
        case paused
        case stopping(String)
        case error(String)
    }

    private static let followDelay = 2
    private static let maxConcurrentCorrections = 3

    let settings: AppSettings
    let ai: AIService

    private(set) var phase: Phase = .idle
    private(set) var segments: [LiveSegment] = []
    private(set) var volatileText = ""
    private(set) var elapsed: Double = 0
    private(set) var level: Float = 0
    private(set) var downloadProgress: Double?
    /// which engine label to show in the UI
    private(set) var engineLabel = ""
    /// extra note (예: 실시간 연결 실패로 폴백된 이유)
    private(set) var engineNote = ""
    var draft: RecordingDraft?

    private var recorder: AudioRecorder?
    private var engine: (any DictationEngine)?
    private var ticker: Task<Void, Never>?
    private var audioURL: URL?
    private var queuedCorrections: Set<Int> = []
    private var activeCorrections = 0
    private var correctionBacklog: [Int] = []

    /// 5청크 이상 쌓이면 녹음 중에 미리 만들어 두는 제목 (저장할 때 기다리지 않도록)
    private(set) var liveTitle = ""
    private var titleTask: Task<Void, Never>?
    /// Live Activity 표시에 쓰는 폴더 이름
    private var folderLabel = ""
    private var startedAt = Date.now
    /// Live Activity 파형에 실어 보내는 최근 입력 레벨.
    /// ContentState 페이로드는 작게 유지해야 한다 (크면 갱신이 거부될 수 있다)
    private static let levelWindow = 42
    private var levelHistory: [Float] = []

    var isBusy: Bool {
        switch phase {
        case .recording, .paused, .preparing, .stopping: true
        default: false
        }
    }

    init(settings: AppSettings, ai: AIService) {
        self.settings = settings
        self.ai = ai
    }

    // MARK: - lifecycle

    func start(folderName: String = "") async {
        guard case .idle = phase else { return }
        segments = []
        volatileText = ""
        elapsed = 0
        draft = nil
        liveTitle = ""
        titleTask?.cancel()
        titleTask = nil
        folderLabel = folderName
        levelHistory = []
        queuedCorrections = []
        correctionBacklog = []
        activeCorrections = 0
        downloadProgress = nil

        phase = .preparing("마이크 권한 확인 중…")
        guard await AudioRecorder.requestMicPermission() else {
            phase = .error("마이크 권한이 거부되었습니다. 설정 앱에서 허용해 주세요.")
            return
        }

        let locale = settings.transcribeLocale
        let onVolatile: @MainActor @Sendable (String) -> Void = { [weak self] text in
            self?.volatileText = text
            // 확정 전 미리보기도 Live Activity 에 흘려보낸다 (스로틀은 컨트롤러가 처리)
            self?.syncActivity()
        }
        let onFinal: @MainActor @Sendable (String) -> Void = { [weak self] text in
            self?.appendFinal(text)
        }
        let onErr: @MainActor @Sendable (String) -> Void = { [weak self] message in
            guard let self, self.phase == .recording || self.phase == .paused else { return }
            self.volatileText = "⚠️ \(message)"
        }

        do {
            try AudioRecorder.activateSession()
            phase = .preparing("전사 모델 준비 중…")
            let engine: any DictationEngine
            switch settings.sttEngine {
            case .whisper where WhisperEngine.isLive(settings.whisperModel):
                engine = LightningEngine(silence: settings.vadSilenceSec,
                                         onVolatile: onVolatile, onFinal: onFinal, onError: onErr)
                engineLabel = "Whisper Live"
            case .whisper:
                engine = WhisperEngine(model: settings.whisperModel,
                                       silence: settings.vadSilenceSec, maxSeg: settings.vadMaxSec,
                                       onVolatile: onVolatile, onFinal: onFinal, onError: onErr)
                engineLabel = "Whisper 로컬"
            case .gptAPI:
                engine = OpenAITranscribeEngine(key: KeychainStore.get("openai") ?? "",
                                                silence: settings.vadSilenceSec, maxSeg: settings.vadMaxSec,
                                                onVolatile: onVolatile, onFinal: onFinal, onError: onErr)
                engineLabel = "GPT 실시간 전사"
            }
            self.engine = engine

            let onProgress: @MainActor @Sendable (Double) -> Void = { [weak self] p in
                self?.downloadProgress = p < 1.0 ? p : nil
            }
            let onStatus: @MainActor @Sendable (String) -> Void = { [weak self] text in
                guard let self, case .preparing = self.phase else { return }
                self.phase = .preparing(text)
            }
            engineNote = ""
            do {
                try await engine.prepare(locale: locale, progress: onProgress, status: onStatus)
            } catch let lightningError where settings.sttEngine == .whisper && WhisperEngine.isLive(settings.whisperModel) {
                // 실시간 로컬 준비 실패 → 청크 Whisper 로 자동 폴백 (사유 표시) — 모든 테스트의 탈출구
                engineNote = lightningError.localizedDescription
                phase = .preparing("실시간 로컬 실패 — Whisper 청크로 전환 중…")
                let fallback = WhisperEngine(model: WhisperEngine.defaultModel,
                                             silence: settings.vadSilenceSec, maxSeg: settings.vadMaxSec,
                                             onVolatile: onVolatile, onFinal: onFinal, onError: onErr)
                self.engine = fallback
                engineLabel = "Whisper 로컬 (폴백)"
                try await fallback.prepare(locale: locale, progress: onProgress, status: onStatus)
            } catch let realtimeError where settings.sttEngine == .gptAPI {
                // 실시간 소켓 연결 실패 → 발화 단위 업로드 방식으로 자동 폴백 (사유 표시)
                engineNote = realtimeError.localizedDescription
                phase = .preparing("실시간 연결 실패 — 청크 모드로 전환 중…")
                let fallback = OpenAIRestTranscribeEngine(
                    key: KeychainStore.get("openai") ?? "",
                    silence: settings.vadSilenceSec, maxSeg: settings.vadMaxSec,
                    onVolatile: onVolatile, onFinal: onFinal, onError: onErr
                )
                self.engine = fallback
                engineLabel = "GPT 전사 (청크 폴백)"
                try await fallback.prepare(locale: locale, progress: onProgress, status: onStatus)
            }
            downloadProgress = nil

            let fileName = UUID().uuidString + ".m4a"
            let url = AppPaths.recordingsDir.appendingPathComponent(fileName)
            audioURL = url

            let rec = AudioRecorder()
            // self.engine 기준으로 배선 — 폴백으로 엔진이 교체된 경우까지 반영
            let activeEngine = self.engine
            rec.onBuffer = { [weak activeEngine] buffer in
                activeEngine?.feed(buffer)
            }
            rec.onLevel = { [weak self] lv in
                Task { @MainActor [weak self] in
                    self?.level = lv
                    self?.pushLevel(lv)
                }
            }
            recorder = rec
            try rec.start(writingTo: url)

            phase = .recording
            startedAt = .now
            RecordingActivityController.start(folderName: folderLabel, startedAt: startedAt)
            // 실패 사유를 녹음 화면에 노출한다 (조용히 안 뜨는 상황을 없앤다)
            if let activityError = RecordingActivityController.lastError {
                engineNote = activityError
            }
            ticker = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: .milliseconds(300))
                    guard let self else { return }
                    if case .recording = self.phase {
                        self.elapsed = self.recorder?.elapsed ?? self.elapsed
                        // Live Activity 시계도 여기서 흘린다 (컨트롤러가 1초로 스로틀)
                        self.syncActivity()
                    }
                }
            }
        } catch {
            phase = .error(error.localizedDescription)
            await cleanupEngines()
        }
    }

    func pause() {
        guard case .recording = phase else { return }
        recorder?.pause()
        phase = .paused
        syncActivity(force: true)
    }

    func resume() {
        guard case .paused = phase else { return }
        recorder?.resume()
        phase = .recording
        syncActivity(force: true)
    }

    /// Live Activity 를 현재 상태로 맞춘다 (일시정지 등 즉시 반영이 필요하면 force).
    /// 확정 청크가 아직 없거나 뒤에 미리보기가 붙는 중이면 volatileText 를 우선 보여준다 —
    /// GPT 실시간 전사처럼 청크가 늦게 확정되는 엔진에서도 글자가 바로 흐른다
    private func syncActivity(force: Bool = false) {
        let preview = volatileText.trimmingCharacters(in: .whitespacesAndNewlines)
        let line = preview.isEmpty ? (segments.last?.text ?? "") : preview
        RecordingActivityController.update(
            elapsed: elapsed,
            isPaused: phase == .paused,
            title: liveTitle.isEmpty ? folderLabel : liveTitle,
            latestLine: line,
            levels: levelHistory,
            force: force
        )
    }

    /// 파형용 최근 입력 레벨을 굴린다 — 갱신 스로틀은 컨트롤러가 맡는다
    private func pushLevel(_ value: Float) {
        guard case .recording = phase else { return }
        // 소수점 2자리로 줄여 페이로드를 작게 유지한다
        levelHistory.append((min(1, max(0, value)) * 100).rounded() / 100)
        if levelHistory.count > Self.levelWindow {
            levelHistory.removeFirst(levelHistory.count - Self.levelWindow)
        }
        syncActivity()
    }

    func stop() async {
        guard phase == .recording || phase == .paused else { return }
        phase = .stopping("전사 마무리 중…")
        RecordingActivityController.end()

        let duration = recorder?.stop() ?? elapsed
        elapsed = duration
        await engine?.finish()   // drains trailing finals into appendFinal
        volatileText = ""

        // flush corrections for the tail chunks that never got follow context
        if settings.liveCorrect, ai.engineReady(settings.correctionEngine) {
            phase = .stopping("실시간 교정 마무리 중…")
            for idx in segments.indices where !queuedCorrections.contains(idx) && !segments[idx].text.isEmpty {
                enqueueCorrection(idx)
            }
            let deadline = Date().addingTimeInterval(90)
            while (activeCorrections > 0 || !correctionBacklog.isEmpty) && Date() < deadline {
                try? await Task.sleep(for: .milliseconds(250))
            }
        }

        let memoSegments = segments.filter { !$0.text.isEmpty }.map {
            MemoSegment(tStart: $0.tStart, tEnd: $0.tEnd, text: $0.text, origText: $0.origText,
                        corrSpans: $0.corrSpans)
        }
        let df = DateFormatter()
        df.locale = Locale(identifier: "ko_KR")
        df.dateFormat = "M월 d일 HH:mm 녹음"
        var title = df.string(from: .now)

        if !liveTitle.isEmpty {
            // 녹음 중 5청크 시점에 이미 만들어 둔 제목을 그대로 쓴다
            title = liveTitle
        } else if settings.autoTitle, !memoSegments.isEmpty, ai.engineReady(settings.correctionEngine) {
            // 5청크에 못 미친 짧은 녹음 — 여기서 한 번 만든다
            phase = .stopping("제목 생성 중…")
            let transcript = memoSegments.map(\.text).joined(separator: " ")
            if let t = try? await ai.autoTitle(transcript: transcript), !t.isEmpty {
                title = String(t.prefix(40))
            }
        }

        if memoSegments.isEmpty {
            // nothing was transcribed — discard the take
            if let url = audioURL { try? FileManager.default.removeItem(at: url) }
            draft = nil
            phase = .idle
            await cleanupEngines()
            return
        }

        draft = RecordingDraft(
            segments: memoSegments,
            durationSec: duration,
            audioFileName: audioURL?.lastPathComponent ?? "",
            language: settings.transcribeLocaleID,
            suggestedTitle: title
        )
        phase = .idle
        await cleanupEngines()
    }

    func discardDraft() {
        if let name = draft?.audioFileName {
            try? FileManager.default.removeItem(at: AppPaths.recordingsDir.appendingPathComponent(name))
        }
        draft = nil
    }

    func dismissError() { phase = .idle }

    private func cleanupEngines() async {
        ticker?.cancel()
        ticker = nil
        titleTask?.cancel()
        titleTask = nil
        recorder = nil
        engine = nil
        level = 0
        RecordingActivityController.end()
    }

    // MARK: - transcript assembly

    private func appendFinal(_ text: String) {
        let tEnd = recorder?.elapsed ?? elapsed
        let tStart = segments.last?.tEnd ?? 0
        // deterministic per-agent replacements (desktop: 오인식→정정 rules)
        var fixed = text
        for (from, to) in Agent.parsePairs(settings.agentReplacementsText) {
            fixed = fixed.replacingOccurrences(of: from, with: to)
        }
        segments.append(LiveSegment(tStart: tStart, tEnd: tEnd, text: fixed))
        volatileText = ""
        scheduleCorrections()
        maybeGenerateTitle()
        syncActivity()
    }

    /// 5청크 이상 전사되면 제목을 미리 만든다 — 저장할 때 제목 생성으로 기다리지 않게 된다
    private func maybeGenerateTitle() {
        guard settings.autoTitle, liveTitle.isEmpty, titleTask == nil,
              segments.count >= 5, ai.engineReady(settings.correctionEngine) else { return }
        let transcript = segments.map(\.text).joined(separator: " ")
        titleTask = Task { [weak self] in
            guard let self else { return }
            let generated = try? await self.ai.autoTitle(transcript: transcript)
            guard !Task.isCancelled else { return }
            if let generated, !generated.isEmpty {
                self.liveTitle = String(generated.prefix(40))
                self.syncActivity(force: true)
            }
            self.titleTask = nil
        }
    }

    func editSegment(id: UUID, newText: String) {
        guard let idx = segments.firstIndex(where: { $0.id == id }) else { return }
        segments[idx].text = newText
        segments[idx].userEdited = true
        segments[idx].corrSpans = nil   // 오프셋이 무효화되므로 파란 표시 해제
    }

    // MARK: - live correction pipeline (desktop: FOLLOW_DELAY=2, concurrency 3, ctx 6/2 chunks)

    private func scheduleCorrections() {
        guard settings.liveCorrect, ai.engineReady(settings.correctionEngine) else { return }
        let readyThrough = segments.count - 1 - Self.followDelay
        guard readyThrough >= 0 else { return }
        for idx in 0...readyThrough where !queuedCorrections.contains(idx) {
            enqueueCorrection(idx)
        }
    }

    private func enqueueCorrection(_ idx: Int) {
        queuedCorrections.insert(idx)
        correctionBacklog.append(idx)
        pumpCorrections()
    }

    private func pumpCorrections() {
        while activeCorrections < Self.maxConcurrentCorrections, !correctionBacklog.isEmpty {
            let idx = correctionBacklog.removeFirst()
            guard idx < segments.count, !segments[idx].userEdited, !segments[idx].text.isEmpty else { continue }
            activeCorrections += 1
            segments[idx].correcting = true
            let context = segments[max(0, idx - 6)..<idx].map(\.text).joined(separator: "\n")
            let follow = segments[(idx + 1)..<min(segments.count, idx + 3)].map(\.text).joined(separator: "\n")
            let original = segments[idx].text
            let segID = segments[idx].id

            Task { [weak self] in
                guard let self else { return }
                defer {
                    self.activeCorrections -= 1
                    self.pumpCorrections()
                }
                do {
                    let result = try await self.ai.correctChunk(context: context, follow: follow, chunk: original)
                    guard let i = self.segments.firstIndex(where: { $0.id == segID }),
                          !self.segments[i].userEdited else { return }
                    self.segments[i].correcting = false
                    if result.text != original, !result.text.isEmpty {
                        self.segments[i].origText = original
                        self.segments[i].text = result.text
                        self.segments[i].corrSpans = result.spans.isEmpty ? nil : result.spans
                    }
                } catch {
                    if let i = self.segments.firstIndex(where: { $0.id == segID }) {
                        self.segments[i].correcting = false
                    }
                }
            }
        }
    }
}
