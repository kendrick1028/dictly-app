import SwiftUI
import SwiftData

/// Interactive Feynman review: answer each question in your own words, get graded
/// feedback + `[[SCORE]]`, weighted round score, and review rounds seeded from weak
/// areas. State persists to the StudioItem after every turn (resumable).
struct FeynmanSessionView: View {
    let item: StudioItem
    @Environment(\.modelContext) private var context
    @Environment(AIService.self) private var ai

    @State private var content: FeynmanContent?
    @State private var answerText = ""
    @State private var grading = false
    @State private var generatingReview = false
    @State private var lastFeedback: (score: Int, body: String)?
    @State private var expanded: Set<Int> = []
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let content {
                sessionBody(content)
            } else {
                brokenContent
            }
        }
        .onAppear {
            if content == nil {
                content = decodeContent(FeynmanContent.self, from: item)
            }
        }
        .alert("오류", isPresented: .init(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("확인") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    @ViewBuilder
    private func sessionBody(_ content: FeynmanContent) -> some View {
        let round = content.rounds[min(content.currentRound, content.rounds.count - 1)]
        if round.status == "done" {
            reportView(round)
        } else {
            activeRound(round)
        }
    }

    // MARK: 진행 중인 회차

    @ViewBuilder
    private func activeRound(_ round: FeynmanRound) -> some View {
        let qIndex = round.answers.count
        if qIndex >= round.questions.count {
            reportView(round)
        } else {
            let question = round.questions[qIndex]
            VStack(spacing: 0) {
                StudioIdentityBar(
                    kind: .feynman,
                    sub: "\(round.index + 1)회차",
                    trailing: "\(round.answers.count) / \(round.questions.count)"
                )
                SKRail(value: Double(round.answers.count),
                       total: Double(max(1, round.questions.count)),
                       tint: StudioKind.feynman.tint)
                    .padding(.horizontal, SK.gutter)

                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        questionCard(question, index: qIndex)
                        if let fb = lastFeedback {
                            feedbackCard(fb)
                            Button {
                                lastFeedback = nil
                                answerText = ""
                            } label: {
                                Text(qIndex + 1 >= round.questions.count ? "결과 보기" : "다음 질문")
                            }
                            .buttonStyle(SKPrimaryButtonStyle())
                        } else {
                            answerArea(question)
                        }
                    }
                    .padding(.horizontal, SK.gutter)
                    .padding(.top, 18)
                    .padding(.bottom, 28)
                }
                .scrollDismissesKeyboard(.interactively)
            }
        }
    }

    private func questionCard(_ q: FeynmanQuestion, index: Int) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Text("Q\(index + 1)")
                    .font(.footnote.weight(.bold).monospacedDigit())
                    .foregroundStyle(.secondary)
                if let stage = q.stage, !stage.isEmpty {
                    SKChip(text: stage, style: .tint(StudioKind.feynman.textTint))
                }
                if let w = q.weight, w > 1 {
                    SKChip(text: "중요도 \(w)", icon: "star.fill")
                }
            }
            MarkdownText(markdown: q.question)
                .font(.system(size: 19))
                .padding(.top, 8)
        }
        .skCard()
    }

    private func answerArea(_ q: FeynmanQuestion) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SKSectionLabel("내 답변 — 소리 내어 설명하듯 적어 보세요 (키보드 마이크로 받아쓰기 가능)")
            TextEditor(text: $answerText)
                .font(.system(size: 16))
                .scrollContentBackground(.hidden)
                .frame(minHeight: 140)
                .padding(10)
                .background(SK.surface, in: RoundedRectangle(cornerRadius: SK.rMd, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: SK.rMd, style: .continuous)
                        .strokeBorder(SK.hairline, lineWidth: 1)
                )
            HStack(spacing: 10) {
                Button("모르겠어요") {
                    Task { await submit(q, answer: "") }
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .tint(.secondary)
                .disabled(grading)

                Button {
                    Task { await submit(q, answer: answerText) }
                } label: {
                    if grading {
                        ProgressView().controlSize(.small).tint(Color(.systemBackground))
                    } else {
                        Label("제출", systemImage: "paperplane.fill")
                    }
                }
                .buttonStyle(SKPrimaryButtonStyle())
                .disabled(grading || answerText.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    private func feedbackCard(_ fb: (score: Int, body: String)) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 12) {
                HStack(alignment: .firstTextBaseline, spacing: 3) {
                    Text("\(fb.score)")
                        .font(.system(size: 30, weight: .bold).monospacedDigit())
                        .foregroundStyle(SK.scoreTint(fb.score))
                    Text("/ 100")
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(.secondary)
                }
                Text(fb.score >= 80 ? "훌륭해요!" : fb.score >= 55 ? "핵심은 잡았어요" : "다시 확인해 봐요")
                    .font(.headline)
                Spacer(minLength: 0)
            }
            Divider()
                .padding(.horizontal, -SK.cardPad)
                .padding(.vertical, 13)
            MarkdownText(markdown: fb.body)
        }
        .skCard(border: SK.scoreTint(fb.score).opacity(0.6))
    }

    private func submit(_ q: FeynmanQuestion, answer: String) async {
        guard var c = content else { return }
        grading = true
        defer { grading = false }
        do {
            let raw = try await ai.feynmanGrade(
                manifest: item.combinedManifest,
                question: q.question,
                modelAnswer: q.modelAnswer,
                userAnswer: answer,
                multi: item.isMultiSource
            )
            let (body, score) = StudioParse.parseScore(raw)
            var round = c.rounds[c.currentRound]
            round.answers.append(FeynmanAnswer(userAnswer: answer, score: score, feedback: body))
            if round.answers.count >= round.questions.count {
                round.finalScore = StudioParse.weightedScore(round)
                round.status = "done"
            }
            c.rounds[c.currentRound] = round
            content = c
            persist(c)
            lastFeedback = (score, body)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: 회차 리포트

    private func reportView(_ round: FeynmanRound) -> some View {
        VStack(spacing: 0) {
            StudioResultHeader(kind: .feynman, title: item.title, meta: item.headerMeta)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let fb = lastFeedback {
                        feedbackCard(fb)
                        Button("피드백 닫기") { lastFeedback = nil }
                            .font(.footnote)
                            .tint(.secondary)
                    }

                    scoreHero(round)

                    if let c = content, c.rounds.count > 1 {
                        VStack(alignment: .leading, spacing: 8) {
                            SKSectionLabel("회차")
                            roundPicker(c)
                        }
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        SKSectionLabel("문항별 결과")
                        questionResults(round)
                    }

                    Button {
                        Task { await startReviewRound(from: round) }
                    } label: {
                        if generatingReview {
                            ProgressView().tint(Color(.systemBackground))
                        } else {
                            Label("미흡 영역 \(round.index + 2)회차 시작", systemImage: "arrow.trianglehead.counterclockwise")
                        }
                    }
                    .buttonStyle(SKPrimaryButtonStyle())
                    .disabled(generatingReview)
                }
                .padding(.horizontal, SK.gutter)
                .padding(.top, 14)
                .padding(.bottom, 28)
            }
        }
    }

    private func scoreHero(_ round: FeynmanRound) -> some View {
        let score = round.finalScore ?? 0
        let previous = content?.rounds.first(where: { $0.index == round.index - 1 })?.finalScore
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                SKChip(text: "\(round.index + 1)회차", style: .tint(StudioKind.feynman.tint))
                if let f = round.focus, !f.isEmpty {
                    SKChip(text: "미흡 영역 복습")
                }
            }
            HStack(alignment: .center, spacing: 16) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text("\(score)")
                        .font(.system(size: 46, weight: .bold).monospacedDigit())
                    Text("/ 100")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.secondary)
                }
                VStack(alignment: .trailing, spacing: 5) {
                    scoreBars(round)
                    Text("문항별 점수")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(.top, 14)

            Text(heroMeta(round, previous: previous))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.top, 10)
        }
        .skFlat()
    }

    private func heroMeta(_ round: FeynmanRound, previous: Int?) -> String {
        var parts = ["가중 평균 점수", "\(round.questions.count)문항"]
        if let previous, let score = round.finalScore {
            let delta = score - previous
            parts.append("\(round.index)회차 대비 \(delta >= 0 ? "+" : "")\(delta)")
        }
        return parts.joined(separator: " · ")
    }

    private func scoreBars(_ round: FeynmanRound) -> some View {
        HStack(alignment: .bottom, spacing: 3) {
            ForEach(Array(round.answers.enumerated()), id: \.offset) { _, a in
                Capsule()
                    .fill(SK.scoreTint(a.score))
                    .frame(width: 11, height: max(4, 34 * CGFloat(a.score) / 100))
            }
        }
        .frame(height: 34, alignment: .bottom)
    }

    private func questionResults(_ round: FeynmanRound) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(round.questions.enumerated()), id: \.offset) { idx, q in
                if idx < round.answers.count {
                    let a = round.answers[idx]
                    if idx > 0 { Divider().padding(.leading, 14) }
                    Button {
                        withAnimation(.smooth(duration: 0.22)) {
                            if expanded.contains(idx) { expanded.remove(idx) } else { expanded.insert(idx) }
                        }
                    } label: {
                        HStack(spacing: 12) {
                            Text("Q\(idx + 1). \(q.question.replacingOccurrences(of: #"\[t:[\d:.]+\]"#, with: "", options: .regularExpression))")
                                .font(.system(size: 15, weight: .medium))
                                .foregroundStyle(.primary)
                                .lineLimit(1)
                            Spacer(minLength: 4)
                            SKChip(text: "\(a.score)", style: .score(a.score))
                            Image(systemName: "chevron.down")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(.tertiary)
                                .rotationEffect(.degrees(expanded.contains(idx) ? 0 : -90))
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 13)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)

                    if expanded.contains(idx) {
                        VStack(alignment: .leading, spacing: 10) {
                            if !a.userAnswer.isEmpty {
                                ChipText("**내 답변** — \(a.userAnswer)")
                                    .font(.system(size: 15))
                                    .lineSpacing(4)
                                    .foregroundStyle(.secondary)
                            }
                            VStack(alignment: .leading, spacing: 10) {
                                MarkdownText(markdown: a.feedback)
                                DisclosureGroup("모범답안") {
                                    MarkdownText(markdown: q.modelAnswer)
                                        .padding(.top, 6)
                                }
                                .font(.footnote.weight(.semibold))
                                .tint(.secondary)
                            }
                            .skFlat(12)
                        }
                        .padding(.horizontal, 14)
                        .padding(.bottom, 14)
                    }
                }
            }
        }
        .background(SK.surface, in: RoundedRectangle(cornerRadius: SK.rMd, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: SK.rMd, style: .continuous)
                .strokeBorder(SK.hairline, lineWidth: 1)
        )
    }

    private func roundPicker(_ c: FeynmanContent) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 7) {
                ForEach(Array(c.rounds.enumerated()), id: \.offset) { idx, r in
                    Button {
                        var updated = c
                        updated.currentRound = idx
                        content = updated
                        persist(updated)
                        lastFeedback = nil
                    } label: {
                        Text("\(idx + 1)회차 · \(r.finalScore.map { "\($0)점" } ?? "진행 중")")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(idx == c.currentRound ? Color(.systemBackground) : .secondary)
                            .padding(.horizontal, 13)
                            .frame(height: 32)
                            .background(idx == c.currentRound ? Color.primary : SK.surface2, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func startReviewRound(from round: FeynmanRound) async {
        guard var c = content else { return }
        generatingReview = true
        defer { generatingReview = false }
        do {
            var opts = Prompts.StudioOptions()
            opts.reviewFocus = StudioParse.reviewFocus(from: round)
            let raw = try await ai.generate(kind: .feynman, opts: opts, manifest: item.combinedManifest, multi: item.isMultiSource)
            let parsed = try StudioParse.feynmanQuestions(raw: raw)
            let newRound = FeynmanRound(
                index: c.rounds.count,
                questions: parsed.questions,
                answers: [],
                finalScore: nil,
                status: "active",
                createdAt: Date.now.timeIntervalSince1970,
                focus: opts.reviewFocus
            )
            c.rounds.append(newRound)
            c.currentRound = c.rounds.count - 1
            content = c
            persist(c)
            lastFeedback = nil
            answerText = ""
            expanded = []
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func persist(_ c: FeynmanContent) {
        item.contentJSON = StudioParse.encodeContent(c)
        try? context.save()
    }
}
