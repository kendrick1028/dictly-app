import Foundation

struct AIMessage: Sendable, Hashable {
    enum Role: String, Sendable { case user, assistant }
    var role: Role
    var text: String
    /// 첨부 이미지 (JPEG 데이터) — API 엔진만 지원, Apple 온디바이스는 거부
    var images: [Data] = []
}

enum AIError: LocalizedError {
    case missingKey(String)
    case http(Int, String)
    case emptyResponse
    case appleUnavailable(String)
    case contextOverflow
    case guardrail
    case parseFailure

    var errorDescription: String? {
        switch self {
        case .missingKey(let provider):
            "\(provider) API 키가 없습니다. 설정 탭에서 입력하세요."
        case .http(let code, let body):
            "API 오류 \(code): \(String(body.prefix(300)))"
        case .emptyResponse:
            "AI 응답이 비어 있습니다."
        case .appleUnavailable(let reason):
            "Apple Intelligence를 사용할 수 없습니다 — \(reason)"
        case .contextOverflow:
            "내용이 온디바이스 모델의 컨텍스트 한도를 넘었습니다. 설정에서 API 엔진으로 바꾸면 전체 내용을 처리할 수 있습니다."
        case .guardrail:
            "온디바이스 모델이 이 내용의 처리를 거부했습니다. API 엔진을 사용해 보세요."
        case .parseFailure:
            "AI 출력 형식을 해석하지 못했습니다. 다시 시도해 주세요."
        }
    }
}

/// one AI completion backend (on-device Apple Intelligence or a cloud API)
protocol AIBackend: Sendable {
    /// system + multi-turn messages → assistant text
    func complete(system: String?, messages: [AIMessage], temperature: Double?) async throws -> String
}

// MARK: - shared HTTP plumbing

func postJSON(url: URL, headers: [String: String], body: [String: Any]) async throws -> Data {
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.timeoutInterval = 180
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
    req.httpBody = try JSONSerialization.data(withJSONObject: body)
    let (data, resp) = try await URLSession.shared.data(for: req)
    let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(code) else {
        throw AIError.http(code, String(data: data, encoding: .utf8) ?? "")
    }
    return data
}

// MARK: - Anthropic (mirrors apiClients.ts runAnthropic)

struct AnthropicBackend: AIBackend {
    let key: String
    let model: String

    func complete(system: String?, messages: [AIMessage], temperature: Double?) async throws -> String {
        guard !key.isEmpty else { throw AIError.missingKey("Anthropic") }
        var body: [String: Any] = [
            "model": model,
            "max_tokens": 8192,
            "messages": messages.map { msg -> [String: Any] in
                guard !msg.images.isEmpty else {
                    return ["role": msg.role.rawValue, "content": msg.text]
                }
                var blocks: [[String: Any]] = msg.images.map {
                    ["type": "image",
                     "source": ["type": "base64", "media_type": "image/jpeg", "data": $0.base64EncodedString()]]
                }
                blocks.append(["type": "text", "text": msg.text])
                return ["role": msg.role.rawValue, "content": blocks]
            }
        ]
        if let system { body["system"] = system }
        if let temperature { body["temperature"] = temperature }
        let data = try await postJSON(
            url: URL(string: "https://api.anthropic.com/v1/messages")!,
            headers: ["x-api-key": key, "anthropic-version": "2023-06-01"],
            body: body
        )
        struct Resp: Decodable {
            struct Block: Decodable { var text: String? }
            var content: [Block]?
        }
        let r = try JSONDecoder().decode(Resp.self, from: data)
        let text = (r.content ?? []).compactMap(\.text).joined().trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw AIError.emptyResponse }
        return text
    }
}

// MARK: - OpenAI (mirrors apiClients.ts runOpenAi)

struct OpenAIBackend: AIBackend {
    let key: String
    let model: String

    func complete(system: String?, messages: [AIMessage], temperature: Double?) async throws -> String {
        guard !key.isEmpty else { throw AIError.missingKey("OpenAI") }
        var msgs: [[String: Any]] = []
        if let system { msgs.append(["role": "system", "content": system]) }
        msgs += messages.map { msg -> [String: Any] in
            let role = msg.role == .user ? "user" : "assistant"
            guard !msg.images.isEmpty else { return ["role": role, "content": msg.text] }
            var parts: [[String: Any]] = msg.images.map {
                ["type": "image_url",
                 "image_url": ["url": "data:image/jpeg;base64,\($0.base64EncodedString())"]]
            }
            parts.append(["type": "text", "text": msg.text])
            return ["role": role, "content": parts]
        }
        // NOTE: no temperature/max_tokens — newer gpt-5.x models reject non-default values
        let body: [String: Any] = ["model": model, "messages": msgs]
        let data = try await postJSON(
            url: URL(string: "https://api.openai.com/v1/chat/completions")!,
            headers: ["Authorization": "Bearer \(key)"],
            body: body
        )
        struct Resp: Decodable {
            struct Choice: Decodable {
                struct Msg: Decodable { var content: String? }
                var message: Msg?
            }
            var choices: [Choice]?
        }
        let r = try JSONDecoder().decode(Resp.self, from: data)
        let text = (r.choices?.first?.message?.content ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw AIError.emptyResponse }
        return text
    }
}

// MARK: - Grok (xAI — OpenAI 호환 chat/completions)

struct GrokBackend: AIBackend {
    let key: String
    let model: String

    func complete(system: String?, messages: [AIMessage], temperature: Double?) async throws -> String {
        guard !key.isEmpty else { throw AIError.missingKey("Grok") }
        var msgs: [[String: Any]] = []
        if let system { msgs.append(["role": "system", "content": system]) }
        msgs += messages.map { msg -> [String: Any] in
            let role = msg.role == .user ? "user" : "assistant"
            guard !msg.images.isEmpty else { return ["role": role, "content": msg.text] }
            var parts: [[String: Any]] = msg.images.map {
                ["type": "image_url",
                 "image_url": ["url": "data:image/jpeg;base64,\($0.base64EncodedString())"]]
            }
            parts.append(["type": "text", "text": msg.text])
            return ["role": role, "content": parts]
        }
        var body: [String: Any] = ["model": model, "messages": msgs]
        if let temperature { body["temperature"] = temperature }
        let data = try await postJSON(
            url: URL(string: "https://api.x.ai/v1/chat/completions")!,
            headers: ["Authorization": "Bearer \(key)"],
            body: body
        )
        struct Resp: Decodable {
            struct Choice: Decodable {
                struct Msg: Decodable { var content: String? }
                var message: Msg?
            }
            var choices: [Choice]?
        }
        let r = try JSONDecoder().decode(Resp.self, from: data)
        let text = (r.choices?.first?.message?.content ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw AIError.emptyResponse }
        return text
    }
}

// MARK: - Gemini (mirrors apiClients.ts runGemini)

struct GeminiBackend: AIBackend {
    let key: String
    let model: String

    func complete(system: String?, messages: [AIMessage], temperature: Double?) async throws -> String {
        guard !key.isEmpty else { throw AIError.missingKey("Gemini") }
        var body: [String: Any] = [
            "contents": messages.map { msg -> [String: Any] in
                var parts: [[String: Any]] = msg.images.map {
                    ["inline_data": ["mime_type": "image/jpeg", "data": $0.base64EncodedString()]]
                }
                parts.append(["text": msg.text])
                return ["role": msg.role == .user ? "user" : "model", "parts": parts]
            }
        ]
        if let system { body["systemInstruction"] = ["parts": [["text": system]]] }
        if let temperature { body["generationConfig"] = ["temperature": temperature] }
        let url = URL(string: "https://generativelanguage.googleapis.com/v1beta/models/\(model.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? model):generateContent?key=\(key.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? key)")!
        let data = try await postJSON(url: url, headers: [:], body: body)
        struct Resp: Decodable {
            struct Cand: Decodable {
                struct Content: Decodable {
                    struct Part: Decodable { var text: String? }
                    var parts: [Part]?
                }
                var content: Content?
            }
            var candidates: [Cand]?
        }
        let r = try JSONDecoder().decode(Resp.self, from: data)
        let text = (r.candidates?.first?.content?.parts ?? []).compactMap(\.text).joined().trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw AIError.emptyResponse }
        return text
    }
}
