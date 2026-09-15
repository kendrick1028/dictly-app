import SwiftUI
import SwiftData

/// 전사문 노트 안의 스튜디오 — 이 노트 하나를 소스로 즉시 생성(page 1)하고
/// 이 노트에서 만든 항목을 열람(page 2)한다. 생성 파이프라인은 StudioFolderView 와
/// 같은 문법(StudioParse/AIService)이되 소스가 단일 노트로 고정된 축약판이다.
struct MemoStudioPane: View {
    let memo: Memo
    @Binding var page: Int

    @Environment(\.modelContext) private var context
    @Environment(AIService.self) private var ai
    @Environment(AppSettings.self) private var settings
    @Query(sort: \StudioItem.createdAt, order: .reverse) private var allItems: [StudioItem]

    @State private var jobs: [StudioKind: String] = [:]
    @State private var optionsKind: StudioKind?
    @State private var errorMessage: String?
    @State private var openItem: StudioItem?

    /// 이 노트를 소스로 포함해 만든 항목만
    private var itemsForMemo: [StudioItem] {
        allItems.filter { item in
            item.sourceMemos.contains(where: { $0.uuid == memo.uuid })
        }
    }

    var body: some View {
        Group {
            if page == 2 {
                itemsList
            } else {
                featureGrid
            }
        }
        .sheet(item: $optionsKind) { kind in
            StudioOptionsSheet(kind: kind) { opts in
                startGeneration(kind: kind, opts: opts)
            }
            .presentationDetents([.medium, .large])
        }
        .navigationDestination(for: StudioItem.self) { item in
            StudioItemView(item: item)
        }
        .navigationDestination(item: $openItem) { item in
            StudioItemView(item: item)
        }
        .alert("오류", isPresented: .init(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("확인") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    // MARK: 스튜디오 (기능 그리드)

    private var featureGrid: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("이 노트로 만들기")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.secondary)
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    ForEach(StudioKind.allCases) { kind in
                        featureCard(kind)
                    }
                }
            }
            .padding(16)
            .padding(.bottom, 24)
        }
        .scrollEdgeEffectHidden(true, for: .bottom)
    }

    private func featureCard(_ kind: StudioKind) -> some View {
        Button {
            tapped(kind)
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Image(systemName: kind.icon)
                        .font(.title3)
                        .foregroundStyle(kind.tint)
                    Spacer()
                    if jobs[kind] != nil {
                        ProgressView().controlSize(.small)
                    }
                }
                Text(kind.name)
                    .font(.subheadline.bold())
                    .foregroundStyle(.primary)
                Text(jobs[kind] ?? kind.subtitle)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(kind.tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
        .disabled(jobs[kind] != nil)
    }

    // MARK: 항목

    private var itemsList: some View {
        List {
            if !jobs.isEmpty {
                Section("생성 중") {
                    ForEach(Array(jobs.keys), id: \.self) { kind in
                        HStack(spacing: 12) {
                            SKKindTile(kind: kind, size: 40, radius: 11)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(kind.name)
                                    .font(.system(size: 16, weight: .semibold))
                                Text(jobs[kind] ?? "생성 중…")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                                    .shimmering(true)
                            }
                            Spacer(minLength: 8)
                            ProgressView().controlSize(.small)
                        }
                        .padding(.vertical, 4)
                        .listRowBackground(Color.white.opacity(0.08))
                    }
                }
            }
            Section {
                if itemsForMemo.isEmpty && jobs.isEmpty {
                    VStack(spacing: 0) {
                        Image(systemName: "sparkles")
                            .font(.system(size: 22, weight: .medium))
                            .foregroundStyle(.secondary)
                            .frame(width: 46, height: 46)
                            .background(.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                            .padding(.bottom, 12)
                        Text("아직 만든 항목이 없어요")
                            .font(.headline)
                        Text("스튜디오 탭에서 이 노트로\n첫 결과물을 만들어 보세요")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.top, 5)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 28)
                    .listRowBackground(Color.clear)
                }
                ForEach(itemsForMemo) { item in
                    NavigationLink(value: item) {
                        HStack(spacing: 12) {
                            SKKindTile(kind: item.kind, size: 40, radius: 11)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.title)
                                    .font(.system(size: 16, weight: .semibold))
                                    .lineLimit(1)
                                Text(item.rowMeta)
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            Spacer(minLength: 8)
                            if let status = item.rowStatus {
                                SKChip(text: status.text, style: status.style)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .listRowBackground(Color.white.opacity(0.08))
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            context.delete(item)
                            try? context.save()
                        } label: {
                            Label("삭제", systemImage: "trash")
                        }
                    }
                }
            } header: {
                if !itemsForMemo.isEmpty {
                    Text("이 노트로 만든 항목 · \(itemsForMemo.count)")
                }
            }
        }
        .scrollContentBackground(.hidden)
        .scrollEdgeEffectHidden(true, for: .bottom)
    }

    // MARK: generation (단일 노트 소스)

    private func tapped(_ kind: StudioKind) {
        switch kind {
        case .chat:
            openChat()
        case .tutor:
            optionsKind = .tutor
        default:
            if kind.hasOptions {
                optionsKind = kind
            } else {
                startGeneration(kind: kind, opts: Prompts.StudioOptions())
            }
        }
    }

    private func newItem(kind: StudioKind, title: String, contentJSON: String) -> StudioItem {
        let item = StudioItem(kind: kind, title: title, contentJSON: contentJSON, memo: nil)
        item.folder = memo.folder
        item.sources = [memo]
        return item
    }

    private func startGeneration(kind: StudioKind, opts: Prompts.StudioOptions) {
        if kind == .tutor {
            let content = TutorContent(
                mode: opts.tutorMode,
                subject: opts.tutorSubject.isEmpty ? memo.title : opts.tutorSubject,
                roadmap: [], turns: [],
                difficulty: opts.tutorMode == "sprint" ? "중상" : "하",
                stats: TutorStats(), wrongNotes: [], status: "active"
            )
            let item = newItem(kind: .tutor, title: "\(content.subject) 튜터",
                               contentJSON: StudioParse.encodeContent(content))
            context.insert(item)
            try? context.save()
            openItem = item
            return
        }

        // 생성 시작 → 항목 탭으로 넘어가 진행 상황을 보여준다
        jobs[kind] = "생성 중…"
        withAnimation(.smooth(duration: 0.3)) { page = 2 }

        let manifest = memo.manifest
        let fallbackTitle = "\(memo.title) \(kind.name)"

        Task {
            defer { jobs[kind] = nil }
            do {
                var raw = try await ai.generate(kind: kind, opts: opts, manifest: manifest, multi: false)
                var normalized: (title: String, contentJSON: String)
                do {
                    normalized = try StudioParse.normalize(kind: kind, raw: raw, fallbackTitle: fallbackTitle)
                } catch {
                    jobs[kind] = "형식 재시도 중…"
                    raw = try await ai.generate(kind: kind, opts: opts, manifest: manifest, multi: false, retry: true)
                    normalized = try StudioParse.normalize(kind: kind, raw: raw, fallbackTitle: fallbackTitle)
                }
                var contentJSON = normalized.contentJSON
                if kind == .examRadar,
                   let data = contentJSON.data(using: .utf8),
                   let radar = try? JSONDecoder().decode(ExamRadarContent.self, from: data) {
                    contentJSON = StudioParse.encodeContent(StudioParse.blendExamRadar(radar, segments: memo.segments))
                }
                let item = newItem(kind: kind, title: normalized.title, contentJSON: contentJSON)
                context.insert(item)
                try? context.save()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func openChat() {
        if let existing = itemsForMemo.first(where: {
            $0.kind == .chat && $0.sourceMemos.map(\.uuid) == [memo.uuid]
        }) {
            openItem = existing
            return
        }
        let item = newItem(
            kind: .chat,
            title: "\(memo.title) 질문 채팅",
            contentJSON: StudioParse.encodeContent(ChatContent(turns: []))
        )
        context.insert(item)
        try? context.save()
        openItem = item
    }
}
