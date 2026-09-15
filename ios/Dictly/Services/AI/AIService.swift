import Foundation
import Observation

/// Routes every AI task to the engine chosen in 설정 (on-device Apple Intelligence or a cloud API),
/// mirroring the desktop `runAI` dispatch.
@MainActor
@Observable
final class AIService {
    let settings: AppSettings

    init(settings: AppSettings) {
        self.settings = settings
    }

    // MARK: backend resolution

    func backend(for engine: EngineChoice) throws -> any AIBackend {
        switch engine {
        case .apple:
            return AppleIntelligenceBackend()
        case .anthropic:
            guard let key = KeychainStore.get("anthropic"), !key.isEmpty else { throw AIError.missingKey("Anthropic") }
            return AnthropicBackend(key: key, model: settings.anthropicModel)
        case .openai:
            guard let key = KeychainStore.get("openai"), !key.isEmpty else { throw AIError.missingKey("OpenAI") }
            return OpenAIBackend(key: key, model: settings.openaiModel)
        case .gemini:
            guard let key = KeychainStore.get("gemini"), !key.isEmpty else { throw AIError.missingKey("Gemini") }
            return GeminiBackend(key: key, model: settings.geminiModel)
        case .grok:
            guard let key = KeychainStore.get("grok"), !key.isEmpty else { throw AIError.missingKey("Grok") }
            return GrokBackend(key: key, model: settings.grokModel)
        }
    }

    /// is the given engine ready to serve requests right now?
    func engineReady(_ engine: EngineChoice) -> Bool {
        switch engine {
        case .apple: AppleIntelligenceBackend.isAvailable
        case .anthropic: KeychainStore.isSet("anthropic")
        case .openai: KeychainStore.isSet("openai")
        case .gemini: KeychainStore.isSet("gemini")
        case .grok: KeychainStore.isSet("grok")
        }
    }

    /// max source-manifest characters per engine (on-device model has a ~4k-token window)
    private func manifestLimit(_ engine: EngineChoice) -> Int {
        engine == .apple ? 3500 : 120_000
    }

    /// head+tail truncation so both the opening and the latest content survive
    static func truncate(_ text: String, limit: Int) -> String {
        guard text.count > limit else { return text }
        let head = String(text.prefix(Int(Double(limit) * 0.6)))
        let tail = String(text.suffix(Int(Double(limit) * 0.35)))
        return head + "\n…(중간 생략)…\n" + tail
    }

    // MARK: - correction (live chunk + batch)

    /// 교정 결과 — clean 텍스트 + 적극 교정(지식/추론) 구간
    struct ChunkCorrection: Sendable {
        var text: String
        var spans: [CorrSpan]
    }

    /// conservative per-chunk STT correction with surrounding context (desktop claude:correctChunk).
    /// 활성 에이전트에 지식 팩이 연결돼 있으면 청크 관련 지식만 골라 주입한다(RAG-lite).
    func correctChunk(context: String, follow: String, chunk: String) async throws -> ChunkCorrection {
        let engine = settings.correctionEngine
        let backend = try backend(for: engine)

        // 지식 검색 — 프리셋 팩 + 공통 팩(숫자·단위 규칙). Apple FM 은 컨텍스트가 작아 캡 축소.
        var knowledge = ""
        if !settings.agentPresetID.isEmpty {
            let packs = [settings.agentPresetID, "cpa-common"].compactMap { KnowledgeStore.pack(id: $0) }
            let isApple = engine == .apple
            knowledge = KnowledgeRetriever.retrieve(
                packs: packs, chunk: chunk, context: context,
                maxEntries: isApple ? 4 : 8, maxChars: isApple ? 600 : 1400)
        }

        func run(knowledge: String) async throws -> String {
            let content = Prompts.correctChunkContent(
                context: String(context.suffix(1500)),
                follow: String(follow.prefix(1500)),
                chunk: chunk,
                keywords: settings.effectiveCorrectionTerms,
                knowledge: knowledge
            )
            let system = settings.agentSystemPrompt.isEmpty ? nil : settings.agentSystemPrompt
            return try await backend.complete(
                system: system,
                messages: [AIMessage(role: .user, text: Prompts.correctChunkInstruction + "\n\n" + content)],
                temperature: 0.2
            )
        }
        let out: String
        do {
            out = try await run(knowledge: knowledge)
        } catch AIError.contextOverflow where !knowledge.isEmpty {
            // Apple FM 창 초과 시 지식 없이 1회 재시도 — 기본 엔진 보호
            out = try await run(knowledge: "")
        }

        // the model must return the chunk on a single line — collapse stray newlines
        // and strip any wrapping quotes it added despite instructions
        var cleaned = out
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let openQuotes: Set<Character> = ["\"", "\u{201C}", "'", "\u{2018}", "「", "『"]
        let closeQuotes: Set<Character> = ["\"", "\u{201D}", "'", "\u{2019}", "」", "』"]
        while cleaned.count >= 2,
              let first = cleaned.first, let last = cleaned.last,
              openQuotes.contains(first), closeQuotes.contains(last) {
            cleaned = String(cleaned.dropFirst().dropLast())
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }

        // ⟦…⟧ 마커 → 스팬 오프셋 (마지막에 파싱 — 위 정리가 오프셋을 흔들지 않게).
        // 관대한 선형 스캔: 유효한 쌍만 스팬으로, 모든 마커 문자는 무조건 제거.
        var clean = ""
        var count = 0
        var spans: [CorrSpan] = []
        var openIndex: Int? = nil
        for ch in cleaned {
            if ch == "⟦" { openIndex = count; continue }
            if ch == "⟧" {
                if let s = openIndex, count > s { spans.append(CorrSpan(start: s, len: count - s)) }
                openIndex = nil
                continue
            }
            clean.append(ch)
            count += 1
        }
        assert(!clean.contains("⟦") && !clean.contains("⟧"), "마커가 저장 텍스트에 남으면 안 됨")
        guard !clean.isEmpty else { return ChunkCorrection(text: chunk, spans: []) }
        if clean == chunk { return ChunkCorrection(text: clean, spans: []) }

        // 겹침 병합 + 범위 클램프
        spans = spans
            .map { CorrSpan(start: max(0, $0.start), len: min($0.len, count - max(0, $0.start))) }
            .filter { $0.len > 0 }
            .sorted { $0.start < $1.start }
        var merged: [CorrSpan] = []
        for span in spans {
            if let last = merged.last, span.start <= last.start + last.len {
                let end = max(last.start + last.len, span.start + span.len)
                merged[merged.count - 1] = CorrSpan(start: last.start, len: end - last.start)
            } else {
                merged.append(span)
            }
        }
        return ChunkCorrection(text: clean, spans: merged)
    }

    // MARK: - studio generation

    func generate(kind: StudioKind, opts: Prompts.StudioOptions, manifest: String, multi: Bool = false, retry: Bool = false) async throws -> String {
        let engine = settings.studioEngine
        let backend = try backend(for: engine)
        var instruction = Prompts.studioInstruction(kind: kind, opts: opts, multi: multi)
        if retry { instruction += Prompts.retryTail }
        let source = Self.truncate(manifest, limit: manifestLimit(engine))
        return try await backend.complete(
            system: settings.agentSystemPrompt.isEmpty ? nil : settings.agentSystemPrompt,
            messages: [AIMessage(role: .user, text: instruction + "\n\n[소스 자료]\n" + source)],
            temperature: nil
        )
    }

    // MARK: - Feynman grading

    func feynmanGrade(manifest: String, question: String, modelAnswer: String, userAnswer: String, multi: Bool = false) async throws -> String {
        let engine = settings.studioEngine
        let backend = try backend(for: engine)
        let source = Self.truncate(manifest, limit: manifestLimit(engine))
        let content =
            "[소스 자료]\n\(source)\n\n[질문]\n\(question)\n\n[모범답안]\n\(modelAnswer)\n\n[사용자의 답변]\n\(userAnswer.isEmpty ? "(무응답)" : userAnswer)"
        return try await backend.complete(
            system: nil,
            messages: [AIMessage(role: .user, text: Prompts.feynmanGradeInstruction(multi: multi) + "\n\n" + content)],
            temperature: nil
        )
    }

    // MARK: - tutor / grounded chat turns

    func tutorTurn(content: TutorContent, manifest: String, multi: Bool = false, userText: String) async throws -> String {
        let engine = settings.studioEngine
        let backend = try backend(for: engine)
        let source = Self.truncate(manifest, limit: manifestLimit(engine))
        let system = Prompts.tutorInstruction(mode: content.mode, subject: content.subject, multi: multi)

        var messages: [AIMessage] = []
        let statePayload = TutorStatePayload(
            roadmap: content.roadmap, difficulty: content.difficulty,
            stats: content.stats, wrongNotes: content.wrongNotes, done: content.status == "done"
        )
        let stateJSON = (try? JSONEncoder().encode(statePayload)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        messages.append(AIMessage(role: .user, text: "[소스 자료]\n\(source)"))
        messages.append(AIMessage(role: .assistant, text: "소스 자료를 확인했습니다. 수업을 시작할 준비가 되었습니다."))
        for turn in content.turns {
            messages.append(AIMessage(role: turn.role == "user" ? .user : .assistant, text: turn.content))
        }
        messages.append(AIMessage(role: .user, text: "[현재 상태(STATE)]\n\(stateJSON)\n\n\(userText)"))
        return try await backend.complete(system: system, messages: messages, temperature: nil)
    }

    func chatTurn(turns: [TutorTurn], manifest: String, multi: Bool = false, userText: String) async throws -> String {
        let engine = settings.studioEngine
        let backend = try backend(for: engine)
        let source = Self.truncate(manifest, limit: manifestLimit(engine))
        var messages: [AIMessage] = [
            AIMessage(role: .user, text: "[소스 자료]\n\(source)"),
            AIMessage(role: .assistant, text: "소스 자료를 확인했습니다. 무엇이 궁금하신가요?")
        ]
        for turn in turns {
            messages.append(AIMessage(role: turn.role == "user" ? .user : .assistant, text: turn.content))
        }
        messages.append(AIMessage(role: .user, text: userText))
        return try await backend.complete(system: Prompts.groundedChatInstruction(multi: multi), messages: messages, temperature: nil)
    }

    // MARK: - 채팅 탭 (자유 대화, 모델 칩의 엔진/모델 오버라이드)

    /// 채팅 탭 전용 백엔드 — settings.chatEngine + chatModel("" = 프로바이더 기본)
    func chatBackend() throws -> any AIBackend {
        let engine = settings.chatEngine
        let override = settings.chatModel
        switch engine {
        case .apple:
            return AppleIntelligenceBackend()
        case .anthropic:
            guard let key = KeychainStore.get("anthropic"), !key.isEmpty else { throw AIError.missingKey("Anthropic") }
            return AnthropicBackend(key: key, model: override.isEmpty ? settings.anthropicModel : override)
        case .openai:
            guard let key = KeychainStore.get("openai"), !key.isEmpty else { throw AIError.missingKey("OpenAI") }
            return OpenAIBackend(key: key, model: override.isEmpty ? settings.openaiModel : override)
        case .gemini:
            guard let key = KeychainStore.get("gemini"), !key.isEmpty else { throw AIError.missingKey("Gemini") }
            return GeminiBackend(key: key, model: override.isEmpty ? settings.geminiModel : override)
        case .grok:
            guard let key = KeychainStore.get("grok"), !key.isEmpty else { throw AIError.missingKey("Grok") }
            return GrokBackend(key: key, model: override.isEmpty ? settings.grokModel : override)
        }
    }

    /// 채팅 턴 — 히스토리 + (인용 자료·첨부 파일을 포함해 미리 조립된) 마지막 사용자 메시지
    func chatComplete(history: [AIMessage], userMessage: AIMessage) async throws -> String {
        let backend = try chatBackend()
        let system = """
        당신은 학습 노트 앱 Dictly의 AI 어시스턴트입니다. 한국어로 명확하고 도움이 되게 답합니다.
        사용자가 [인용 자료]로 노트나 폴더를 첨부하면 그 내용을 근거로 답하고, 자료에 없는 내용은 일반 지식으로 보충하되 구분해 말합니다.
        마크다운(굵게, 목록, 표)과 $수식$ 표기를 사용할 수 있습니다.
        """
        return try await backend.complete(system: system, messages: history + [userMessage], temperature: nil)
    }

    /// 채팅 제목 자동 생성 (첫 메시지 후)
    func chatTitle(firstUser: String, firstAssistant: String) async throws -> String {
        let backend = try chatBackend()
        let out = try await backend.complete(
            system: nil,
            messages: [AIMessage(role: .user, text: "다음 대화의 제목을 한국어 명사구 12자 이내로 한 줄만 출력해. 따옴표·마침표 금지.\n\n사용자: \(String(firstUser.prefix(500)))\n어시스턴트: \(String(firstAssistant.prefix(500)))")],
            temperature: 0.3
        )
        return out.components(separatedBy: .newlines).first?.trimmingCharacters(in: CharacterSet(charactersIn: " \"'“”.")) ?? out
    }

    // MARK: - auto title

    func autoTitle(transcript: String) async throws -> String {
        let engine = settings.correctionEngine
        let backend = try backend(for: engine)
        let out = try await backend.complete(
            system: nil,
            messages: [AIMessage(role: .user, text: Prompts.autoTitleInstruction + "\n\n" + Self.truncate(transcript, limit: 2500))],
            temperature: 0.3
        )
        return out.components(separatedBy: .newlines).first?.trimmingCharacters(in: CharacterSet(charactersIn: " \"'“”.")) ?? out
    }
}
