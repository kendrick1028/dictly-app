import SwiftUI

/// Studio feature registry — mirrors the desktop `studioMeta.tsx`
enum StudioKind: String, CaseIterable, Identifiable, Codable {
    case summary
    case tutor
    case feynman
    case examRadar = "exam_radar"
    case quiz
    case mindmap
    case flashcards
    case table
    case mnemonic
    case chat

    var id: String { rawValue }

    var name: String {
        switch self {
        case .summary: "요약"
        case .tutor: "AI 튜터"
        case .feynman: "파인만 복습"
        case .examRadar: "시험 레이더"
        case .quiz: "퀴즈"
        case .mindmap: "마인드맵"
        case .flashcards: "플래시카드"
        case .table: "테이블"
        case .mnemonic: "암기노트"
        case .chat: "질문 채팅"
        }
    }

    var subtitle: String {
        switch self {
        case .summary: "핵심 정리 문서"
        case .tutor: "1:1 대화형 과외"
        case .feynman: "말로 설명하며 검증"
        case .examRadar: "중요도×난이도 지도"
        case .quiz: "말문제·계산·OX"
        case .mindmap: "주제별 개요 트리"
        case .flashcards: "앞뒤 암기 카드"
        case .table: "비교·정리 표"
        case .mnemonic: "앞글자·스토리 암기법"
        case .chat: "소스 근거 Q&A"
        }
    }

    var icon: String {
        switch self {
        case .summary: "doc.text.fill"
        case .tutor: "graduationcap.fill"
        case .feynman: "brain.head.profile"
        case .examRadar: "target"
        case .quiz: "checkmark.circle.fill"
        case .mindmap: "point.3.connected.trianglepath.dotted"
        case .flashcards: "rectangle.stack.fill"
        case .table: "tablecells.fill"
        case .mnemonic: "lightbulb.fill"
        case .chat: "bubble.left.and.bubble.right.fill"
        }
    }

    var tint: Color {
        switch self {
        case .summary: .blue
        case .tutor: .indigo
        case .feynman: .purple
        case .examRadar: .red
        case .quiz: .green
        case .mindmap: .teal
        case .flashcards: .orange
        case .table: .cyan
        case .mnemonic: .yellow
        case .chat: .pink
        }
    }

    /// features that run as an interactive session instead of one-shot generation
    var isInteractive: Bool {
        switch self {
        case .tutor, .feynman, .chat: true
        default: false
        }
    }

    /// features with a pre-generation options sheet (암기노트는 기법 전부 기본값으로 즉시 생성)
    var hasOptions: Bool {
        switch self {
        case .summary, .quiz, .flashcards, .tutor: true
        default: false
        }
    }
}
