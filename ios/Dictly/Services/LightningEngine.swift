import Foundation
import AVFoundation
import Compression
import MLX
import WhisperKit

/// 실시간 로컬 전사 엔진 ("Lightning", Path B M3) — CoreML 인코더 + MLX 디코더 + AlignAtt 게이팅.
/// 말하는 도중 확정 토큰이 volatile 로 흐르고, 발화가 닫히면 게이트 없는 최종 디코드가 final 로 나간다.
///
/// 동시성 모델: 오디오 탭 스레드는 VAD·버퍼 갱신만 하고(락), 추론은 스테퍼 Task 하나만 수행한다 —
/// 중첩 추론이 구조적으로 불가능. 스텝이 느리면 큐잉 없이 코얼레스(다음 스텝이 누적 오디오 전체를 봄).
final class LightningEngine: DictationEngine, @unchecked Sendable {
    static let sampleRate: Double = 16000
    private static let minSegSec: Double = 0.4
    private static let prerollSec: Double = 0.5
    private static let softCloseSec: Double = 22     // 이 길이부터 호흡(RMS 최저점)에서 분할
    private static let hardCloseSec: Double = 28     // 안전 상한 (30s 창 내 게이트 여유)
    private static let holdFrames = 4                // AlignAtt f (논문 실험 범위에서 출발)
    private static let stepTokenCap = 64
    private static let finalTokenCap = 320           // 22s 한국어 강의 밀도 대응 (224 는 잘림)
    private static let firstCommitSec: Double = 1.6  // 첫 확정 전 최소 오디오 — 초입 환각 억제
    private static let prevContextCap = 80           // <|startofprev|> 조건화 토큰 수 상한

    // MARK: 콜백 (기존 엔진 계약과 동일)
    let onVolatile: @MainActor @Sendable (String) -> Void
    let onFinal: @MainActor @Sendable (String) -> Void
    let onError: @MainActor @Sendable (String) -> Void

    private let silenceCloseSec: Double
    private var language = "ko"   // prepare 의 locale 에서 확정

    // MARK: 모델 (prepare 에서 로드, 스테퍼만 접근)
    private var frontend: CoreMLFrontend?
    private var decoder: WhisperMLXDecoder?
    private var tokenizer: (any WhisperTokenizer)?
    private var promptBase: [Int] = []
    private var suppressMask: MLXArray?
    private var firstSuppress: MLXArray?
    private var eotToken = 0
    private var noSpeechToken = 0
    private var specialTokenBegin = 0

    // MARK: 오디오 상태 (탭 스레드가 락 하에 갱신)
    private let lock = NSLock()
    private var preroll: [Float] = []
    private var active: [Float] = []          // 진행 중 발화
    private var inUtterance = false
    private var silentSec: Double = 0
    private var noiseFloor: Float = 0.002
    private var closedSegments: [[Float]] = [] // finalize 대기 큐 (보통 깊이 ≤1)
    private var rmsTrack: [(count: Int, rms: Float)] = [] // 소프트 분할용 (active 기준 오프셋)
    private var utteranceGen = 0               // 분할/종료 때 증가 — 스테퍼가 낡은 확정을 버리는 기준
    private var finished = false
    private var converter: AVAudioConverter?
    private let targetFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!

    // MARK: 스테퍼 상태 (스테퍼 Task 만 접근)
    private var stepperTask: Task<Void, Never>?
    private var confirmed: [Int] = []          // 현재 발화의 확정 토큰
    private var confirmedGen = 0               // confirmed 가 속한 발화 세대
    private var lastSteppedCount = 0           // 코얼레스 기준점
    private var prevContext: [Int] = []        // 직전 final 의 원시 토큰 꼬리 (조건화용)
    private var sopToken = 0
    private var stepPeriod: Double = 1.0       // 만성 지연 시 1.5 로 완화
    private var ready = false

    // MARK: 계측 (M3 하네스가 읽음)
    struct StepStat { var encodeMS: Double; var decodeMS: Double; var confirmedCount: Int; var held: Bool; var thermal: ProcessInfo.ThermalState }
    private(set) var stepStats: [StepStat] = []
    private(set) var gateHolds = 0

    init(silence: Double,
         onVolatile: @escaping @MainActor @Sendable (String) -> Void,
         onFinal: @escaping @MainActor @Sendable (String) -> Void,
         onError: @escaping @MainActor @Sendable (String) -> Void) {
        self.silenceCloseSec = max(0.5, silence)
        self.onVolatile = onVolatile
        self.onFinal = onFinal
        self.onError = onError
    }

    // MARK: - DictationEngine

    func prepare(locale: Locale,
                 progress: @escaping @MainActor @Sendable (Double) -> Void,
                 status: @escaping @MainActor @Sendable (String) -> Void) async throws {
        guard LightningSupport.isSupported else {
            throw AIError.http(0, "실시간 로컬 엔진은 실기기에서만 동작합니다.")
        }
        MLX.GPU.set(cacheLimit: 32 * 1024 * 1024)
        language = locale.language.languageCode?.identifier ?? "ko"

        // 프리로더 phase 를 준비 UI 로 미러링 (WhisperEngine 패턴)
        let mirror = Task { @MainActor in
            while !Task.isCancelled {
                switch LightningPreloader.shared.phase {
                case .downloading(let pct):
                    progress(Double(pct) / 100)
                    status("실시간 엔진 가중치 다운로드 중…")
                case .loading:
                    progress(1.0)
                    status("실시간 엔진 로드 중…")
                default:
                    break
                }
                try? await Task.sleep(for: .milliseconds(250))
            }
        }
        defer { mirror.cancel() }

        let assets = try await LightningPreloader.shared.ensureLoaded()
        frontend = assets.frontend
        decoder = assets.decoder
        tokenizer = assets.tokenizer

        let special = assets.tokenizer.specialTokens
        let langToken = assets.tokenizer.convertTokenToId("<|\(language)|>")
            ?? assets.tokenizer.convertTokenToId("<|ko|>")!
        promptBase = [special.startOfTranscriptToken, langToken, special.transcribeToken, special.noTimestampsToken]
        eotToken = special.endToken
        noSpeechToken = special.noSpeechToken
        specialTokenBegin = special.specialTokenBegin
        sopToken = special.startOfPreviousToken
        var suppress = [Float](repeating: 0, count: 51866)
        for id in special.specialTokenBegin..<51866 where id != special.endToken { suppress[id] = -1e9 }
        suppressMask = MLXArray(suppress)
        var first = [Float](repeating: 0, count: 51866)
        first[special.whitespaceToken] = -1e9
        first[special.endToken] = -1e9
        firstSuppress = MLXArray(first)

        startStepper()
        ready = true
        await status("준비 완료")
    }

    func feed(_ buffer: AVAudioPCMBuffer) {
        guard ready, !finished else { return }
        guard let samples = convertTo16k(buffer), !samples.isEmpty else { return }
        let dur = Double(samples.count) / Self.sampleRate
        var sum: Float = 0
        for s in samples { sum += s * s }
        let rms = sqrtf(sum / Float(samples.count))

        lock.lock()
        defer { lock.unlock() }
        // WhisperEngine 과 동일한 적응형 VAD 공식
        let speechThresh = max(0.0035, noiseFloor * 2.5)
        let silenceThresh = speechThresh * 0.8

        if !inUtterance {
            noiseFloor = min(0.01, max(0.0015, noiseFloor * 0.97 + rms * 0.03))
            preroll.append(contentsOf: samples)
            let maxPre = Int(Self.prerollSec * Self.sampleRate)
            if preroll.count > maxPre { preroll.removeFirst(preroll.count - maxPre) }
            if rms >= speechThresh {
                inUtterance = true
                silentSec = 0
                active = preroll
                preroll = []
                Task { @MainActor in self.onVolatile(UtteranceVADEngine.listeningMarker) }
            }
            return
        }

        active.append(contentsOf: samples)
        rmsTrack.append((active.count, rms))
        silentSec = rms < silenceThresh ? silentSec + dur : 0
        let utterDur = Double(active.count) / Self.sampleRate
        if silentSec >= silenceCloseSec || utterDur >= Self.hardCloseSec {
            closeActiveLocked()
        } else if utterDur >= Self.softCloseSec {
            softSplitLocked()
        }
    }

    /// lock 보유 상태에서 호출 — 긴 발화를 최근 4초 중 가장 조용한 지점(호흡)에서 자르고,
    /// 나머지는 다음 발화로 이월한다. 하드컷이 단어 중간을 자르는 것을 피한다.
    private func softSplitLocked() {
        let lookback = Int(4 * Self.sampleRate)
        let floorCount = active.count - lookback
        let candidates = rmsTrack.filter { $0.count > floorCount }
        guard let quietest = candidates.min(by: { $0.rms < $1.rms }) else {
            closeActiveLocked(); return
        }
        let splitAt = quietest.count
        let head = Array(active[0..<splitAt])
        let tail = Array(active[splitAt...])
        active = tail
        rmsTrack = rmsTrack.compactMap { $0.count > splitAt ? ($0.count - splitAt, $0.rms) : nil }
        silentSec = 0
        utteranceGen += 1
        if Double(head.count) / Self.sampleRate >= Self.minSegSec {
            closedSegments.append(head)
        }
    }

    /// lock 보유 상태에서 호출 — 활성 발화를 finalize 큐로 옮긴다
    private func closeActiveLocked() {
        let seg = active
        active = []
        rmsTrack = []
        inUtterance = false
        silentSec = 0
        utteranceGen += 1
        if Double(seg.count) / Self.sampleRate >= Self.minSegSec {
            closedSegments.append(seg)
        }
    }

    func finish() async {
        lock.lock()
        if inUtterance { closeActiveLocked() }
        finished = true
        lock.unlock()
        // 스테퍼가 finalize 큐를 비울 때까지 대기 (꼬리 청크 자연 드레인)
        let deadline = Date().addingTimeInterval(60)
        while Date() < deadline {
            lock.lock(); let backlog = closedSegments.count; lock.unlock()
            if backlog == 0 { break }
            try? await Task.sleep(for: .milliseconds(100))
        }
        stepperTask?.cancel()
        converter = nil
    }

    // MARK: - 스테퍼 (유일한 추론 주체)

    /// 스텝 주기 = max(열 상태 기준, 만성 지연 완화값).
    /// 인코더(ANE 825ms)가 발열의 주범이라 주기가 곧 듀티사이클 조절이다 —
    /// 오디오 축적 페이스가 벽시계와 같으므로 주기 2.8s 면 ANE 듀티 ≈ 35%.
    private func currentPeriod() -> Double {
        let thermalBase: Double
        switch ProcessInfo.processInfo.thermalState {
        case .nominal: thermalBase = 1.2
        case .fair: thermalBase = 1.8
        case .serious: thermalBase = 2.8
        case .critical: thermalBase = 4.5
        @unknown default: thermalBase = 1.8
        }
        return max(thermalBase, stepPeriod)
    }

    private func startStepper() {
        stepperTask = Task.detached(priority: .userInitiated) { [weak self] in
            while let self, !Task.isCancelled {
                // 1) finalize 백로그 우선
                self.lock.lock()
                let segment = self.closedSegments.isEmpty ? nil : self.closedSegments.removeFirst()
                self.lock.unlock()
                if let segment {
                    await self.finalizeDecode(segment)
                    continue
                }
                self.lock.lock()
                let isFinished = self.finished
                let snapshot = self.inUtterance ? self.active : []
                let gen = self.utteranceGen
                self.lock.unlock()
                if isFinished { break }

                // 발화 세대가 바뀌었으면(분할/종료) 낡은 확정 토큰을 버린다
                if self.confirmedGen != gen {
                    self.confirmed = []
                    self.lastSteppedCount = 0
                    self.confirmedGen = gen
                }

                // 2) 볼라틸 스텝 — 새 오디오가 충분히 쌓였을 때만 (코얼레스).
                //    발화의 첫 확정은 더 긴 오디오를 요구한다 (1초짜리 초입 환각 억제)
                let period = self.currentPeriod()
                let need = self.confirmed.isEmpty ? max(Self.firstCommitSec, period) : period
                if !snapshot.isEmpty,
                   snapshot.count - self.lastSteppedCount >= Int(need * Self.sampleRate) {
                    await self.volatileStep(snapshot, gen: gen)
                } else {
                    try? await Task.sleep(for: .milliseconds(50))
                }
            }
        }
    }

    /// [sop]+직전텍스트 조건화 프롬프트. sot 인덱스도 함께 돌려준다.
    private func contextPrompt(extra: [Int]) -> (prompt: [Int], sotIndex: Int) {
        var prefix: [Int] = []
        if !prevContext.isEmpty {
            prefix = [sopToken] + prevContext.suffix(Self.prevContextCap)
        }
        return (prefix + promptBase + extra, prefix.count)
    }

    private func volatileStep(_ samples: [Float], gen: Int) async {
        guard let frontend, let decoder, let tokenizer, let suppressMask else { return }
        do {
            let t0 = Date()
            let capped = samples.count > Int(30 * Self.sampleRate)
                ? Array(samples.suffix(Int(30 * Self.sampleRate))) : samples
            let (encoded, _) = try await frontend.encode(samples16k: capped)
            let encodeMS = Date().timeIntervalSince(t0) * 1000

            let t1 = Date()
            let encKV = decoder.crossKV(encoder: encoded)
            let validFrames = max(1, min(1500, Int(Double(capped.count) / Self.sampleRate * 50)))
            let (prompt, sotIndex) = contextPrompt(extra: confirmed)
            let result = decoder.gatedDecode(
                encKV: encKV,
                prompt: prompt,
                suppressMask: suppressMask,
                firstTokenExtraSuppress: confirmed.isEmpty ? firstSuppress : nil,
                noSpeechToken: noSpeechToken,
                eotToken: eotToken,
                validFrames: validFrames,
                holdFrames: Self.holdFrames,
                maxNewTokens: min(Self.stepTokenCap, 440 - prompt.count),
                sotIndex: sotIndex)
            let decodeMS = Date().timeIntervalSince(t1) * 1000

            // 스텝 도중 발화가 분할/종료됐으면 결과를 버린다 (낡은 오디오에 대한 확정)
            lock.lock(); let stale = utteranceGen != gen; lock.unlock()
            if stale { return }

            lastSteppedCount = samples.count
            if result.held { gateHolds += 1 }

            // 무음 게이트: 발화 초입에 nospeech 확률이 높으면 아무것도 확정하지 않는다
            if confirmed.isEmpty, result.noSpeechProb > 0.6 {
                stepStats.append(StepStat(encodeMS: encodeMS, decodeMS: decodeMS, confirmedCount: 0,
                                          held: result.held, thermal: ProcessInfo.processInfo.thermalState))
                return
            }

            if !result.tokens.isEmpty {
                confirmed.append(contentsOf: result.tokens)
                // 반복 가드: 동일 토큰 8연속 또는 확정 토큰 초과 → 강제 finalize
                let runaway = Self.repetitionPeriod(confirmed) != nil
                if runaway || confirmed.count > 200 {
                    lock.lock(); closeActiveLocked(); lock.unlock()
                }
                // 한글이 BPE 토큰 경계에서 잘리면 꼬리가 U+FFFD 로 디코드된다 — 표시에서만 걷어낸다
                var text = tokenizer.decode(tokens: confirmed.filter { $0 < specialTokenBegin })
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                while text.hasSuffix("\u{FFFD}") { text = String(text.dropLast()).trimmingCharacters(in: .whitespaces) }
                if !text.isEmpty {
                    Task { @MainActor in self.onVolatile(text) }
                }
            }
            stepStats.append(StepStat(encodeMS: encodeMS, decodeMS: decodeMS,
                                      confirmedCount: result.tokens.count, held: result.held,
                                      thermal: ProcessInfo.processInfo.thermalState))

            // 만성 지연 시 바닥 주기 완화 (열 거버너와 max 로 합성됨)
            let recent = stepStats.suffix(3)
            if recent.count == 3,
               recent.map({ $0.encodeMS + $0.decodeMS }).reduce(0, +) / 3 > stepPeriod * 800 {
                stepPeriod = 1.5
            }
        } catch {
            Task { @MainActor in self.onError("실시간 스텝 실패: \(error.localizedDescription)") }
        }
    }

    /// 꼬리가 주기 1~8 의 반복인지 — 반복 단위 길이를 돌려준다 ("연결납세로"=3토큰 같은 임의 주기 대응)
    private static func repetitionPeriod(_ tokens: [Int], minRepeats: Int = 3) -> Int? {
        for period in 1...8 where tokens.count >= period * minRepeats {
            let tail = Array(tokens.suffix(period * minRepeats))
            let unit = Array(tail.prefix(period))
            var repeats = true
            for r in 1..<minRepeats where Array(tail[(r * period)..<((r + 1) * period)]) != unit {
                repeats = false
                break
            }
            if repeats { return period }
        }
        return nil
    }

    /// gzip 압축비 — 2.4 초과면 반복/환각 텍스트로 본다 (whisper 표준 판정)
    private static func compressionRatio(_ text: String) -> Double {
        let data = Array(text.utf8)
        guard data.count > 40 else { return 1 }
        var dst = [UInt8](repeating: 0, count: data.count + 64)
        let n = compression_encode_buffer(&dst, dst.count, data, data.count, nil, COMPRESSION_ZLIB)
        guard n > 0 else { return 1 }
        return Double(data.count) / Double(n)
    }

    private func finalizeDecode(_ segment: [Float]) async {
        guard let frontend, let decoder, let tokenizer, let suppressMask else { return }
        do {
            let capped = segment.count > Int(30 * Self.sampleRate)
                ? Array(segment.suffix(Int(30 * Self.sampleRate))) : segment
            let (encoded, _) = try await frontend.encode(samples16k: capped)
            let encKV = decoder.crossKV(encoder: encoded)
            // 게이트 없이 EOT 까지 — 직전 텍스트 조건화(<|startofprev|>)로 용어 일관성을 얻고,
            // 반복 환각이 감지되면 조건화 없이 한 번 더 (환각 증폭 가드)
            func decode(withContext: Bool, temperature: Float = 0) -> WhisperMLXDecoder.DecodeResult {
                let (prompt, sotIndex) = withContext ? contextPrompt(extra: []) : (promptBase, 0)
                return decoder.greedyDecode(
                    encKV: encKV,
                    prompt: prompt,
                    suppressMask: suppressMask,
                    firstTokenExtraSuppress: firstSuppress,
                    noSpeechToken: noSpeechToken,
                    eotToken: eotToken,
                    maxNewTokens: min(Self.finalTokenCap, 440 - prompt.count),
                    captureAlignment: false,
                    sotIndex: sotIndex,
                    temperature: temperature)
            }
            // 온도 폴백 체인 (whisper 표준): 반복/압축비 불량이면 조건화 해제 → 온도 상승 재시도
            func isBad(_ r: WhisperMLXDecoder.DecodeResult) -> Bool {
                let toks = r.tokens.filter { $0 < specialTokenBegin }
                if Self.repetitionPeriod(toks) != nil { return true }
                return Self.compressionRatio(tokenizer.decode(tokens: toks)) > 2.4
            }
            var result = decode(withContext: true)
            if isBad(result) { result = decode(withContext: false) }
            if isBad(result) { result = decode(withContext: false, temperature: 0.3) }
            if isBad(result) { result = decode(withContext: false, temperature: 0.5) }

            confirmed = []
            lastSteppedCount = 0
            if result.noSpeechProb > 0.6 {
                Task { @MainActor in self.onVolatile(UtteranceVADEngine.listeningMarker) }
                return
            }
            // 재시도로도 남은 반복 꼬리는 2회 이하로 잘라서 방출
            var textTokens = result.tokens.filter { $0 < specialTokenBegin }
            while let period = Self.repetitionPeriod(textTokens) {
                textTokens.removeLast(period)
            }
            var text = tokenizer.decode(tokens: textTokens)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            while text.hasSuffix("\u{FFFD}") { text = String(text.dropLast()).trimmingCharacters(in: .whitespaces) }
            if !text.isEmpty {
                // 불량 판정이 끝내 풀리지 않은 결과는 다음 발화 조건화에 쓰지 않는다 (오염 전파 차단)
                prevContext = isBad(result) ? [] : Array(textTokens.suffix(Self.prevContextCap))
                Task { @MainActor in self.onFinal(text) }
            }
            lock.lock(); let stillFinished = finished; lock.unlock()
            if !stillFinished {
                Task { @MainActor in self.onVolatile(UtteranceVADEngine.listeningMarker) }
            }
        } catch {
            confirmed = []
            lastSteppedCount = 0
            Task { @MainActor in self.onError("최종 전사 실패: \(error.localizedDescription)") }
        }
    }

    // MARK: - 16k 변환 (UtteranceVADEngine 과 동일 구현)

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
}
