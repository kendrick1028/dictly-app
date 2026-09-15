import SwiftUI
import SwiftData

/// 1:1 conversational tutor over the memo sources. Every AI reply carries a trailing
/// `[[STATE:{...}]]` line that drives the 진도/이해도 dashboard (desktop TutorSession).
struct TutorSessionView: View {
    static let kickoff = "수업을 시작해 주세요."
    static let finishText = "여기까지 할게요. 오늘 배운 내용을 정리해 주세요."

    let item: StudioItem
    @Environment(\.modelContext) private var context
    @Environment(AIService.self) private var ai

    @State private var content: TutorContent?
    @State private var input = ""
    @State private var sending = false
    @State private var showWrongNotes = false
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let content {
                VStack(spacing: 0) {
                    dashboard(content)
                    Divider()
                    chatList(content)
                }
                .safeAreaInset(edge: .bottom) {
                    inputBar(content)
                }
            } else {
                brokenContent
            }
        }
        .toolbarVisibility(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showWrongNotes = true
                } label: {
                    Image(systemName: "exclamationmark.triangle")
                }
                .disabled((content?.wrongNotes.isEmpty) ?? true)
            }
        }
        .sheet(isPresented: $showWrongNotes) {
            wrongNotesSheet
        }
        .alert("오류", isPresented: .init(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("확인") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
        .onAppear {
            if content == nil {
                content = decodeContent(TutorContent.self, from: item)
                // auto-kickoff on first open (desktop fires a hidden first turn)
                if let c = content, c.turns.isEmpty, !sending {
                    Task { await send(Self.kickoff) }
                }
            }
        }
    }

    // MARK: ① 식별 헤더 + 진도 대시보드

    @ViewBuilder
    private func dashboard(_ c: TutorContent) -> some View {
        if c.roadmap.isEmpty {
            StudioIdentityBar(kind: .tutor, sub: c.subject, trailing: c.turns.isEmpty ? nil : "\(c.turns.count)턴")
        } else {
            let done = c.roadmap.filter { $0.status == "done" }.count
            let activeIndex = c.roadmap.firstIndex { $0.status == "active" }
            VStack(spacing: 8) {
                HStack(spacing: 5) {
                    Text("진도 \(done) / \(c.roadmap.count)")
                        .font(.footnote.weight(.bold))
                    Spacer(minLength: 8)
                    SKChip(text: "난이도 \(c.difficulty)")
                    if c.stats.asked > 0 {
                        SKChip(text: "정답 \(c.stats.correct)/\(c.stats.asked)",
                               style: .score(c.stats.asked > 0 ? c.stats.correct * 100 / c.stats.asked : 0))
                    }
                }
                SKSegRail(total: c.roadmap.count, done: done, active: activeIndex, tint: StudioKind.tutor.tint)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 5) {
                        ForEach(c.roadmap, id: \.id) { r in
                            roadmapChip(r)
                        }
                    }
                }
            }
            .padding(.horizontal, SK.gutter)
            .padding(.top, 4)
            .padding(.bottom, 10)
        }
    }

    private func roadmapChip(_ r: TutorRoadmapItem) -> some View {
        HStack(spacing: 4) {
            if r.status == "done" {
                Image(systemName: "checkmark").font(.system(size: 9, weight: .black))
            }
            Text(r.label).lineLimit(1)
            if let u = r.understanding, r.status != "pending" {
                Text("· \(u)").monospacedDigit()
            }
        }
        .font(.caption.weight(r.status == "active" ? .semibold : .regular))
        .foregroundStyle(r.status == "active" ? StudioKind.tutor.tint : (r.status == "done" ? .primary : .secondary))
        .padding(.horizontal, 9)
        .frame(height: 24)
        .background(
            r.status == "active" ? StudioKind.tutor.tint.opacity(0.14) : SK.surface2,
            in: Capsule()
        )
    }

    // MARK: chat

    private func chatList(_ c: TutorContent) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    ForEach(Array(visibleTurns(c).enumerated()), id: \.offset) { _, turn in
                        TurnBubble(turn: turn, tint: StudioKind.tutor.tint)
                    }
                    if sending {
                        HStack(spacing: 8) {
                            ProgressView().controlSize(.small)
                            Text("선생님이 답변을 준비 중…")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Color.clear.frame(height: 4).id("tail")
                }
                .padding(.horizontal, SK.gutter)
                .padding(.top, 16)
            }
            .defaultScrollAnchor(.bottom)
            .onChange(of: c.turns.count) {
                withAnimation { proxy.scrollTo("tail", anchor: .bottom) }
            }
            .onChange(of: sending) {
                withAnimation { proxy.scrollTo("tail", anchor: .bottom) }
            }
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func visibleTurns(_ c: TutorContent) -> [TutorTurn] {
        c.turns.filter { !($0.role == "user" && $0.content == Self.kickoff) }
    }

    // MARK: input

    @ViewBuilder
    private func inputBar(_ c: TutorContent) -> some View {
        if c.status == "done" {
            Label("수업이 마무리되었습니다 — 오답노트를 확인하세요", systemImage: "flag.checkered")
                .font(.callout)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
                .glassEffect(.regular, in: .capsule)
                .padding(.bottom, 8)
        } else {
            VStack(alignment: .leading, spacing: 9) {
                HStack(spacing: 7) {
                    Button("모르겠어요") {
                        Task { await send("모르겠어요") }
                    }
                    .buttonStyle(.glass)
                    .controlSize(.small)
                    .disabled(sending)
                    Button("여기까지 (마무리)") {
                        Task { await send(Self.finishText) }
                    }
                    .buttonStyle(.glass)
                    .controlSize(.small)
                    .disabled(sending)
                    Spacer()
                }
                HStack(alignment: .bottom, spacing: 10) {
                    TextField("답변을 입력하세요…", text: $input, axis: .vertical)
                        .lineLimit(1...4)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 11)
                        .glassEffect(.regular, in: .rect(cornerRadius: 22))
                        .disabled(sending)
                    Button {
                        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !text.isEmpty else { return }
                        input = ""
                        Task { await send(text) }
                    } label: {
                        Image(systemName: "arrow.up")
                            .font(.body.weight(.bold))
                            .frame(width: 22, height: 22)
                    }
                    .buttonStyle(.glassProminent)
                    .buttonBorderShape(.circle)
                    .disabled(sending || input.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 6)
        }
    }

    // MARK: turn exchange

    private func send(_ text: String) async {
        guard var c = content, !sending else { return }
        sending = true
        defer { sending = false }
        do {
            let reply = try await ai.tutorTurn(content: c, manifest: item.combinedManifest, multi: item.isMultiSource, userText: text)
            let (body, state) = StudioParse.parseTutorState(reply)
            c.turns.append(TutorTurn(role: "user", content: text, createdAt: Date.now.timeIntervalSince1970))
            c.turns.append(TutorTurn(role: "assistant", content: body, createdAt: Date.now.timeIntervalSince1970))
            if let state {
                if let roadmap = state.roadmap, !roadmap.isEmpty { c.roadmap = roadmap }
                if let d = state.difficulty { c.difficulty = d }
                if let s = state.stats { c.stats = s }
                if let w = state.wrongNotes { c.wrongNotes = w }
                if state.done == true { c.status = "done" }
            }
            content = c
            item.contentJSON = StudioParse.encodeContent(c)
            try? context.save()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: wrong notes

    private var wrongNotesSheet: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: SK.cardGap) {
                    ForEach(Array((content?.wrongNotes ?? []).enumerated()), id: \.offset) { _, note in
                        VStack(alignment: .leading, spacing: 0) {
                            HStack(spacing: 6) {
                                Text(note.concept)
                                    .font(.system(size: 16, weight: .semibold))
                                Spacer(minLength: 4)
                                if note.repeated == true {
                                    SKChip(text: "반복", style: .score(40))
                                }
                            }
                            VStack(alignment: .leading, spacing: 6) {
                                ChipText("**문제** — \(note.problem)")
                                ChipText("**원인** — \(note.cause)")
                                    .foregroundStyle(.secondary)
                                ChipText("**정답 원리** — \(note.correct)")
                            }
                            .font(.system(size: 15))
                            .lineSpacing(3)
                            .padding(.top, 8)
                        }
                        .skCard()
                    }
                }
                .padding(SK.gutter)
            }
            .background(SK.bg)
            .navigationTitle("오답노트")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }
}

/// one chat bubble; assistant replies split on `확인 질문:` into explanation + highlighted question
struct TurnBubble: View {
    let turn: TutorTurn
    var tint: Color = StudioKind.tutor.tint

    var body: some View {
        if turn.role == "user" {
            // 내가 보낸 말풍선은 오른쪽 정렬
            HStack {
                Spacer(minLength: 40)
                Text(turn.content)
                    .font(.system(size: 16))
                    .lineSpacing(3)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(
                        Color.primary,
                        in: UnevenRoundedRectangle(
                            topLeadingRadius: 18, bottomLeadingRadius: 18,
                            bottomTrailingRadius: 5, topTrailingRadius: 18,
                            style: .continuous
                        )
                    )
                    .foregroundStyle(Color(.systemBackground))
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        } else {
            let parts = split(turn.content)
            VStack(alignment: .leading, spacing: 10) {
                if !parts.body.isEmpty {
                    MarkdownText(markdown: parts.body)
                        .font(.system(size: 16))
                }
                if let q = parts.question {
                    HStack(spacing: 0) {
                        Rectangle()
                            .fill(tint)
                            .frame(width: 3)
                        VStack(alignment: .leading, spacing: 5) {
                            Text("확인 질문")
                                .font(.caption.bold())
                                .foregroundStyle(tint)
                            MarkdownText(markdown: q)
                                .font(.system(size: 16, weight: .medium))
                        }
                        .padding(.horizontal, 13)
                        .padding(.vertical, 12)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(SK.surface)
                    .clipShape(
                        UnevenRoundedRectangle(
                            topLeadingRadius: 0, bottomLeadingRadius: 0,
                            bottomTrailingRadius: SK.rMd, topTrailingRadius: SK.rMd,
                            style: .continuous
                        )
                    )
                }
            }
            .padding(.trailing, 18)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func split(_ text: String) -> (body: String, question: String?) {
        guard let range = text.range(of: "확인 질문:") else { return (text, nil) }
        let body = String(text[..<range.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
        let question = String(text[range.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
        return (body, question.isEmpty ? nil : question)
    }
}

// MARK: - grounded Q&A chat (소스 근거, 외부 지식 거부)

struct ChatSessionView: View {
    let item: StudioItem
    @Environment(\.modelContext) private var context
    @Environment(AIService.self) private var ai

    @State private var content: ChatContent?
    @State private var input = ""
    @State private var sending = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 0) {
            StudioIdentityBar(
                kind: .chat,
                sub: item.sourceMemos.isEmpty ? nil : "소스 \(item.sourceMemos.count)개",
                trailing: (content?.turns.isEmpty ?? true) ? nil : "\(content?.turns.count ?? 0)턴"
            )
            Divider()

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 16) {
                        if (content?.turns.isEmpty) ?? true {
                            SKStateView(
                                icon: "bubble.left.and.bubble.right.fill",
                                title: "무엇이든 물어보세요",
                                message: "이 노트의 내용에 대해 질문하면\n소스에 근거해서만 답합니다"
                            )
                            .frame(minHeight: 320)
                        }
                        ForEach(Array((content?.turns ?? []).enumerated()), id: \.offset) { _, turn in
                            TurnBubble(turn: turn, tint: StudioKind.chat.tint)
                        }
                        if sending {
                            HStack(spacing: 8) {
                                ProgressView().controlSize(.small)
                                Text("소스를 찾아보는 중…")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Color.clear.frame(height: 4).id("tail")
                    }
                    .padding(.horizontal, SK.gutter)
                    .padding(.top, 16)
                }
                .defaultScrollAnchor(.bottom)
                .onChange(of: content?.turns.count ?? 0) {
                    withAnimation { proxy.scrollTo("tail", anchor: .bottom) }
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .toolbarVisibility(.hidden, for: .tabBar)
        .safeAreaInset(edge: .bottom) {
            HStack(alignment: .bottom, spacing: 10) {
                TextField("질문 입력…", text: $input, axis: .vertical)
                    .lineLimit(1...4)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 11)
                    .glassEffect(.regular, in: .rect(cornerRadius: 22))
                    .disabled(sending)
                Button {
                    let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !text.isEmpty else { return }
                    input = ""
                    Task { await send(text) }
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.body.weight(.bold))
                        .frame(width: 22, height: 22)
                }
                .buttonStyle(.glassProminent)
                .buttonBorderShape(.circle)
                .disabled(sending || input.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 6)
        }
        .alert("오류", isPresented: .init(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("확인") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
        .onAppear {
            if content == nil {
                content = decodeContent(ChatContent.self, from: item) ?? ChatContent(turns: [])
            }
        }
    }

    private func send(_ text: String) async {
        guard var c = content, !sending else { return }
        sending = true
        defer { sending = false }
        do {
            let reply = try await ai.chatTurn(turns: c.turns, manifest: item.combinedManifest, multi: item.isMultiSource, userText: text)
            c.turns.append(TutorTurn(role: "user", content: text, createdAt: Date.now.timeIntervalSince1970))
            c.turns.append(TutorTurn(role: "assistant", content: reply, createdAt: Date.now.timeIntervalSince1970))
            content = c
            item.contentJSON = StudioParse.encodeContent(c)
            try? context.save()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
