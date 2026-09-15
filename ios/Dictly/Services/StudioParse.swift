import Foundation

/// Parses raw model output into typed studio content (ported from lib/studioParse.ts).
enum StudioParse {

    /// strip code fences and cut from the first `{`/`[` to the last matching `}`/`]`
    static func extractJSON(_ raw: String) -> String? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("```") {
            s = s.replacingOccurrences(of: "```json", with: "")
                .replacingOccurrences(of: "```", with: "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        guard let start = s.firstIndex(where: { $0 == "{" || $0 == "[" }) else { return nil }
        let open = s[start]
        let close: Character = open == "{" ? "}" : "]"
        guard let end = s.lastIndex(of: close), end > start else { return nil }
        return String(s[start...end])
    }

    static func decode<T: Decodable>(_ type: T.Type, from raw: String) throws -> T {
        guard let json = extractJSON(raw), let data = json.data(using: .utf8) else {
            throw AIError.parseFailure
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw AIError.parseFailure
        }
    }

    // MARK: per-kind wrappers ({"title": ..., ...fields}) → (title, stored content JSON)

    struct QuizWrapper: Decodable { var title: String?; var questions: [QuizContent.Question] }
    struct MindmapWrapper: Decodable { var title: String?; var root: MindmapNode }
    struct FlashWrapper: Decodable { var title: String?; var cards: [FlashcardsContent.Card] }
    struct TablesWrapper: Decodable { var title: String?; var tables: [TablesContent.Table] }
    struct MnemonicWrapper: Decodable { var title: String?; var items: [MnemonicContent.Item] }
    struct FeynmanWrapper: Decodable { var title: String?; var questions: [FeynmanQuestion] }
    struct RadarWrapper: Decodable { var title: String?; var nodes: [ExamRadarNode]; var edges: [ExamRadarEdge]? }

    static func encodeContent<T: Encodable>(_ value: T) -> String {
        (try? JSONEncoder().encode(value)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }

    /// parse one-shot generation output into (title, contentJSON) ready for StudioItem storage
    static func normalize(kind: StudioKind, raw: String, fallbackTitle: String) throws -> (title: String, contentJSON: String) {
        switch kind {
        case .summary:
            let md = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !md.isEmpty else { throw AIError.emptyResponse }
            var title = fallbackTitle
            if let line = md.components(separatedBy: .newlines).first(where: { $0.hasPrefix("# ") }) {
                title = String(line.dropFirst(2)).trimmingCharacters(in: .whitespaces)
            }
            return (title, encodeContent(SummaryContent(md: md)))
        case .quiz:
            if let w = try? decode(QuizWrapper.self, from: raw), !w.questions.isEmpty {
                return (w.title ?? fallbackTitle, encodeContent(QuizContent(questions: w.questions)))
            }
            // 관대한 폴백: 베어 배열 [{question...}]
            let bare = try decode([QuizContent.Question].self, from: raw)
            guard !bare.isEmpty else { throw AIError.parseFailure }
            return (fallbackTitle, encodeContent(QuizContent(questions: bare)))
        case .mindmap:
            let w = try decode(MindmapWrapper.self, from: raw)
            return (w.title ?? fallbackTitle, encodeContent(MindmapContent(root: w.root)))
        case .flashcards:
            if let w = try? decode(FlashWrapper.self, from: raw), !w.cards.isEmpty {
                return (w.title ?? fallbackTitle, encodeContent(FlashcardsContent(cards: w.cards)))
            }
            // 관대한 폴백: 베어 배열 [{front, back}]
            let bareCards = try decode([FlashcardsContent.Card].self, from: raw)
            guard !bareCards.isEmpty else { throw AIError.parseFailure }
            return (fallbackTitle, encodeContent(FlashcardsContent(cards: bareCards)))
        case .table:
            if let w = try? decode(TablesWrapper.self, from: raw), !w.tables.isEmpty {
                return (w.title ?? fallbackTitle, encodeContent(TablesContent(tables: w.tables)))
            }
            // 관대한 폴백: 표 하나만 낸 경우 {"title","headers","rows"} / 베어 배열
            if let single = try? decode(TablesContent.Table.self, from: raw), !single.rows.isEmpty {
                return (single.title.isEmpty ? fallbackTitle : single.title,
                        encodeContent(TablesContent(tables: [single])))
            }
            let bareTables = try decode([TablesContent.Table].self, from: raw)
            guard !bareTables.isEmpty else { throw AIError.parseFailure }
            return (fallbackTitle, encodeContent(TablesContent(tables: bareTables)))
        case .mnemonic:
            let w = try decode(MnemonicWrapper.self, from: raw)
            guard !w.items.isEmpty else { throw AIError.parseFailure }
            return (w.title ?? fallbackTitle, encodeContent(MnemonicContent(items: w.items)))
        case .examRadar:
            let w = try decode(RadarWrapper.self, from: raw)
            guard !w.nodes.isEmpty else { throw AIError.parseFailure }
            return (w.title ?? fallbackTitle, encodeContent(ExamRadarContent(nodes: w.nodes, edges: w.edges)))
        case .feynman:
            let w = try decode(FeynmanWrapper.self, from: raw)
            guard !w.questions.isEmpty else { throw AIError.parseFailure }
            let round = FeynmanRound(index: 0, questions: w.questions, answers: [], finalScore: nil,
                                     status: "active", createdAt: Date.now.timeIntervalSince1970, focus: nil)
            return (w.title ?? fallbackTitle, encodeContent(FeynmanContent(rounds: [round], currentRound: 0)))
        case .tutor, .chat:
            throw AIError.parseFailure // interactive kinds are created empty, not generated
        }
    }

    /// parse a Feynman review-round question list (new round appended to an existing item)
    static func feynmanQuestions(raw: String) throws -> (title: String?, questions: [FeynmanQuestion]) {
        let w = try decode(FeynmanWrapper.self, from: raw)
        guard !w.questions.isEmpty else { throw AIError.parseFailure }
        return (w.title, w.questions)
    }

    // MARK: interactive protocols

    /// `[[SCORE:87]]` on the last line of a grading reply → (feedback body, score)
    static func parseScore(_ raw: String) -> (body: String, score: Int) {
        guard let r = raw.range(of: #"\[\[SCORE:\s*(\d{1,3})\s*\]\]"#, options: [.regularExpression, .backwards]) else {
            return (raw.trimmingCharacters(in: .whitespacesAndNewlines), 50)
        }
        let token = String(raw[r])
        let digits = token.filter(\.isNumber)
        let score = min(100, max(0, Int(digits) ?? 50))
        var body = raw
        body.removeSubrange(r)
        return (body.trimmingCharacters(in: .whitespacesAndNewlines), score)
    }

    /// tutor 응답 끝의 STATE 블록 → (본문, 파싱된 상태).
    /// 모델이 [[STATE:{...}]] 대신 (STATE: {...}) 같은 변형을 내도 본문에서 제거한다.
    static func parseTutorState(_ raw: String) -> (body: String, state: TutorStatePayload?) {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let marker = trimmed.range(of: "STATE", options: .backwards) else {
            return (trimmed, nil)
        }
        // marker 뒤 첫 { 부터 중괄호 짝을 맞춰 JSON 후보를 추출
        guard let braceStart = trimmed[marker.upperBound...].firstIndex(of: "{") else {
            return (trimmed, nil)
        }
        var depth = 0
        var braceEnd: String.Index?
        var idx = braceStart
        while idx < trimmed.endIndex {
            let ch = trimmed[idx]
            if ch == "{" { depth += 1 }
            if ch == "}" {
                depth -= 1
                if depth == 0 { braceEnd = idx; break }
            }
            idx = trimmed.index(after: idx)
        }
        guard let braceEnd else { return (trimmed, nil) }
        let jsonPart = String(trimmed[braceStart...braceEnd])

        // 본문 = marker 앞까지, 앞쪽에 붙은 여는 괄호류([ [ ( 등)도 함께 제거
        var body = String(trimmed[..<marker.lowerBound])
        while let last = body.last, last == "[" || last == "(" || last == "{" || last.isWhitespace {
            body.removeLast()
        }
        body = body.trimmingCharacters(in: .whitespacesAndNewlines)

        let state = jsonPart.data(using: .utf8).flatMap { try? JSONDecoder().decode(TutorStatePayload.self, from: $0) }
        return (body.isEmpty ? trimmed : body, state)
    }

    /// weighted-average Feynman round score
    static func weightedScore(_ round: FeynmanRound) -> Int {
        guard !round.answers.isEmpty else { return 0 }
        var total = 0.0, weightSum = 0.0
        for (i, a) in round.answers.enumerated() {
            let w = Double(i < round.questions.count ? (round.questions[i].weight ?? 1) : 1)
            total += Double(a.score) * w
            weightSum += w
        }
        return weightSum > 0 ? Int((total / weightSum).rounded()) : 0
    }

    /// weak-area summary that seeds a Feynman review round (desktop reviewFocus)
    static func reviewFocus(from round: FeynmanRound) -> String {
        var lines: [String] = []
        for (i, a) in round.answers.enumerated() where a.score < 70 && i < round.questions.count {
            let q = round.questions[i]
            lines.append("- (\(a.score)점) \(q.question.prefix(120))")
        }
        if lines.isEmpty { return "전반적으로 우수했음 — 더 어려운 응용·종합 질문으로 검증할 것" }
        return lines.joined(separator: "\n")
    }

    /// blend AI importance 50/50 with a transcript airtime/mention signal (desktop exam_radar behavior)
    static func blendExamRadar(_ content: ExamRadarContent, segments: [MemoSegment]) -> ExamRadarContent {
        guard !segments.isEmpty else { return content }
        let totalDur = max(1, segments.reduce(0.0) { $0 + max(0, $1.tEnd - $1.tStart) })
        var out = content
        var signals: [Double] = []
        for node in out.nodes {
            var terms = [node.label]
            terms += node.aliases ?? []
            let cleaned = terms.map { $0.replacingOccurrences(of: #"\$[^$]*\$"#, with: "", options: .regularExpression) }
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { $0.count >= 2 }
            var airtime = 0.0
            var mentions = 0
            for seg in segments {
                if cleaned.contains(where: { seg.text.localizedCaseInsensitiveContains($0) }) {
                    airtime += max(0, seg.tEnd - seg.tStart)
                    mentions += 1
                }
            }
            signals.append(airtime / totalDur * 70 + min(30, Double(mentions) * 3))
        }
        let maxSignal = max(1, signals.max() ?? 1)
        for i in out.nodes.indices {
            let normalized = signals[i] / maxSignal * 100
            out.nodes[i].importance = (out.nodes[i].importance + normalized) / 2
        }
        return out
    }
}
