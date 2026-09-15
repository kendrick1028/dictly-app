import SwiftUI

// MARK: - 스튜디오 결과물 디자인 토큰
//
// 결과물 = 하나의 문서.  ① 식별 헤더 → ② 본문 → ③ 하단 액션 3층을 10개 기능이 공유한다.
// 틴트는 한 화면에 세 곳(헤더 타일 · 기능명 라벨 · 강조 1곳)만. 초록/주황/빨강은 점수·정오답 전용.

enum SK {
    /// 모서리 반경 — 기존 8·12·14·16·22·26 혼용을 3단계로 정리
    static let rSm: CGFloat = 10   // 내부 블록 · 셀
    static let rMd: CGFloat = 14   // 카드 · 타일 · 버튼
    static let rLg: CGFloat = 20   // 플래시카드 · 시트

    static let gutter: CGFloat = 16
    static let cardPad: CGFloat = 14
    static let cardGap: CGFloat = 12
    static let sectionGap: CGFloat = 22

    static var surface: Color { Color(.secondarySystemGroupedBackground) }
    static var surface2: Color { Color(.tertiarySystemGroupedBackground) }
    static var bg: Color { Color(.systemGroupedBackground) }
    static var hairline: Color { Color(.separator).opacity(0.55) }

    /// 점수·정오답 의미색 (기능 구분에는 쓰지 않는다)
    static func scoreTint(_ score: Int) -> Color {
        score >= 80 ? .green : score >= 55 ? .orange : .red
    }
}

extension StudioKind {
    /// 흰 배경에서 대비가 부족한 노랑·시안은 텍스트용 파생값을 쓴다 (채움은 원색 유지)
    var textTint: Color {
        switch self {
        case .mnemonic:
            Color(uiColor: UIColor { $0.userInterfaceStyle == .dark
                ? UIColor(red: 1.00, green: 0.839, blue: 0.039, alpha: 1)
                : UIColor(red: 0.604, green: 0.478, blue: 0.000, alpha: 1) })
        case .table:
            Color(uiColor: UIColor { $0.userInterfaceStyle == .dark
                ? UIColor(red: 0.392, green: 0.824, blue: 1.000, alpha: 1)
                : UIColor(red: 0.059, green: 0.616, blue: 0.839, alpha: 1) })
        default:
            tint
        }
    }

    var tintFill: Color { tint.opacity(0.13) }
}

// MARK: - 카드

extension View {
    /// 기본 카드 — 표면 + 1px 구분선, 그림자 없음
    func skCard(_ padding: CGFloat = SK.cardPad, radius: CGFloat = SK.rMd) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SK.surface, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(SK.hairline, lineWidth: 1)
            )
    }

    /// 플랫 카드 — 배경 위 내부 블록 (선택 상세 · 해설)
    func skFlat(_ padding: CGFloat = SK.cardPad, radius: CGFloat = SK.rMd) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SK.surface2, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
    }

    /// 강조 카드 — 정답·오답처럼 의미색 테두리가 필요한 경우
    func skCard(border: Color, padding: CGFloat = SK.cardPad, radius: CGFloat = SK.rMd) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SK.surface, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(border, lineWidth: 1.5)
            )
    }
}

// MARK: - 기능 타일

struct SKKindTile: View {
    let kind: StudioKind
    var size: CGFloat = 44
    var radius: CGFloat = 12

    var body: some View {
        Image(systemName: kind.icon)
            .font(.system(size: size * 0.44, weight: .medium))
            .foregroundStyle(kind.textTint)
            .frame(width: size, height: size)
            .background(kind.tintFill, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
    }
}

// MARK: - ① 식별 헤더 (문서형)

/// 요약 · 마인드맵 · 테이블 · 암기노트 · 시험 레이더 · 파인만
struct StudioResultHeader: View {
    let kind: StudioKind
    let title: String
    let meta: String
    var kindLabel: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                SKKindTile(kind: kind)
                VStack(alignment: .leading, spacing: 0) {
                    Text(kindLabel ?? kind.name)
                        .font(.caption.bold())
                        .foregroundStyle(kind.textTint)
                    Text(title)
                        .font(.system(size: 21, weight: .bold))
                        .padding(.top, 3)
                    Text(meta)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.top, 4)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, SK.gutter)
            .padding(.top, 6)
            .padding(.bottom, 14)
            Divider()
        }
    }
}

// MARK: - ① 식별 헤더 (페이지형)

/// 퀴즈 · 플래시카드 · 질문 채팅 · AI 튜터 — 본문이 화면을 다 쓰는 경우
struct StudioIdentityBar: View {
    let kind: StudioKind
    var sub: String?
    var trailing: String?

    var body: some View {
        HStack(spacing: 9) {
            SKKindTile(kind: kind, size: 30, radius: 9)
            Text(kind.name)
                .font(.subheadline.weight(.semibold))
            if let sub {
                Text("· \(sub)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            if let trailing {
                Text(trailing)
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, SK.gutter)
        .padding(.top, 4)
        .padding(.bottom, 10)
    }
}

// MARK: - 칩

enum SKChipStyle {
    case neutral
    case tint(Color)
    case solid
    case score(Int)
}

struct SKChip: View {
    let text: String
    var style: SKChipStyle = .neutral
    var icon: String?

    var body: some View {
        HStack(spacing: 4) {
            if let icon {
                Image(systemName: icon).font(.system(size: 10, weight: .bold))
            }
            Text(text)
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(fg)
        .padding(.horizontal, 9)
        .frame(height: 22)
        .background(bg, in: Capsule())
    }

    private var fg: Color {
        switch style {
        case .neutral: .secondary
        case .tint(let c): c
        case .solid: Color(.systemBackground)
        case .score(let s): SK.scoreTint(s)
        }
    }

    private var bg: Color {
        switch style {
        case .neutral: SK.surface2
        case .tint(let c): c.opacity(0.14)
        case .solid: .primary
        case .score(let s): SK.scoreTint(s).opacity(0.15)
        }
    }
}

// MARK: - 섹션 라벨

struct SKSectionLabel: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - 진행 표시

/// 연속 진행 — 퀴즈 · 플래시카드
struct SKRail: View {
    var value: Double
    var total: Double
    var tint: Color

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.secondary.opacity(0.22))
                Capsule().fill(tint)
                    .frame(width: geo.size.width * min(1, max(0, value / max(total, 1))))
            }
        }
        .frame(height: 4)
    }
}

/// 구간 진행 — 튜터 로드맵
struct SKSegRail: View {
    var total: Int
    var done: Int
    var active: Int?
    var tint: Color

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<max(total, 1), id: \.self) { i in
                Capsule()
                    .fill(i < done ? Color.primary : (i == active ? tint : Color.secondary.opacity(0.22)))
                    .frame(height: 4)
            }
        }
    }
}

/// 페이지 표시 — 15개 이하는 도트, 그보다 많으면 구간 레일
struct SKPageIndicator: View {
    var index: Int
    var total: Int
    var tint: Color

    var body: some View {
        Group {
            if total <= 15 {
                HStack(spacing: 5) {
                    ForEach(0..<max(total, 1), id: \.self) { i in
                        Circle()
                            .fill(i == index ? Color.primary : Color.secondary.opacity(0.32))
                            .frame(width: 6, height: 6)
                    }
                }
            } else {
                SKSegRail(total: total, done: index, active: index, tint: tint)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 12)
    }
}

// MARK: - 상태

struct SKStateView: View {
    var icon: String
    var title: String
    var message: String
    var tone: Color = .secondary
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 0) {
            Image(systemName: icon)
                .font(.system(size: 22, weight: .medium))
                .foregroundStyle(tone)
                .frame(width: 46, height: 46)
                .background(
                    tone == .secondary ? SK.surface2 : tone.opacity(0.13),
                    in: RoundedRectangle(cornerRadius: 13, style: .continuous)
                )
                .padding(.bottom, 12)
            Text(title)
                .font(.headline)
            Text(message)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.top, 5)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .tint(.primary)
                    .padding(.top, 12)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(32)
    }
}

// MARK: - 버튼

struct SKPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(Color(.systemBackground))
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background(Color.primary, in: RoundedRectangle(cornerRadius: SK.rMd, style: .continuous))
            .opacity(configuration.isPressed ? 0.75 : 1)
    }
}

struct SKGhostButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(.primary)
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background(
                RoundedRectangle(cornerRadius: SK.rMd, style: .continuous)
                    .strokeBorder(Color.secondary.opacity(0.35), lineWidth: 1)
            )
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}

// MARK: - 항목 행에 쓰는 요약 정보

extension StudioItem {
    /// 헤더 메타 — "소스 2개 · 8월 19일 (화) 14:20"
    var headerMeta: String {
        var parts: [String] = []
        if !sourceMemos.isEmpty { parts.append("소스 \(sourceMemos.count)개") }
        if let extra = contentSummary { parts.append(extra) }
        parts.append(createdAt.shortString)
        return parts.joined(separator: " · ")
    }

    /// 목록 행 메타 — "요약 · 소스 2 · 어제"
    var rowMeta: String {
        var parts: [String] = [kind.name]
        if let extra = contentSummary { parts.append(extra) }
        if !sourceMemos.isEmpty { parts.append("소스 \(sourceMemos.count)") }
        parts.append(createdAt.relativeShort)
        return parts.joined(separator: " · ")
    }

    /// 저장된 내용에서 규모를 뽑아낸다 (없으면 nil)
    var contentSummary: String? {
        switch kind {
        case .quiz:
            decodeContent(QuizContent.self, from: self).map { "\($0.questions.count)문제" }
        case .flashcards:
            decodeContent(FlashcardsContent.self, from: self).map { "카드 \($0.cards.count)장" }
        case .mnemonic:
            decodeContent(MnemonicContent.self, from: self).map { "항목 \($0.items.count)개" }
        case .table:
            decodeContent(TablesContent.self, from: self).map { "표 \($0.tables.count)개" }
        case .mindmap:
            decodeContent(MindmapContent.self, from: self).map { "노드 \(Self.nodeCount($0.root))개" }
        case .examRadar:
            decodeContent(ExamRadarContent.self, from: self).map { "개념 \($0.nodes.count)개" }
        case .feynman:
            decodeContent(FeynmanContent.self, from: self).map { "\($0.rounds.count)회차" }
        case .tutor:
            decodeContent(TutorContent.self, from: self).map { c in
                c.roadmap.isEmpty ? "\(c.turns.count)턴"
                                  : "진도 \(c.roadmap.filter { $0.status == "done" }.count)/\(c.roadmap.count)"
            }
        case .chat:
            decodeContent(ChatContent.self, from: self).map { "\($0.turns.count)턴" }
        case .summary:
            nil
        }
    }

    /// 목록 행 오른쪽 상태 칩 — 진행형 기능에만
    var rowStatus: (text: String, style: SKChipStyle)? {
        switch kind {
        case .tutor:
            guard let c = decodeContent(TutorContent.self, from: self) else { return nil }
            return c.status == "done" ? ("마무리됨", .neutral) : ("진행 중", .tint(kind.tint))
        case .feynman:
            guard let c = decodeContent(FeynmanContent.self, from: self),
                  let best = c.rounds.compactMap(\.finalScore).max() else { return nil }
            return ("\(best)점", .score(best))
        default:
            return nil
        }
    }

    private static func nodeCount(_ node: MindmapNode) -> Int {
        1 + (node.children ?? []).reduce(0) { $0 + nodeCount($1) }
    }
}

extension Date {
    /// "오늘" / "어제" / "3일 전" / "8월 12일"
    var relativeShort: String {
        let cal = Calendar.current
        if cal.isDateInToday(self) { return "오늘" }
        if cal.isDateInYesterday(self) { return "어제" }
        let days = cal.dateComponents([.day], from: cal.startOfDay(for: self), to: cal.startOfDay(for: .now)).day ?? 0
        if days < 7 { return "\(days)일 전" }
        let df = DateFormatter()
        df.locale = Locale(identifier: "ko_KR")
        df.dateFormat = "M월 d일"
        return df.string(from: self)
    }
}
