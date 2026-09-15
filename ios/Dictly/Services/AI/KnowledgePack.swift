import Foundation

/// 과목별 지식 팩 — 번들 JSON(KP-<id>.json)로 배포되는 전사 교정용 도메인 지식.
/// 통짜 시스템 프롬프트 대신, 교정 호출마다 청크와 관련된 항목만 골라 주입한다(RAG-lite).
struct KnowledgePack: Decodable {
    struct Entry: Decodable {
        let type: String          // "formula" | "confusion" | "concept" | "term"
        let topic: String?        // 세법의 세목 구분 등 (선택)
        let title: String
        let keys: [String]        // 전사 표면형 트리거 (오인식 변형 포함)
        let body: String          // ≤160자 — 교정 판단에 필요한 최소 지식

        var typeLabel: String {
            switch type {
            case "formula": "수식"
            case "confusion": "혼동"
            case "concept": "개념"
            default: "용어"
            }
        }
    }

    let schema: Int
    let id: String
    let subject: String
    let displayName: String
    let version: Int
    let systemPrompt: String
    let terms: String             // Agent.correctionKeywords 프리필용
    let mathRules: String         // Agent.mathRulesText 프리필용
    let replacements: String      // Agent.replacementsText 프리필용
    let knowledge: [Entry]

    var countSummary: String {
        func count(_ type: String) -> Int { knowledge.filter { $0.type == type }.count }
        return "수식 \(count("formula")) · 혼동 \(count("confusion")) · 개념 \(count("concept"))"
    }
}

/// 번들에서 팩을 로드·캐시한다. 실패한 id 는 nil 로 캐시해 청크마다 재시도하지 않는다.
@MainActor
enum KnowledgeStore {
    private static var cache: [String: KnowledgePack?] = [:]

    static func pack(id: String) -> KnowledgePack? {
        if let cached = cache[id] { return cached }
        // 동기화 그룹 리소스는 번들 루트로 평탄화된다 — 이름으로만 찾는다
        let loaded: KnowledgePack?
        if let url = Bundle.main.url(forResource: "KP-\(id)", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let pack = try? JSONDecoder().decode(KnowledgePack.self, from: data) {
            loaded = pack
        } else {
            loaded = nil
        }
        cache[id] = loaded
        return loaded
    }
}

/// 교정 시점 지식 검색 — 청크(+앞맥락 꼬리)와 키 매칭으로 관련 항목만 고른다.
enum KnowledgeRetriever {
    /// 관련 항목을 `- (수식) 제목: 본문` 줄들로 렌더한 [지식] 블록 본문. 무매치면 "".
    static func retrieve(packs: [KnowledgePack], chunk: String, context: String,
                         maxEntries: Int, maxChars: Int) -> String {
        let normChunk = normalize(chunk)
        let normContext = normalize(String(context.suffix(300)))
        guard !normChunk.isEmpty else { return "" }

        struct Scored { let entry: KnowledgePack.Entry; let score: Int; let keyLen: Int; let order: Int }
        var scored: [Scored] = []
        var order = 0
        for pack in packs {
            for entry in pack.knowledge {
                var score = 0
                var bestKey = 0
                for key in entry.keys {
                    let normKey = normalize(key)
                    guard normKey.count >= 2 else { continue }
                    if normChunk.contains(normKey) {
                        score = max(score, 3)
                        bestKey = max(bestKey, normKey.count)
                    } else if normContext.contains(normKey) {
                        score = max(score, 1)
                        bestKey = max(bestKey, normKey.count)
                    }
                }
                if score > 0 {
                    scored.append(Scored(entry: entry, score: score, keyLen: bestKey, order: order))
                }
                order += 1
            }
        }
        guard !scored.isEmpty else { return "" }

        scored.sort {
            if $0.score != $1.score { return $0.score > $1.score }
            if $0.keyLen != $1.keyLen { return $0.keyLen > $1.keyLen }
            return $0.order < $1.order
        }

        var lines: [String] = []
        var chars = 0
        for item in scored.prefix(maxEntries) {
            let line = "- (\(item.entry.typeLabel)) \(item.entry.title): \(item.entry.body)"
            if chars + line.count > maxChars { break }
            lines.append(line)
            chars += line.count
        }
        return lines.joined(separator: "\n")
    }

    private static func normalize(_ s: String) -> String {
        s.lowercased().replacingOccurrences(of: " ", with: "")
    }
}

/// CPA 프리셋 카탈로그 — 프리셋 에이전트 생성의 단일 소스
@MainActor
enum PresetCatalog {
    /// 사용자에게 노출되는 7과목 (cpa-common 은 상시 자동 주입이라 비노출)
    static let all: [(packID: String, subject: String)] = [
        ("cpa-financial-accounting", "재무회계"),
        ("cpa-financial-management", "재무관리"),
        ("cpa-tax", "세법"),
        ("cpa-cost-accounting", "원가관리회계"),
        ("cpa-management", "경영학"),
        ("cpa-corporate-law", "기업법"),
        ("cpa-economics", "경제학"),
    ]

    static func makeAgent(packID: String) -> Agent? {
        guard let pack = KnowledgeStore.pack(id: packID) else { return nil }
        let agent = Agent(name: pack.displayName)
        agent.correctionKeywords = pack.terms
        agent.mathRulesText = pack.mathRules
        agent.replacementsText = pack.replacements
        agent.systemPrompt = pack.systemPrompt
        agent.presetID = pack.id
        return agent
    }
}
