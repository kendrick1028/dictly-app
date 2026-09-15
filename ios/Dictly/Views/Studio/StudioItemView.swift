import SwiftUI
import Charts

/// routes a saved StudioItem to its kind-specific viewer
struct StudioItemView: View {
    let item: StudioItem

    var body: some View {
        Group {
            switch item.kind {
            case .summary:   SummaryViewer(item: item)
            case .quiz:      QuizViewer(item: item)
            case .mindmap:   MindmapViewer(item: item)
            case .flashcards: FlashcardsViewer(item: item)
            case .table:     TablesViewer(item: item)
            case .mnemonic:  MnemonicViewer(item: item)
            case .examRadar: ExamRadarViewer(item: item)
            case .feynman:   FeynmanSessionView(item: item)
            case .tutor:     TutorSessionView(item: item)
            case .chat:      ChatSessionView(item: item)
            }
        }
        .background(SK.bg.ignoresSafeArea())
        // 제목은 본문 헤더(StudioResultHeader/IdentityBar) 하나만 — 내비바 인라인 제목과
        // 이중으로 보이던 것을 통일한다
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        // 생성 항목 상세에서는 하단 탭바를 감춰 본문에 집중시킨다
        .toolbar(.hidden, for: .tabBar)
    }
}

func decodeContent<T: Decodable>(_ type: T.Type, from item: StudioItem) -> T? {
    item.contentJSON.data(using: .utf8).flatMap { try? JSONDecoder().decode(T.self, from: $0) }
}

var brokenContent: some View {
    SKStateView(
        icon: "exclamationmark.triangle.fill",
        title: "내용을 표시하지 못했어요",
        message: "저장된 형식이 손상됐습니다.\n같은 소스로 다시 만들 수 있어요",
        tone: .red
    )
}

/// 출처 노트 — 결과 화면 하단 공통 푸터
struct StudioSourceFooter: View {
    let item: StudioItem

    var body: some View {
        if !item.sourceMemos.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                SKSectionLabel("출처 노트")
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(item.sourceMemos) { memo in
                            SKChip(text: "\(memo.title) · \(memo.durationSec.timeString)", icon: "doc.text.fill")
                        }
                    }
                }
            }
            .padding(.horizontal, SK.gutter)
            .padding(.top, 12)
            .padding(.bottom, 10)
        }
    }
}

// MARK: - 요약

struct SummaryViewer: View {
    let item: StudioItem

    var body: some View {
        if let content = decodeContent(SummaryContent.self, from: item) {
            VStack(spacing: 0) {
                StudioResultHeader(kind: .summary, title: item.title, meta: item.headerMeta)
                ScrollView {
                    MarkdownText(markdown: content.md)
                        .padding(.horizontal, SK.gutter)
                        .padding(.top, 16)
                        .padding(.bottom, 24)
                }
                Divider()
                StudioSourceFooter(item: item)
            }
            .toolbar {
                ShareLink(item: content.md, preview: SharePreview(item.title))
            }
        } else {
            brokenContent
        }
    }
}

// MARK: - 퀴즈 (한 페이지 한 문제)

struct QuizViewer: View {
    let item: StudioItem
    @State private var page = 0
    @State private var revealed: Set<Int> = []
    @State private var oxPicks: [Int: String] = [:]

    private let typeLabel: [String: String] = [
        "verbal": "말문제", "calc": "계산문제", "ox": "OX 퀴즈", "mc": "객관식", "short": "단답형"
    ]

    var body: some View {
        if let content = decodeContent(QuizContent.self, from: item), !content.questions.isEmpty {
            let total = content.questions.count
            let current = content.questions[min(page, total - 1)]
            VStack(spacing: 0) {
                StudioIdentityBar(
                    kind: .quiz,
                    sub: typeLabel[current.type],
                    trailing: "\(page + 1) / \(total)"
                )
                SKRail(value: Double(page + 1), total: Double(total), tint: StudioKind.quiz.tint)
                    .padding(.horizontal, SK.gutter)

                TabView(selection: $page) {
                    ForEach(Array(content.questions.enumerated()), id: \.offset) { idx, q in
                        questionPage(idx: idx, q: q, total: total).tag(idx)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))

                SKPageIndicator(index: page, total: total, tint: StudioKind.quiz.tint)
                    .padding(.bottom, 8)
            }
        } else {
            brokenContent
        }
    }

    private func questionPage(idx: Int, q: QuizContent.Question, total: Int) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Q\(idx + 1)")
                    .font(.footnote.weight(.bold).monospacedDigit())
                    .foregroundStyle(.secondary)

                ChipText(q.question)
                    .font(.system(size: 21, weight: .medium))
                    .lineSpacing(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 6)

                if q.type == "ox" {
                    HStack(spacing: 12) {
                        oxTile("O", idx: idx, q: q)
                        oxTile("X", idx: idx, q: q)
                    }
                    .padding(.top, 24)
                }

                if revealed.contains(idx) {
                    answerCard(q: q, idx: idx)
                        .padding(.top, q.type == "ox" ? 20 : 24)
                    if idx + 1 < total {
                        Button {
                            withAnimation(.smooth(duration: 0.25)) { page = idx + 1 }
                        } label: {
                            Label("다음 문제", systemImage: "arrow.right")
                                .labelStyle(.titleAndIcon)
                        }
                        .buttonStyle(SKPrimaryButtonStyle())
                        .padding(.top, 12)
                    }
                } else if q.type != "ox" {
                    Button {
                        withAnimation(.smooth(duration: 0.25)) { _ = revealed.insert(idx) }
                    } label: {
                        Text("정답 보기")
                    }
                    .buttonStyle(SKGhostButtonStyle())
                    .padding(.top, 26)
                }
            }
            .padding(.horizontal, SK.gutter)
            .padding(.top, 22)
            .padding(.bottom, 28)
        }
    }

    /// 정답·오답 카드 — 의미색은 여기에만 쓴다
    private func answerCard(q: QuizContent.Question, idx: Int) -> some View {
        let picked = oxPicks[idx]
        let isWrong = q.type == "ox" && picked != nil && !q.answer.uppercased().hasPrefix(picked!)
        let tone: Color = isWrong ? .red : .green
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 9) {
                Image(systemName: isWrong ? "xmark.circle" : "checkmark.circle")
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundStyle(tone)
                VStack(alignment: .leading, spacing: 2) {
                    Text(isWrong ? "오답 · 정답은 \(q.answer)" : "정답")
                        .font(.caption.bold())
                        .foregroundStyle(tone)
                    ChipText(q.answer)
                        .font(.system(size: 18, weight: .semibold))
                }
                Spacer(minLength: 0)
            }
            if let ex = q.explanation, !ex.isEmpty {
                Divider()
                    .padding(.horizontal, -SK.cardPad)
                    .padding(.vertical, 13)
                ChipText(ex)
                    .font(.system(size: 15))
                    .lineSpacing(5)
                    .foregroundStyle(.secondary)
            }
        }
        .skCard(border: tone)
    }

    private func oxTile(_ value: String, idx: Int, q: QuizContent.Question) -> some View {
        let picked = oxPicks[idx]
        let isAnswer = q.answer.uppercased().hasPrefix(value)
        let border: Color = picked == nil
            ? Color.secondary.opacity(0.35)
            : (isAnswer ? .green : (picked == value ? .red : Color.secondary.opacity(0.2)))
        let fg: Color = picked == nil
            ? .primary
            : (isAnswer ? .green : (picked == value ? .red : .secondary))
        let tag: String? = picked == nil ? nil : (isAnswer ? "정답" : (picked == value ? "내 선택" : nil))

        return Button {
            oxPicks[idx] = value
            withAnimation(.smooth(duration: 0.25)) { _ = revealed.insert(idx) }
        } label: {
            VStack(spacing: 5) {
                Text(value).font(.system(size: 34, weight: .bold))
                if let tag {
                    Text(tag).font(.caption2.weight(.bold))
                }
            }
            .foregroundStyle(fg)
            .frame(maxWidth: .infinity)
            .frame(height: 104)
            .background(SK.surface, in: RoundedRectangle(cornerRadius: SK.rMd, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: SK.rMd, style: .continuous)
                    .strokeBorder(border, lineWidth: picked == nil ? 1 : 1.5)
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - 마인드맵 (아웃라인 트리)

struct MindmapViewer: View {
    let item: StudioItem
    @State private var collapsed: Set<String> = []

    var body: some View {
        if let content = decodeContent(MindmapContent.self, from: item) {
            VStack(spacing: 0) {
                StudioResultHeader(kind: .mindmap, title: item.title, meta: item.headerMeta)
                ScrollView {
                    MindmapNodeView(node: content.root, depth: 0, path: "0", collapsed: $collapsed)
                        .padding(.horizontal, SK.gutter)
                        .padding(.top, 8)
                        .padding(.bottom, 24)
                }
            }
        } else {
            brokenContent
        }
    }
}

struct MindmapNodeView: View {
    let node: MindmapNode
    let depth: Int
    let path: String
    @Binding var collapsed: Set<String>

    private var children: [MindmapNode] { node.children ?? [] }
    private var hasKids: Bool { !children.isEmpty }
    private var isOpen: Bool { !collapsed.contains(path) }
    private var canToggle: Bool { hasKids && depth > 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                guard canToggle else { return }
                withAnimation(.smooth(duration: 0.22)) {
                    if isOpen { collapsed.insert(path) } else { collapsed.remove(path) }
                }
            } label: {
                HStack(alignment: .top, spacing: 8) {
                    marker
                    VStack(alignment: .leading, spacing: 2) {
                        ChipText(node.label)
                            .font(labelFont)
                            .foregroundStyle(.primary)
                            .multilineTextAlignment(.leading)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.vertical, 9)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!canToggle)

            if hasKids && isOpen {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(children.enumerated()), id: \.offset) { i, child in
                        MindmapNodeView(node: child, depth: depth + 1, path: "\(path).\(i)", collapsed: $collapsed)
                    }
                }
                .padding(.leading, 15)
                .overlay(alignment: .leading) {
                    Rectangle().fill(SK.hairline).frame(width: 1)
                }
            }
        }
    }

    @ViewBuilder
    private var marker: some View {
        if canToggle {
            Image(systemName: "chevron.down")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(.tertiary)
                .rotationEffect(.degrees(isOpen ? 0 : -90))
                .frame(width: 16)
                .padding(.top, 4)
        } else {
            Circle()
                .fill(depth == 0 ? StudioKind.mindmap.tint : (depth == 1 ? Color.secondary : Color.secondary.opacity(0.45)))
                .frame(width: dotSize, height: dotSize)
                .frame(width: 16)
                .padding(.top, 7)
        }
    }

    private var dotSize: CGFloat { depth == 0 ? 9 : depth == 1 ? 6 : 5 }

    private var labelFont: Font {
        switch depth {
        case 0: .system(size: 17, weight: .bold)
        case 1: .system(size: 16, weight: .semibold)
        default: .system(size: 15)
        }
    }
}

// MARK: - 플래시카드

struct FlashcardsViewer: View {
    let item: StudioItem
    @State private var page = 0
    @State private var flipped: Set<Int> = []

    var body: some View {
        if let content = decodeContent(FlashcardsContent.self, from: item), !content.cards.isEmpty {
            let total = content.cards.count
            VStack(spacing: 0) {
                StudioIdentityBar(kind: .flashcards, sub: nil, trailing: "\(page + 1) / \(total)")

                TabView(selection: $page) {
                    ForEach(Array(content.cards.enumerated()), id: \.offset) { idx, card in
                        FlashcardView(card: card, isFlipped: flipped.contains(idx)) {
                            withAnimation(.spring(duration: 0.4)) {
                                if flipped.contains(idx) { flipped.remove(idx) } else { flipped.insert(idx) }
                            }
                        }
                        .padding(.horizontal, SK.gutter)
                        .padding(.bottom, 4)
                        .tag(idx)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))

                SKPageIndicator(index: page, total: total, tint: StudioKind.flashcards.tint)
                    .padding(.horizontal, SK.gutter)
                    .padding(.bottom, 10)
            }
        } else {
            brokenContent
        }
    }
}

struct FlashcardView: View {
    let card: FlashcardsContent.Card
    let isFlipped: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            ZStack {
                face(back: false)
                    .opacity(isFlipped ? 0 : 1)
                    .allowsHitTesting(!isFlipped)
                face(back: true)
                    .rotation3DEffect(.degrees(180), axis: (x: 0, y: 1, z: 0))
                    .opacity(isFlipped ? 1 : 0)
                    .allowsHitTesting(isFlipped)
            }
            .background(SK.surface, in: RoundedRectangle(cornerRadius: SK.rLg, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: SK.rLg, style: .continuous)
                    .strokeBorder(isFlipped ? StudioKind.flashcards.tint : SK.hairline,
                                  lineWidth: isFlipped ? 1.5 : 1)
            )
            // 카드·글자·테두리가 전부 이 회전값 하나로 움직인다 — 면 교체는 카드가 모서리로
            // 서는 90° 부근의 크로스페이드로 일어나 회전과 한 몸으로 보인다
            .rotation3DEffect(.degrees(isFlipped ? 180 : 0), axis: (x: 0, y: 1, z: 0))
        }
        .buttonStyle(.plain)
    }

    /// 앞·뒷면을 항상 겹쳐 두고 카드째 회전만 시킨다.
    /// 뒷면은 미리 180° 뒤집어 둬야 카드가 뒤집혔을 때 정방향으로 읽힌다
    private func face(back: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(back ? "뒷면 · 정의" : "앞면 · 개념")
                .font(.caption.weight(.bold))
                .foregroundStyle(back ? StudioKind.flashcards.textTint : Color.secondary.opacity(0.7))

            if back {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        ChipText(card.front)
                            .font(.system(size: 17, weight: .bold))
                        ChipText(card.back)
                            .font(.system(size: 17))
                            .lineSpacing(6)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 14)
                }
                .frame(maxHeight: .infinity)
            } else {
                ChipText(card.front)
                    .font(.system(size: 24, weight: .bold))
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            Label(back ? "탭하여 앞면" : "탭하여 뒷면 보기", systemImage: "arrow.trianglehead.2.clockwise.rotate.90")
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .frame(maxWidth: .infinity)
        }
        .padding(22)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - 테이블

struct TablesViewer: View {
    let item: StudioItem

    var body: some View {
        if let content = decodeContent(TablesContent.self, from: item) {
            VStack(spacing: 0) {
                StudioResultHeader(kind: .table, title: item.title, meta: item.headerMeta)
                ScrollView {
                    VStack(alignment: .leading, spacing: SK.sectionGap) {
                        ForEach(Array(content.tables.enumerated()), id: \.offset) { _, table in
                            VStack(alignment: .leading, spacing: 8) {
                                SKSectionLabel(table.title)
                                tableCard(table)
                            }
                        }
                    }
                    .padding(.horizontal, SK.gutter)
                    .padding(.top, 16)
                    .padding(.bottom, 24)
                }
            }
        } else {
            brokenContent
        }
    }

    private func tableCard(_ table: TablesContent.Table) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .topLeading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(Array(table.headers.enumerated()), id: \.offset) { _, h in
                        ChipText(h)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 9)
                            // maxHeight 까지 채워야 셀 높이가 달라도 헤더 배경이 한 띠로 이어진다
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    }
                }
                .background(SK.surface2)

                ForEach(Array(table.rows.enumerated()), id: \.offset) { _, row in
                    Divider()
                    GridRow {
                        ForEach(Array(row.enumerated()), id: \.offset) { col, cell in
                            ChipText(cell)
                                .font(.system(size: 15, weight: col == 0 ? .semibold : .regular))
                                .padding(.horizontal, 12)
                                .padding(.vertical, 11)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
            }
            .fixedSize(horizontal: true, vertical: false)
        }
        .background(SK.surface, in: RoundedRectangle(cornerRadius: SK.rMd, style: .continuous))
        // 헤더 띠가 카드의 둥근 모서리를 따라 잘리도록 클립 — 각진 모서리가 삐져나오지 않는다
        .clipShape(RoundedRectangle(cornerRadius: SK.rMd, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: SK.rMd, style: .continuous)
                .strokeBorder(SK.hairline, lineWidth: 1)
        )
    }
}

// MARK: - 암기노트

struct MnemonicViewer: View {
    let item: StudioItem

    var body: some View {
        if let content = decodeContent(MnemonicContent.self, from: item) {
            VStack(spacing: 0) {
                StudioResultHeader(kind: .mnemonic, title: item.title, meta: item.headerMeta)
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: SK.cardGap) {
                        ForEach(Array(content.items.enumerated()), id: \.offset) { _, m in
                            card(m)
                        }
                    }
                    .padding(.horizontal, SK.gutter)
                    .padding(.top, 16)
                    .padding(.bottom, 24)
                }
            }
        } else {
            brokenContent
        }
    }

    private func card(_ m: MnemonicContent.Item) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 8) {
                ChipText(m.concept)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
                SKChip(text: m.technique, style: .tint(StudioKind.mnemonic.textTint))
            }

            VStack(alignment: .leading, spacing: 5) {
                ChipText(m.mnemonic)
                    .font(.system(size: 22, weight: .bold))
                    .lineSpacing(3)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(13)
            .background(SK.surface2, in: RoundedRectangle(cornerRadius: SK.rSm, style: .continuous))
            .padding(.top, 10)

            if !m.explanation.isEmpty {
                ChipText(m.explanation)
                    .font(.system(size: 15))
                    .lineSpacing(5)
                    .foregroundStyle(.secondary)
                    .padding(.top, 10)
            }
        }
        .skCard()
    }
}

// MARK: - 시험 레이더 (중요도 × 난이도)

struct ExamRadarViewer: View {
    let item: StudioItem
    @State private var selectedNodeID: String?

    private func isHot(_ n: ExamRadarNode) -> Bool { n.importance >= 50 && n.difficulty >= 50 }

    var body: some View {
        if let content = decodeContent(ExamRadarContent.self, from: item) {
            VStack(spacing: 0) {
                StudioResultHeader(
                    kind: .examRadar,
                    title: item.title,
                    meta: "소스 \(item.sourceMemos.count)개 · 개념 \(content.nodes.count)개 · 최우선 \(content.nodes.filter(isHot).count)개"
                )
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        chart(content)
                        if let sel = content.nodes.first(where: { $0.id == selectedNodeID }) {
                            selectedCard(sel)
                        }
                        VStack(alignment: .leading, spacing: 7) {
                            SKSectionLabel("우선순위 · 중요도순")
                            rankedList(content)
                        }
                    }
                    .padding(.horizontal, SK.gutter)
                    .padding(.top, 14)
                    .padding(.bottom, 24)
                }
            }
        } else {
            brokenContent
        }
    }

    private func chart(_ content: ExamRadarContent) -> some View {
        VStack(spacing: 6) {
            Chart {
                RectangleMark(
                    xStart: .value("중요도", 50), xEnd: .value("중요도", 100),
                    yStart: .value("난이도", 50), yEnd: .value("난이도", 100)
                )
                .foregroundStyle(Color.red.opacity(0.06))

                RuleMark(x: .value("중요도", 50)).foregroundStyle(SK.hairline)
                RuleMark(y: .value("난이도", 50)).foregroundStyle(SK.hairline)

                ForEach(content.nodes, id: \.id) { node in
                    PointMark(
                        x: .value("중요도", node.importance),
                        y: .value("난이도", node.difficulty)
                    )
                    .symbolSize(node.id == selectedNodeID ? 220 : (isHot(node) ? 110 : 60))
                    .foregroundStyle(isHot(node) ? Color.red : Color.secondary.opacity(0.55))
                    .annotation(position: .top, spacing: 3) {
                        if node.id == selectedNodeID || (isHot(node) && node.importance >= 70) {
                            Text(node.label.replacingOccurrences(of: #"\$[^$]*\$"#, with: "", options: .regularExpression))
                                .font(.system(size: 10))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                }
            }
            .chartXScale(domain: 0...100)
            .chartYScale(domain: 0...100)
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            // 차트의 점을 직접 탭해도 아래 목록 행처럼 해당 개념 카드가 열린다
            .chartOverlay { proxy in
                GeometryReader { geo in
                    Rectangle()
                        .fill(Color.clear)
                        .contentShape(Rectangle())
                        .onTapGesture { location in
                            guard let plotFrame = proxy.plotFrame else { return }
                            let origin = geo[plotFrame].origin
                            let p = CGPoint(x: location.x - origin.x, y: location.y - origin.y)
                            var nearest: (id: String, dist: CGFloat)?
                            for node in content.nodes {
                                guard let x = proxy.position(forX: node.importance),
                                      let y = proxy.position(forY: node.difficulty) else { continue }
                                let d = hypot(x - p.x, y - p.y)
                                if nearest == nil || d < nearest!.dist { nearest = (node.id, d) }
                            }
                            guard let nearest, nearest.dist <= 24 else { return }
                            withAnimation(.smooth(duration: 0.22)) {
                                selectedNodeID = selectedNodeID == nearest.id ? nil : nearest.id
                            }
                        }
                }
            }
            .chartPlotStyle { plot in
                plot.overlay(alignment: .topTrailing) { quadrant("최우선") }
                    .overlay(alignment: .topLeading) { quadrant("난이도만 높음") }
                    .overlay(alignment: .bottomTrailing) { quadrant("기본 암기") }
                    .overlay(alignment: .bottomLeading) { quadrant("여유") }
            }
            .frame(height: 264)
            .padding(10)
            .background(SK.surface2, in: RoundedRectangle(cornerRadius: SK.rSm, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: SK.rSm, style: .continuous)
                    .strokeBorder(SK.hairline, lineWidth: 1)
            )

            HStack {
                Text("← 중요도 낮음")
                Spacer()
                Text("중요도 높음 →")
            }
            .font(.caption2)
            .foregroundStyle(.tertiary)
        }
    }

    private func quadrant(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(.tertiary)
            .padding(7)
    }

    private func selectedCard(_ node: ExamRadarNode) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ChipText(node.label)
                .font(.system(size: 17, weight: .bold))
            if let ex = node.explanation, !ex.isEmpty {
                ChipText(ex)
                    .font(.system(size: 15))
                    .lineSpacing(4)
                    .foregroundStyle(.secondary)
                    .padding(.top, 6)
            }
            VStack(spacing: 7) {
                statLine("중요도", value: node.importance, tint: .red)
                statLine("난이도", value: node.difficulty, tint: .secondary)
            }
            .padding(.top, 12)
        }
        .skFlat()
    }

    private func statLine(_ label: String, value: Double, tint: Color) -> some View {
        HStack(spacing: 8) {
            Text(label)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(width: 44, alignment: .leading)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.secondary.opacity(0.22))
                    Capsule().fill(tint).frame(width: geo.size.width * min(1, max(0, value / 100)))
                }
            }
            .frame(height: 5)
            Text("\(Int(value))")
                .font(.footnote.weight(.semibold).monospacedDigit())
                .frame(width: 24, alignment: .trailing)
        }
    }

    private func rankedList(_ content: ExamRadarContent) -> some View {
        let sorted = content.nodes.sorted { $0.importance > $1.importance }
        return VStack(spacing: 0) {
            ForEach(Array(sorted.enumerated()), id: \.element.id) { rank, node in
                if rank > 0 { Divider().padding(.leading, 12) }
                Button {
                    withAnimation(.smooth(duration: 0.22)) {
                        selectedNodeID = selectedNodeID == node.id ? nil : node.id
                    }
                } label: {
                    HStack(spacing: 10) {
                        Text("\(rank + 1)")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                            .frame(width: 20, alignment: .leading)
                        ChipText(node.label)
                            .font(.system(size: 15))
                            .foregroundStyle(.primary)
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Color.secondary.opacity(0.22))
                                Capsule()
                                    .fill(isHot(node) ? Color.red : Color.secondary.opacity(0.55))
                                    .frame(width: geo.size.width * min(1, max(0, node.importance / 100)))
                            }
                        }
                        .frame(width: 46, height: 4)
                        Text("\(Int(node.importance))")
                            .font(.footnote.weight(.semibold).monospacedDigit())
                            .frame(width: 22, alignment: .trailing)
                    }
                    .padding(12)
                    .contentShape(Rectangle())
                    .background(selectedNodeID == node.id ? SK.surface2 : Color.clear)
                }
                .buttonStyle(.plain)
            }
        }
        .background(SK.surface, in: RoundedRectangle(cornerRadius: SK.rMd, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: SK.rMd, style: .continuous)
                .strokeBorder(SK.hairline, lineWidth: 1)
        )
    }
}
