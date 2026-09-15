import Foundation
import FoundationModels

/// On-device Apple Intelligence via the FoundationModels framework (iOS 26+).
/// Multi-turn histories are flattened into a single prompt so one code path
/// serves both one-shot generation and conversational features.
struct AppleIntelligenceBackend: AIBackend {

    static var availabilityDescription: String {
        switch SystemLanguageModel.default.availability {
        case .available:
            return "사용 가능"
        case .unavailable(let reason):
            switch reason {
            case .deviceNotEligible:
                return "이 기기는 Apple Intelligence를 지원하지 않습니다"
            case .appleIntelligenceNotEnabled:
                return "설정 앱에서 Apple Intelligence를 켜주세요"
            case .modelNotReady:
                return "모델 준비 중입니다 — 잠시 후 다시 시도하세요"
            @unknown default:
                return "사용할 수 없습니다"
            }
        }
    }

    static var isAvailable: Bool {
        if case .available = SystemLanguageModel.default.availability { return true }
        return false
    }

    func complete(system: String?, messages: [AIMessage], temperature: Double?) async throws -> String {
        guard Self.isAvailable else {
            throw AIError.appleUnavailable(Self.availabilityDescription)
        }
        guard messages.allSatisfy({ $0.images.isEmpty }) else {
            throw AIError.appleUnavailable("이미지 입력은 API 엔진(Claude·GPT·Gemini)에서만 지원됩니다")
        }

        let prompt: String
        if messages.count == 1, let only = messages.first {
            prompt = only.text
        } else {
            // flatten prior turns; the last user message stays the live question
            var lines: [String] = ["[지금까지의 대화]"]
            for m in messages.dropLast() {
                lines.append((m.role == .user ? "학습자: " : "선생님: ") + m.text)
            }
            if let last = messages.last {
                lines.append("\n[학습자의 새 메시지]\n\(last.text)")
            }
            lines.append("\n위 대화에 이어서 선생님으로서 답하세요.")
            prompt = lines.joined(separator: "\n")
        }

        let session: LanguageModelSession
        if let system, !system.isEmpty {
            session = LanguageModelSession(instructions: system)
        } else {
            session = LanguageModelSession()
        }

        do {
            var options = GenerationOptions()
            if let temperature { options = GenerationOptions(temperature: temperature) }
            // 기본 응답 한도가 짧아 카드/표 생성이 중간에 잘리는 것 방지
            options.maximumResponseTokens = 4096
            let response = try await session.respond(to: prompt, options: options)
            let text = response.content.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { throw AIError.emptyResponse }
            return text
        } catch let e as LanguageModelSession.GenerationError {
            switch e {
            case .exceededContextWindowSize:
                throw AIError.contextOverflow
            case .guardrailViolation:
                throw AIError.guardrail
            default:
                throw AIError.appleUnavailable(e.localizedDescription)
            }
        }
    }
}
