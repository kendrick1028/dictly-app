import Foundation
import AVFoundation

/// GPT LIVE transcription via the OpenAI Realtime API (WebSocket, intent=transcription).
/// Mic audio streams as pcm16@24kHz; the server VAD segments turns, transcription
/// deltas arrive while speaking and each turn's `completed` transcript becomes a
/// final chunk. Handles both the beta (`transcription_session.*`) and GA
/// (`session.*`) event families by mirroring whatever the server announces.
final class OpenAITranscribeEngine: NSObject, DictationEngine, URLSessionWebSocketDelegate, @unchecked Sendable {
    private let key: String
    private let silenceSec: Double
    private let maxSegSec: Double
    private var language = "ko"

    // client-side turn detection — gpt-live-transcribe는 서버 VAD 미지원이라
    // 앱이 무음을 감지해 input_audio_buffer.commit으로 턴을 끊는다
    private var noiseFloor: Float = 0.002
    private var speaking = false
    private var silentAccum: Double = 0
    private var turnSec: Double = 0

    private var socket: URLSessionWebSocketTask?
    private var session: URLSession?
    private var receiveTask: Task<Void, Never>?
    private var finished = false
    private var connected = false
    private var socketOpened = false
    /// most specific failure reason captured during the handshake
    private var lastError: String?

    private var converter: AVAudioConverter?
    private let targetFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24000, channels: 1, interleaved: true)!

    private var partials: [String: String] = [:]
    private let lock = NSLock()

    let onVolatile: @MainActor @Sendable (String) -> Void
    let onFinal: @MainActor @Sendable (String) -> Void
    let onError: @MainActor @Sendable (String) -> Void

    init(key: String, silence: Double, maxSeg: Double,
         onVolatile: @escaping @MainActor @Sendable (String) -> Void,
         onFinal: @escaping @MainActor @Sendable (String) -> Void,
         onError: @escaping @MainActor @Sendable (String) -> Void) {
        self.key = key
        self.silenceSec = max(0.4, silence)
        self.maxSegSec = max(5, maxSeg)
        self.onVolatile = onVolatile
        self.onFinal = onFinal
        self.onError = onError
        super.init()
    }

    // MARK: - lifecycle

    func prepare(locale: Locale,
                 progress: @escaping @MainActor @Sendable (Double) -> Void,
                 status: @escaping @MainActor @Sendable (String) -> Void) async throws {
        guard !key.isEmpty else {
            throw TranscribeError.engineFailed("OpenAI API 키가 없습니다. 설정 → AI 연결에서 입력하세요.")
        }
        language = locale.language.languageCode?.identifier ?? "ko"
        await MainActor.run { status("GPT 실시간 전사 연결 중…") }

        // NOTE: OpenAI-Beta 헤더를 붙이면 서버가 구형 베타 프로토콜(gpt-4o-transcribe,
        // 커밋 후 전사)로 응답한다 — GA(gpt-live-transcribe 실시간 델타)는 헤더 없이 연결
        var request = URLRequest(url: URL(string: "wss://api.openai.com/v1/realtime?intent=transcription")!)
        request.timeoutInterval = 15
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        let urlSession = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        session = urlSession
        let ws = urlSession.webSocketTask(with: request)
        socket = ws
        ws.resume()
        startReceiveLoop()

        // the server greets with *.created as soon as the socket is accepted
        let deadline = Date().addingTimeInterval(12)
        while !connected && !finished && lastError == nil && Date() < deadline {
            try? await Task.sleep(for: .milliseconds(100))
        }
        guard connected else {
            let reason = lastError ?? (socketOpened ? "서버 응답 없음 (시간 초과)" : "WebSocket 연결 실패 — 네트워크를 확인하세요")
            throw TranscribeError.engineFailed("GPT 실시간 전사 연결 실패 — \(reason)")
        }
        await MainActor.run {
            progress(1.0)
            status("GPT 실시간 전사 준비 완료")
            self.onVolatile(UtteranceVADEngine.listeningMarker)
        }
    }

    // MARK: WebSocket delegate — capture handshake failures precisely

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        socketOpened = true
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        let text = reason.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        if lastError == nil {
            lastError = "서버가 연결을 종료함 (코드 \(closeCode.rawValue)) \(text)"
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error, lastError == nil {
            if let http = (task.response as? HTTPURLResponse) {
                lastError = "HTTP \(http.statusCode)"
            } else {
                lastError = error.localizedDescription
            }
        }
    }

    // MARK: - events

    private func startReceiveLoop() {
        receiveTask = Task { [weak self] in
            while let self, !self.finished, let socket = self.socket {
                do {
                    let message = try await socket.receive()
                    if case .string(let text) = message {
                        self.handleEvent(text)
                    }
                } catch {
                    if self.lastError == nil {
                        self.lastError = error.localizedDescription
                    }
                    if !self.finished, self.connected {
                        await self.onError("GPT 실시간 전사 연결이 끊어졌습니다.")
                    }
                    return
                }
            }
        }
    }

    private func sendJSON(_ object: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: data, encoding: .utf8) else { return }
        socket?.send(.string(text)) { _ in }
    }

    /// send the session config matching the protocol family the server announced.
    /// gpt-live-transcribe streams deltas WHILE speaking (진짜 실시간);
    /// server VAD commits the turns. languages는 배열 필드(단수 language 금지).
    private func sendConfig(gaStyle: Bool) {
        if gaStyle {
            // turn_detection: null — 이 모델은 서버 턴 감지를 지원하지 않는다
            sendJSON([
                "type": "session.update",
                "session": [
                    "type": "transcription",
                    "audio": [
                        "input": [
                            "format": ["type": "audio/pcm", "rate": 24000],
                            "transcription": [
                                "model": "gpt-live-transcribe",
                                "languages": [language],
                                "delay": "low"
                            ],
                            "turn_detection": NSNull()
                        ]
                    ]
                ]
            ])
        } else {
            // legacy beta transcription session family
            sendJSON([
                "type": "transcription_session.update",
                "session": [
                    "input_audio_format": "pcm16",
                    "input_audio_transcription": [
                        "model": "gpt-4o-transcribe",
                        "language": language
                    ],
                    "turn_detection": [
                        "type": "server_vad",
                        "prefix_padding_ms": 300,
                        "silence_duration_ms": Int(silenceSec * 1000)
                    ]
                ]
            ])
        }
    }

    private func handleEvent(_ text: String) {
        guard let data = text.data(using: .utf8),
              let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = event["type"] as? String else { return }

        switch type {
        case "transcription_session.created":
            connected = true
            sendConfig(gaStyle: false)

        case "session.created":
            connected = true
            sendConfig(gaStyle: true)

        case "transcription_session.updated", "session.updated":
            connected = true

        case "input_audio_buffer.speech_started":
            Task { @MainActor in self.onVolatile(UtteranceVADEngine.listeningMarker) }

        case "conversation.item.input_audio_transcription.delta":
            guard let delta = event["delta"] as? String else { return }
            let itemID = event["item_id"] as? String ?? "current"
            lock.lock()
            partials[itemID, default: ""] += delta
            let current = partials[itemID] ?? ""
            lock.unlock()
            let display = current.trimmingCharacters(in: .whitespacesAndNewlines)
            if !display.isEmpty {
                Task { @MainActor in self.onVolatile(display) }
            }

        case "conversation.item.input_audio_transcription.completed":
            let itemID = event["item_id"] as? String ?? "current"
            lock.lock()
            partials[itemID] = nil
            lock.unlock()
            let transcript = (event["transcript"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            Task { @MainActor in
                if !transcript.isEmpty {
                    self.onFinal(transcript)
                }
                if !self.finished {
                    self.onVolatile(UtteranceVADEngine.listeningMarker)
                }
            }

        case "error":
            let message = ((event["error"] as? [String: Any])?["message"] as? String) ?? "알 수 없는 오류"
            if !connected {
                lastError = message
            } else if !finished {
                Task { @MainActor in self.onError("GPT 전사 오류: \(message)") }
            }

        default:
            break
        }
    }

    // MARK: - audio feed (tap thread)

    func feed(_ buffer: AVAudioPCMBuffer) {
        guard !finished, connected else { return }
        guard let pcm16 = convertToPCM16(buffer), !pcm16.isEmpty else { return }
        sendJSON([
            "type": "input_audio_buffer.append",
            "audio": pcm16.base64EncodedString()
        ])

        // client-side VAD → 무음이 이어지면 턴 커밋 (확정 전사 트리거)
        let dur = Double(buffer.frameLength) / buffer.format.sampleRate
        var rms: Float = 0
        if let data = buffer.floatChannelData?[0], buffer.frameLength > 0 {
            var sum: Float = 0
            for i in 0..<Int(buffer.frameLength) { sum += data[i] * data[i] }
            rms = sqrtf(sum / Float(buffer.frameLength))
        }
        let speechThresh = max(0.0035, noiseFloor * 2.5)

        if !speaking {
            noiseFloor = min(0.01, max(0.0015, noiseFloor * 0.97 + rms * 0.03))
            if rms >= speechThresh {
                speaking = true
                silentAccum = 0
                turnSec = 0
            }
            return
        }

        turnSec += dur
        silentAccum = rms < speechThresh * 0.8 ? silentAccum + dur : 0
        if silentAccum >= silenceSec || turnSec >= maxSegSec {
            commitTurn()
        }
    }

    private func commitTurn() {
        speaking = false
        silentAccum = 0
        turnSec = 0
        sendJSON(["type": "input_audio_buffer.commit"])
    }

    private func convertToPCM16(_ buffer: AVAudioPCMBuffer) -> Data? {
        if converter == nil || converter?.inputFormat != buffer.format {
            converter = AVAudioConverter(from: buffer.format, to: targetFormat)
        }
        guard let conv = converter else { return nil }
        let ratio = targetFormat.sampleRate / buffer.format.sampleRate
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
        guard err == nil, out.frameLength > 0, let ch = out.int16ChannelData?[0] else { return nil }
        return Data(bytes: ch, count: Int(out.frameLength) * 2)
    }

    // MARK: - teardown

    func finish() async {
        // 진행 중이던 턴을 커밋하고 마지막 확정 전사를 기다린다
        if speaking, connected {
            commitTurn()
        }
        try? await Task.sleep(for: .milliseconds(1800))
        finished = true
        receiveTask?.cancel()
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        session?.invalidateAndCancel()
        session = nil
        converter = nil
    }

    /// 16 kHz mono Float32 → 16-bit PCM WAV (REST 폴백 엔진이 사용)
    static func wavData(from samples: [Float]) -> Data {
        let sampleRate = Int(UtteranceVADEngine.sampleRate)
        var pcm = Data(capacity: samples.count * 2)
        for s in samples {
            let clamped = max(-1, min(1, s))
            var v = Int16(clamped * 32767)
            withUnsafeBytes(of: &v) { pcm.append(contentsOf: $0) }
        }
        var data = Data()
        func str(_ s: String) { data.append(s.data(using: .ascii)!) }
        func u32(_ v: UInt32) { var x = v.littleEndian; withUnsafeBytes(of: &x) { data.append(contentsOf: $0) } }
        func u16(_ v: UInt16) { var x = v.littleEndian; withUnsafeBytes(of: &x) { data.append(contentsOf: $0) } }
        str("RIFF"); u32(UInt32(36 + pcm.count)); str("WAVE")
        str("fmt "); u32(16); u16(1); u16(1)
        u32(UInt32(sampleRate)); u32(UInt32(sampleRate * 2)); u16(2); u16(16)
        str("data"); u32(UInt32(pcm.count))
        data.append(pcm)
        return data
    }
}

// MARK: - REST fallback: per-utterance upload when the realtime socket can't connect

final class OpenAIRestTranscribeEngine: UtteranceVADEngine {
    private let key: String
    private var language = "ko"

    init(key: String, silence: Double, maxSeg: Double,
         onVolatile: @escaping @MainActor @Sendable (String) -> Void,
         onFinal: @escaping @MainActor @Sendable (String) -> Void,
         onError: @escaping @MainActor @Sendable (String) -> Void) {
        self.key = key
        super.init(silence: silence, maxSeg: maxSeg, onVolatile: onVolatile, onFinal: onFinal, onError: onError)
    }

    override func prepare(locale: Locale,
                          progress: @escaping @MainActor @Sendable (Double) -> Void,
                          status: @escaping @MainActor @Sendable (String) -> Void) async throws {
        guard !key.isEmpty else {
            throw TranscribeError.engineFailed("OpenAI API 키가 없습니다. 설정 → AI 연결에서 입력하세요.")
        }
        language = locale.language.languageCode?.identifier ?? "ko"
        await MainActor.run {
            progress(1.0)
            status("GPT 전사 준비 완료 (청크 모드)")
        }
        startQueue()
    }

    override func transcribeUtterance(_ samples: [Float]) async throws -> String {
        let wav = OpenAITranscribeEngine.wavData(from: samples)
        let boundary = "dictly-\(UUID().uuidString)"
        var body = Data()
        func field(_ name: String, _ value: String) {
            body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".data(using: .utf8)!)
        }
        field("model", "gpt-4o-transcribe")
        field("language", language)
        field("response_format", "json")
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.wav\"\r\nContent-Type: audio/wav\r\n\r\n".data(using: .utf8)!)
        body.append(wav)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        var req = URLRequest(url: URL(string: "https://api.openai.com/v1/audio/transcriptions")!)
        req.httpMethod = "POST"
        req.timeoutInterval = 60
        req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.httpBody = body

        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            throw TranscribeError.engineFailed("GPT 전사 API \(code): \(String(data: data, encoding: .utf8)?.prefix(200) ?? "")")
        }
        struct Resp: Decodable { var text: String? }
        return (try? JSONDecoder().decode(Resp.self, from: data))?.text ?? ""
    }
}
