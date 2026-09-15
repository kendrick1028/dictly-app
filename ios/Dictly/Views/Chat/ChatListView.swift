import SwiftUI
import SwiftData

/// 채팅 탭 루트 — 대화 목록 (날짜 그룹 + 플로팅 새 대화 버튼)
struct ChatListView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \ChatThread.updatedAt, order: .reverse) private var threads: [ChatThread]

    @State private var search = ""
    @State private var navPath = NavigationPath()

    private var filtered: [ChatThread] {
        guard !search.isEmpty else { return threads }
        return threads.filter { thread in
            thread.title.localizedCaseInsensitiveContains(search) ||
            (thread.messages ?? []).contains { $0.text.localizedCaseInsensitiveContains(search) }
        }
    }

    /// 오늘 / 어제 / 지난 7일 / 지난 30일 / 이전
    private var groups: [(title: String, threads: [ChatThread])] {
        let cal = Calendar.current
        let today = cal.startOfDay(for: .now)
        var buckets: [(String, [ChatThread])] = [("오늘", []), ("어제", []), ("지난 7일", []), ("지난 30일", []), ("이전", [])]
        for thread in filtered {
            let day = cal.startOfDay(for: thread.updatedAt)
            let diff = cal.dateComponents([.day], from: day, to: today).day ?? 0
            let idx = diff <= 0 ? 0 : diff == 1 ? 1 : diff < 7 ? 2 : diff < 30 ? 3 : 4
            buckets[idx].1.append(thread)
        }
        return buckets.filter { !$0.1.isEmpty }
    }

    var body: some View {
        NavigationStack(path: $navPath) {
            List {
                if threads.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("아직 대화가 없습니다.")
                            .foregroundStyle(.secondary)
                        Text("오른쪽 아래 버튼으로 새 대화를 시작하고, @로 노트나 폴더를 인용해 질문해 보세요.")
                            .font(.footnote)
                            .foregroundStyle(.tertiary)
                    }
                    .listRowBackground(Color.clear)
                }
                ForEach(groups, id: \.title) { group in
                    Section(group.title) {
                        ForEach(group.threads) { thread in
                            NavigationLink(value: thread) {
                                row(thread)
                            }
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) {
                                    context.delete(thread)
                                    try? context.save()
                                } label: {
                                    Label("삭제", systemImage: "trash")
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("채팅")
            .searchable(text: $search, prompt: "대화 검색")
            .scrollEdgeEffectHidden(true, for: .bottom)
            .navigationDestination(for: ChatThread.self) { thread in
                ChatView(thread: thread) {
                    // 대화 화면 우상단 새 채팅 — 새 스레드를 스택 위로 push
                    let newThread = ChatThread()
                    context.insert(newThread)
                    try? context.save()
                    navPath.append(newThread)
                }
            }
            // 새 대화 — 목록 위 플로팅 글라스 버튼
            .overlay(alignment: .bottomTrailing) {
                Button {
                    let thread = ChatThread()
                    context.insert(thread)
                    try? context.save()
                    navPath.append(thread)
                } label: {
                    Image(systemName: "square.and.pencil")
                        .font(.title2.weight(.semibold))
                        .frame(width: 64, height: 64)
                }
                .buttonStyle(.plain)
                .glassEffect(.regular.interactive(), in: .circle)
                .padding(.trailing, 20)
                .padding(.bottom, 10)
            }
            // 나갔다 온 빈 대화는 정리한다 (첫 메시지 전에 뒤로 간 경우)
            .onAppear {
                for thread in threads where (thread.messages ?? []).isEmpty
                    && thread.createdAt < .now.addingTimeInterval(-5) {
                    context.delete(thread)
                }
                try? context.save()
            }
        }
    }

    private func row(_ thread: ChatThread) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(thread.title)
                .font(.body.weight(.semibold))
                .lineLimit(1)
            if let preview = snippet(thread) {
                Text(preview)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 3)
    }

    private static let blockPrefix = try! NSRegularExpression(pattern: "^[\\s#>\\-\\*]+")

    /// 마지막 메시지 미리보기 — 인용 마커는 이름으로, 블록 마크다운 기호는 제거,
    /// 줄바꿈은 공백으로 접어 빈 줄이 남지 않게 한 뒤 인라인 마크다운(굵게 등)을 렌더
    private func snippet(_ thread: ChatThread) -> AttributedString? {
        guard let last = thread.sortedMessages.last else { return nil }
        var text = ChatTokenMarker.plain(last.text)
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            text = last.imageNames.isEmpty && last.files.isEmpty ? "" : "(첨부)"
        }
        guard !text.isEmpty else { return nil }
        let collapsed = text
            .components(separatedBy: .newlines)
            .map { line -> String in
                let ns = line as NSString
                let range = Self.blockPrefix.rangeOfFirstMatch(in: line, range: NSRange(location: 0, length: ns.length))
                return range.location == 0 && range.length > 0 ? ns.substring(from: range.length) : line
            }
            .filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
            .joined(separator: " ")
        return MarkdownText.inlineAttributed(String(collapsed.prefix(160)))
    }
}
