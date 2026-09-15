import Foundation
import AVFoundation
import MLX
import WhisperKit

/// 실시간 로컬 엔진("Lightning")의 기기 지원 여부
enum LightningSupport {
    /// MLX 는 실기기 Metal 이 필요하다 — 시뮬레이터에서는 엔진을 숨긴다
    static var isSupported: Bool {
        #if targetEnvironment(simulator)
        false
        #else
        true
        #endif
    }
}

/// 실시간 엔진 자가진단 — M1 스모크(MLX·가중치 헤더) + M2 배치 대조(회귀) + M3 스트리밍 하네스.
enum LightningDiag {
    static let weightsURL = URL(string: "https://huggingface.co/mlx-community/whisper-large-v3-turbo/resolve/main/weights.safetensors")!

    static func run(audioURL: URL? = nil,
                    audioTitle: String = "",
                    progress: @escaping @MainActor @Sendable (String) -> Void = { _ in }) async -> String {
        var lines: [String] = []
        lines.append(mlxSmoke())
        lines.append(await safetensorsHeaderSmoke())
        if let audioURL, LightningSupport.isSupported {
            lines.append("대조 오디오: \(audioTitle)")
            lines.append(await m2Batch(audioURL: audioURL, progress: progress))
            lines.append(await m3Stream(audioURL: audioURL, progress: progress))
        } else if audioURL == nil {
            lines.append("M2/M3: 10초 이상 녹음된 노트가 없어 건너뜀")
        }
        return lines.joined(separator: "\n\n")
    }

    // MARK: - M2: 오프라인 배치 대조 (회귀 기준선)

    private static func m2Batch(audioURL: URL,
                                progress: @escaping @MainActor @Sendable (String) -> Void) async -> String {
        do {
            var timings: [String] = []
            func tick(_ label: String, _ start: Date) {
                timings.append("\(label) \(String(format: "%.1f", Date().timeIntervalSince(start)))s")
            }

            await progress("토크나이저 로드 중…")
            var t0 = Date()
            let tokenizer = try await ModelUtilities.loadTokenizer(for: .largev3)
            tick("토크나이저", t0)
            let special = tokenizer.specialTokens
            guard let koToken = tokenizer.convertTokenToId("<|ko|>") else {
                return "M2 배치: 실패 — <|ko|> 토큰을 찾지 못함"
            }

            t0 = Date()
            let weightsURL = try await SafetensorsFetch.fetchDecoder { _, label in progress(label) }
            tick("가중치", t0)
            t0 = Date()
            let decoder = try WhisperMLXDecoder(url: weightsURL)
            tick("디코더", t0)

            // 가중치 지문 + 합성 시퀀스 — Mac 기준값과의 회귀 감시선
            let fpPairs: [(String, MLXArray)] = [
                ("emb", decoder.tokenEmbedding), ("c2k", decoder.layers[2].crossKw),
                ("c3k", decoder.layers[3].crossKw), ("ln", decoder.lnW),
            ]
            let fingerprint = fpPairs
                .map { "\($0.0)=\(String(format: "%.4f", MLX.abs($0.1.asType(.float32)).mean().item(Float.self)))" }
                .joined(separator: " ")
            let synth = (decoder.tokenEmbedding[0 ..< 1500] * 30).asType(.float16).expandedDimensions(axis: 0)
            let synthKV = decoder.crossKV(encoder: synth)
            var synthSuppress = [Float](repeating: 0, count: 51866)
            for id in special.specialTokenBegin..<51866 { synthSuppress[id] = -1e9 }
            let synthResult = decoder.greedyDecode(
                encKV: synthKV,
                prompt: [special.startOfTranscriptToken, koToken, special.transcribeToken, special.noTimestampsToken],
                suppressMask: MLXArray(synthSuppress), firstTokenExtraSuppress: nil,
                noSpeechToken: special.noSpeechToken, eotToken: -1,
                maxNewTokens: 8, captureAlignment: false)
            let synthLine = "합성 ids=\(synthResult.tokens.map(String.init).joined(separator: ","))"

            await progress("인코더 로드 중…")
            t0 = Date()
            let frontend = try await CoreMLFrontend.load()
            tick("인코더 로드", t0)

            await progress("오디오 인코딩 중…")
            t0 = Date()
            let (samples, startSec) = try AudioFileLoader.loadBestWindow16k(url: audioURL, windowSec: 15, scanSec: 120)
            let (encoded, encStats) = try await frontend.encode(samples16k: samples)
            tick("인코딩", t0)
            let encKV = decoder.crossKV(encoder: encoded)

            await progress("MLX 디코딩 중…")
            t0 = Date()
            var suppress = [Float](repeating: 0, count: 51866)
            for id in special.specialTokenBegin..<51866 where id != special.endToken { suppress[id] = -1e9 }
            var first = [Float](repeating: 0, count: 51866)
            first[special.whitespaceToken] = -1e9
            first[special.endToken] = -1e9
            let result = decoder.greedyDecode(
                encKV: encKV,
                prompt: [special.startOfTranscriptToken, koToken, special.transcribeToken, special.noTimestampsToken],
                suppressMask: MLXArray(suppress),
                firstTokenExtraSuppress: MLXArray(first),
                noSpeechToken: special.noSpeechToken,
                eotToken: special.endToken,
                maxNewTokens: 120,
                captureAlignment: true)
            let mlxText = tokenizer.decode(tokens: result.tokens.filter { $0 < special.specialTokenBegin })
                .trimmingCharacters(in: .whitespacesAndNewlines)
            tick("디코드(\(result.tokens.count)tok)", t0)

            let frames = result.alignFrames.prefix(12).map(String.init).joined(separator: ",")
            return """
            M2 배치: 완료 — \(timings.joined(separator: " · "))
            지문 \(fingerprint) · \(synthLine)
            오디오 \(startSec)s부터 15s · \(encStats.line)
            nospeech p=\(String(format: "%.3f", result.noSpeechProb))
            [배치] \(mlxText)
            정렬(단조↑ 기대): \(frames)
            """
        } catch {
            return "M2 배치: 실패 — \(error.localizedDescription)"
        }
    }

    // MARK: - M3: 스트리밍 하네스 (100ms 슬라이스 실시간 페이스 피드)

    private final class EventLog: @unchecked Sendable {
        private let lock = NSLock()
        private var items: [(t: Date, kind: String, text: String)] = []
        func add(_ kind: String, _ text: String) {
            lock.lock(); items.append((Date(), kind, text)); lock.unlock()
        }
        func snapshot() -> [(t: Date, kind: String, text: String)] {
            lock.lock(); defer { lock.unlock() }; return items
        }
    }

    private static func m3Stream(audioURL: URL,
                                 progress: @escaping @MainActor @Sendable (String) -> Void) async -> String {
        do {
            let (window, startSec) = try AudioFileLoader.loadBestWindow16k(url: audioURL, windowSec: 20, scanSec: 120)
            let log = EventLog()
            let engine = LightningEngine(
                silence: 1.2,
                onVolatile: { text in log.add("v", text) },
                onFinal: { text in log.add("f", text) },
                onError: { text in log.add("e", text) })
            try await engine.prepare(locale: Locale(identifier: "ko_KR"),
                                     progress: { _ in },
                                     status: { s in progress("M3 준비: \(s)") })

            await progress("M3 스트리밍 중… (실시간 페이스 \(Int(Double(window.count) / 16000))초)")
            let streamStart = Date()
            let fmt = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!
            var offset = 0
            let hop = 1600 // 100ms
            while offset < window.count {
                let end = min(offset + hop, window.count)
                let count = end - offset
                guard let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(count)) else { break }
                buf.frameLength = AVAudioFrameCount(count)
                window.withUnsafeBufferPointer { src in
                    buf.floatChannelData![0].update(from: src.baseAddress! + offset, count: count)
                }
                engine.feed(buf)
                try await Task.sleep(for: .milliseconds(100))
                offset = end
            }
            await engine.finish()
            let wall = Date().timeIntervalSince(streamStart)

            // 계측 요약
            let stats = engine.stepStats
            func fmt1(_ v: Double) -> String { String(format: "%.0f", v) }
            let encTimes = stats.map(\.encodeMS), decTimes = stats.map(\.decodeMS)
            let statLine = stats.isEmpty ? "스텝 0회" : "스텝 \(stats.count)회 enc avg/max \(fmt1(encTimes.reduce(0,+)/Double(stats.count)))/\(fmt1(encTimes.max() ?? 0))ms dec avg/max \(fmt1(decTimes.reduce(0,+)/Double(stats.count)))/\(fmt1(decTimes.max() ?? 0))ms"
            let thermalNames = ["정상", "약간", "심각", "위험"]
            let thermalCounts = Dictionary(grouping: stats, by: { $0.thermal.rawValue })
                .sorted { $0.key < $1.key }
                .map { "\(thermalNames[min($0.key, 3)]) \($0.value.count)" }
                .joined(separator: "·")

            let events = log.snapshot()
            let volatiles = events.filter { $0.kind == "v" && $0.text != UtteranceVADEngine.listeningMarker }
            let finals = events.filter { $0.kind == "f" }
            let errors = events.filter { $0.kind == "e" }
            func rel(_ d: Date) -> String { String(format: "%.1f", d.timeIntervalSince(streamStart)) }

            var lines = [
                "M3 스트리밍: \(startSec)s부터 \(Int(Double(window.count) / 16000))s · 벽시계 \(String(format: "%.1f", wall))s",
                "\(statLine) · 게이트 보류 \(engine.gateHolds)회 · 발열 \(thermalCounts)",
            ]
            if let firstV = volatiles.first {
                lines.append("첫 볼라틸 +\(rel(firstV.t))s: \(firstV.text.prefix(40))")
            }
            if volatiles.count > 1, let midV = volatiles.dropFirst(volatiles.count / 2).first {
                lines.append("중간 +\(rel(midV.t))s: …\(midV.text.suffix(40))")
            }
            for f in finals {
                lines.append("[final +\(rel(f.t))s] \(f.text)")
            }
            if finals.isEmpty { lines.append("[final] 없음 — 발화 미검출 또는 무음 게이트") }
            for e in errors.prefix(2) { lines.append("[오류] \(e.text)") }
            return lines.joined(separator: "\n")
        } catch {
            return "M3 스트리밍: 실패 — \(error.localizedDescription)"
        }
    }

    /// MLX 스모크 — 512×512 fp16 행렬곱을 GPU 에서 실행해 본다
    private static func mlxSmoke() -> String {
        guard LightningSupport.isSupported else {
            return "MLX: 시뮬레이터 미지원 (실기기 전용)"
        }
        let start = Date()
        let a = MLXArray.ones([512, 512]).asType(.float16)
        let b = MLXArray.ones([512, 512]).asType(.float16)
        let c = MLX.matmul(a, b)
        MLX.eval(c)
        let value = c[0, 0].item(Float.self)
        let ms = Date().timeIntervalSince(start) * 1000
        let ok = abs(value - 512) < 1
        return "MLX: \(ok ? "정상" : "값 이상(\(value))") — 512×512 fp16 matmul \(String(format: "%.0f", ms))ms"
    }

    /// safetensors 헤더 스모크 — Range 요청으로 헤더만 받아 decoder.* 텐서를 센다
    private static func safetensorsHeaderSmoke() async -> String {
        do {
            let lenData = try await ranged(weightsURL, from: 0, to: 7)
            guard lenData.count == 8 else { return "가중치 헤더: Range 미지원(응답 \(lenData.count)B)" }
            let headerLen = lenData.withUnsafeBytes { $0.load(as: UInt64.self) }.littleEndian
            guard headerLen > 0, headerLen < 50_000_000 else { return "가중치 헤더: 길이 이상(\(headerLen))" }
            let headerData = try await ranged(weightsURL, from: 8, to: 8 + Int(headerLen) - 1)
            guard let json = try JSONSerialization.jsonObject(with: headerData) as? [String: Any] else {
                return "가중치 헤더: JSON 파싱 실패"
            }
            var decoderTensors = 0
            var decoderBytes: Int64 = 0
            for (key, value) in json where key.hasPrefix("decoder.") {
                decoderTensors += 1
                if let dict = value as? [String: Any],
                   let offsets = dict["data_offsets"] as? [Int64], offsets.count == 2 {
                    decoderBytes += offsets[1] - offsets[0]
                }
            }
            let mb = Double(decoderBytes) / 1_048_576
            return "가중치 헤더: 정상 — decoder 텐서 \(decoderTensors)개, \(String(format: "%.0f", mb))MB (부분 다운로드 가능)"
        } catch {
            return "가중치 헤더: 실패 — \(error.localizedDescription)"
        }
    }

    private static func ranged(_ url: URL, from: Int, to: Int) async throws -> Data {
        var req = URLRequest(url: url)
        req.setValue("bytes=\(from)-\(to)", forHTTPHeaderField: "Range")
        req.timeoutInterval = 30
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard code == 206 else { throw AIError.http(code, "Range 미지원") }
        return data
    }
}
