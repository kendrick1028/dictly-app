import Foundation
import SwiftData

// MARK: - SwiftData models (mirrors the desktop SQLite schema: folders / memos / segments / studio_items)

@Model
final class Folder {
    var name: String
    var createdAt: Date
    var favorite: Bool
    @Relationship(deleteRule: .nullify, inverse: \Memo.folder)
    var memos: [Memo]? = []

    init(name: String) {
        self.name = name
        self.createdAt = .now
        self.favorite = false
    }
}

@Model
final class Memo {
    @Attribute(.unique) var uuid: UUID
    var title: String
    var createdAt: Date
    var durationSec: Double
    /// file name inside the app's Recordings directory (nil = no audio)
    var audioFileName: String?
    /// BCP-47 locale the recording was transcribed with (e.g. "ko-KR")
    var language: String
    var favorite: Bool
    var segments: [MemoSegment]
    var folder: Folder?
    @Relationship(deleteRule: .cascade, inverse: \StudioItem.memo)
    var studioItems: [StudioItem]? = []
    /// 폴더 스튜디오 항목들이 이 노트를 소스로 참조 (inverse of StudioItem.sources)
    var referencedByStudioItems: [StudioItem]? = []

    init(title: String, durationSec: Double, audioFileName: String?, language: String, segments: [MemoSegment]) {
        self.uuid = UUID()
        self.title = title
        self.createdAt = .now
        self.durationSec = durationSec
        self.audioFileName = audioFileName
        self.language = language
        self.favorite = false
        self.segments = segments
    }

    var transcriptText: String { segments.map(\.text).joined(separator: "\n") }
    var hasCorrections: Bool { segments.contains { $0.origText != nil } }

    var audioURL: URL? {
        guard let name = audioFileName else { return nil }
        return AppPaths.recordingsDir.appendingPathComponent(name)
    }

    /// `[t:초]` cite-token manifest — same source format the desktop studio prompts consume
    var manifest: String {
        segments.map { "[t:\(Int($0.tStart))] \($0.text)" }.joined(separator: "\n")
    }
}

/// one finalized transcription chunk (value type stored inside Memo)
/// 지식·추론 기반 적극 교정 구간 — clean text 의 Character 오프셋 (파란 표시용)
struct CorrSpan: Codable, Hashable {
    var start: Int
    var len: Int
}

struct MemoSegment: Codable, Hashable, Identifiable {
    var id: UUID = UUID()
    var tStart: Double
    var tEnd: Double
    var text: String
    /// pre-correction backup; nil = never corrected
    var origText: String?
    /// 적극 교정(지식/추론) 구간 — 파란색 표시, 영구 저장 (옵셔널이라 기존 노트 디코드 무영향)
    var corrSpans: [CorrSpan]?
}

@Model
final class StudioItem {
    var kindRaw: String
    var title: String
    /// generated payload, JSON- or markdown-encoded depending on kind
    var contentJSON: String
    var createdAt: Date
    /// legacy single-memo scope (구버전 항목)
    var memo: Memo?
    /// folder scope — 폴더 스튜디오에서 생성된 항목의 소속 폴더 (미분류 = nil)
    var folder: Folder?
    /// 선택된 소스 노트들 (폴더 스튜디오)
    @Relationship(inverse: \Memo.referencedByStudioItems)
    var sources: [Memo]? = []

    init(kind: StudioKind, title: String, contentJSON: String, memo: Memo?) {
        self.kindRaw = kind.rawValue
        self.title = title
        self.contentJSON = contentJSON
        self.createdAt = .now
        self.memo = memo
    }

    var kind: StudioKind { StudioKind(rawValue: kindRaw) ?? .summary }

    /// 소스 노트 목록 (다중 소스 우선, 없으면 구버전 단일 memo)
    var sourceMemos: [Memo] {
        if let sources, !sources.isEmpty {
            return sources.sorted { $0.createdAt < $1.createdAt }
        }
        if let memo { return [memo] }
        return []
    }

    var isMultiSource: Bool { sourceMemos.count > 1 }

    /// 결합 매니페스트 — 다중 소스는 [t:노트번호:초] 토큰 (데스크톱 folder studio 형식)
    var combinedManifest: String {
        let memos = sourceMemos
        guard !memos.isEmpty else { return "" }
        if memos.count == 1 { return memos[0].manifest }
        return memos.enumerated().map { index, memo in
            let n = index + 1
            let lines = memo.segments
                .map { "[t:\(n):\(Int($0.tStart))] \($0.text)" }
                .joined(separator: "\n")
            return "[노트 \(n)] \(memo.title)\n\(lines)"
        }.joined(separator: "\n\n")
    }
}

// MARK: - 시간표

/// 학기 단위 시간표 — 수업은 이 중 하나에 속한다 (소속 없는 기존 수업 = nil)
@Model
final class Timetable {
    @Attribute(.unique) var uuid: UUID
    var name: String
    var createdAt: Date
    /// 학기 시작일 — 주차 계산과 알림 기간의 기준 (nil = 미설정)
    var startDate: Date?
    /// 학기 종료일 — 이 날까지만 수업 알림이 온다
    var endDate: Date?

    @Relationship(deleteRule: .cascade, inverse: \TimetableClass.timetable)
    var classes: [TimetableClass]?

    init(name: String) {
        self.uuid = UUID()
        self.name = name
        self.createdAt = .now
    }
}

@Model
final class TimetableClass {
    var title: String
    var room: String
    var professor: String
    /// 0 = 월 … 4 = 금
    var weekday: Int
    /// 시작 시각 (9~17)
    var startHour: Int
    /// 지속 시간 (시간 단위, 1~)
    var durationHours: Int
    /// 파스텔 팔레트 인덱스
    var colorIndex: Int
    var createdAt: Date
    /// 소속 학기 시간표 (마이그레이션 전 기존 수업은 nil)
    var timetable: Timetable?
    /// 과목명 폴더를 만들지 여부 — 끄면 폴더도 안 만들고 알림도 오지 않는다
    var createsFolder: Bool = true

    init(title: String, room: String, professor: String, weekday: Int, startHour: Int, durationHours: Int = 1, colorIndex: Int = 0) {
        self.title = title
        self.room = room
        self.professor = professor
        self.weekday = weekday
        self.startHour = startHour
        self.durationHours = durationHours
        self.colorIndex = colorIndex
        self.createdAt = .now
    }
}

// MARK: - 채팅 탭 (자유 대화 + 노트/폴더 인용)

@Model
final class ChatThread {
    @Attribute(.unique) var uuid: UUID
    var title: String
    var createdAt: Date
    var updatedAt: Date
    @Relationship(deleteRule: .cascade, inverse: \ChatMsg.thread)
    var messages: [ChatMsg]? = []

    init(title: String = "새 대화") {
        self.uuid = UUID()
        self.title = title
        self.createdAt = .now
        self.updatedAt = .now
    }

    var sortedMessages: [ChatMsg] {
        (messages ?? []).sorted { $0.createdAt < $1.createdAt }
    }
}

@Model
final class ChatMsg {
    @Attribute(.unique) var uuid: UUID
    var role: String // "user" | "assistant"
    var text: String
    var createdAt: Date
    var thread: ChatThread?
    /// 인용한 노트/폴더 목록 JSON ([ChatRef])
    var refsJSON: String
    /// 첨부 이미지 파일명들 (Application Support/ChatImages)
    var imageNames: [String]
    /// 첨부 파일(추출 텍스트 포함) JSON ([ChatFile])
    var filesJSON: String

    init(role: String, text: String, refs: [ChatRef] = [], imageNames: [String] = [], files: [ChatFile] = []) {
        self.uuid = UUID()
        self.role = role
        self.text = text
        self.createdAt = .now
        self.refsJSON = ChatRef.encode(refs)
        self.imageNames = imageNames
        self.filesJSON = ChatFile.encode(files)
    }

    var refs: [ChatRef] { ChatRef.decode(refsJSON) }
    var files: [ChatFile] { ChatFile.decode(filesJSON) }
}

/// @멘션/첨부로 인용한 노트 또는 폴더
struct ChatRef: Codable, Hashable, Identifiable {
    var kind: String // "memo" | "folder"
    var uuid: UUID
    var name: String
    var id: UUID { uuid }
    var isFolder: Bool { kind == "folder" }

    static func encode(_ refs: [ChatRef]) -> String {
        (try? JSONEncoder().encode(refs)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
    }
    static func decode(_ json: String) -> [ChatRef] {
        (try? JSONDecoder().decode([ChatRef].self, from: Data(json.utf8))) ?? []
    }
}

/// 메시지 본문 속 인용 토큰 마커 — 입력 필드의 첨부 토큰을 텍스트로 직렬화/복원한다
enum ChatTokenMarker {
    static func marker(for ref: ChatRef) -> String {
        "⟦\(ref.isFolder ? "F" : "N")|\(ref.name)⟧"
    }

    static let regex = try! NSRegularExpression(pattern: "⟦([FN])\\|([^⟧]*)⟧")

    /// 마커를 이름으로 치환한 순수 텍스트 (AI 전송·목록 미리보기용)
    static func plain(_ text: String) -> String {
        guard text.contains("⟦") else { return text }
        let ns = text as NSString
        var out = ""
        var last = 0
        for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            out += ns.substring(with: NSRange(location: last, length: match.range.location - last))
            out += ns.substring(with: match.range(at: 2))
            last = match.range.location + match.range.length
        }
        out += ns.substring(from: last)
        return out
    }
}

/// 첨부 파일 — 전송 시 텍스트를 추출해 담는다 (PDF/텍스트 계열)
struct ChatFile: Codable, Hashable, Identifiable {
    var name: String
    var text: String
    var id: String { name + "\(text.count)" }

    static func encode(_ files: [ChatFile]) -> String {
        (try? JSONEncoder().encode(files)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
    }
    static func decode(_ json: String) -> [ChatFile] {
        (try? JSONDecoder().decode([ChatFile].self, from: Data(json.utf8))) ?? []
    }
}

// MARK: - Agent (desktop parity: per-subject transcription/correction profile)

@Model
final class Agent {
    @Attribute(.unique) var uuid: UUID
    var name: String
    /// deprecated — 용어 사전으로 통합됨 (correctionKeywords 로 1회 병합 후 비움; 저장소 호환용 유지)
    var keywords: String
    /// terms injected into the live-correction prompt
    var correctionKeywords: String
    /// "발음=기호" per line (desktop mathRules)
    var mathRulesText: String
    /// "오인식=정정" per line (desktop replacements) — applied to every final chunk
    var replacementsText: String
    /// system prompt for correction/summary AI calls
    var systemPrompt: String
    var createdAt: Date
    /// 연결된 지식 팩 id (KP-<id>.json) — 프리셋 에이전트만 값이 있다
    var presetID: String?

    init(name: String) {
        self.uuid = UUID()
        self.name = name
        self.keywords = ""
        self.correctionKeywords = ""
        self.mathRulesText = ""
        self.replacementsText = ""
        self.systemPrompt = ""
        self.createdAt = .now
    }

    /// parse "a=b" lines into ordered pairs
    static func parsePairs(_ text: String) -> [(String, String)] {
        text.components(separatedBy: .newlines).compactMap { line in
            let parts = line.split(separator: "=", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
            guard parts.count == 2, !parts[0].isEmpty, !parts[1].isEmpty else { return nil }
            return (parts[0], parts[1])
        }
    }
}

// MARK: - App file locations

enum AppPaths {
    static var recordingsDir: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("Recordings", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    /// 채팅 첨부 이미지 저장소
    static var chatImagesDir: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("ChatImages", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
}

// MARK: - Studio content payloads (ported from src/shared/types.ts)

struct SummaryContent: Codable { var md: String }

struct QuizContent: Codable {
    struct Question: Codable, Hashable {
        var type: String // "verbal" | "calc" | "ox" (+legacy "mc"/"short")
        var question: String
        var options: [String]?
        var answer: String
        var explanation: String?
    }
    var questions: [Question]
}

struct MindmapNode: Codable, Hashable {
    var label: String
    var children: [MindmapNode]?
}
struct MindmapContent: Codable { var root: MindmapNode }

struct FlashcardsContent: Codable {
    struct Card: Codable, Hashable { var front: String; var back: String }
    var cards: [Card]
}

struct TablesContent: Codable {
    struct Table: Codable, Hashable {
        var title: String
        var headers: [String]
        var rows: [[String]]
    }
    var tables: [Table]
}

struct MnemonicContent: Codable {
    struct Item: Codable, Hashable {
        var concept: String
        var technique: String
        var mnemonic: String
        var explanation: String
    }
    var items: [Item]
}

// Feynman review (interactive, scored, resumable rounds)
struct FeynmanQuestion: Codable, Hashable {
    var id: String
    var stage: String?
    var question: String
    var modelAnswer: String
    var weight: Int?
}
struct FeynmanAnswer: Codable, Hashable {
    var userAnswer: String
    var score: Int
    var feedback: String
}
struct FeynmanRound: Codable, Hashable {
    var index: Int
    var questions: [FeynmanQuestion]
    var answers: [FeynmanAnswer]
    var finalScore: Int?
    var status: String // "active" | "done"
    var createdAt: Double
    var focus: String?
}
struct FeynmanContent: Codable {
    var rounds: [FeynmanRound]
    var currentRound: Int
}

// AI 튜터 (conversational, [[STATE:{...}]] protocol)
struct TutorRoadmapItem: Codable, Hashable {
    var id: String
    var label: String
    var status: String // "pending" | "active" | "done"
    var understanding: Int?
}
struct TutorTurn: Codable, Hashable {
    var role: String // "user" | "assistant"
    var content: String
    var createdAt: Double
}
struct TutorStats: Codable, Hashable {
    var asked: Int = 0
    var correct: Int = 0
    var partial: Int = 0
    var wrong: Int = 0
}
struct TutorWrongNote: Codable, Hashable {
    var concept: String
    var problem: String
    var cause: String
    var correct: String
    var repeated: Bool?
}
struct TutorContent: Codable {
    var mode: String // "learn" | "sprint"
    var subject: String
    var roadmap: [TutorRoadmapItem]
    var turns: [TutorTurn]
    var difficulty: String
    var stats: TutorStats
    var wrongNotes: [TutorWrongNote]
    var status: String // "active" | "done"
}
/// the [[STATE:{...}]] payload appended to every tutor reply
struct TutorStatePayload: Codable {
    var roadmap: [TutorRoadmapItem]?
    var difficulty: String?
    var stats: TutorStats?
    var wrongNotes: [TutorWrongNote]?
    var done: Bool?
}

// 시험 레이더 (importance × difficulty concept map)
struct ExamRadarNode: Codable, Hashable {
    var id: String
    var label: String
    var importance: Double
    var difficulty: Double
    var level: Int?
    var parentId: String?
    var explanation: String?
    var aliases: [String]?
}
struct ExamRadarEdge: Codable, Hashable { var from: String; var to: String }
struct ExamRadarContent: Codable {
    var nodes: [ExamRadarNode]
    var edges: [ExamRadarEdge]?
}

// grounded Q&A chat over the memo sources
struct ChatContent: Codable {
    var turns: [TutorTurn]
}
