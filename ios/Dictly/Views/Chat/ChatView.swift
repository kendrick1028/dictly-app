import SwiftUI
import SwiftData
import PhotosUI
import PDFKit
import UniformTypeIdentifiers

/// 대화 화면 — 메시지 스트림 + 하단 컴포저(@멘션 인용, 첨부, 모델 칩)
struct ChatView: View {
    @Bindable var thread: ChatThread
    /// 우상단 새 채팅 버튼 (ChatListView 가 새 스레드 push 로 연결)
    var onNewChat: () -> Void = {}

    @Environment(\.modelContext) private var context
    @Environment(AIService.self) private var ai
    @Environment(AppSettings.self) private var settings
    @Query(sort: \Memo.createdAt, order: .reverse) private var allMemos: [Memo]
    @Query(sort: \Folder.createdAt) private var allFolders: [Folder]

    // 토큰 에디터 상태 — 인용 토큰은 입력 필드 안에 첨부로 산다
    @State private var composerAttr = NSAttributedString(string: "")
    @State private var composerHeight: CGFloat = 26
    @State private var mentionQ: String?
    @State private var editor = TokenEditorController()

    @State private var pending = false
    @State private var errorMessage: String?
    // 타자기 출력 상태 — 타이핑 중인 메시지는 마크다운 대신 plain 텍스트로 그린다
    @State private var typingMsgID: UUID?
    @State private var typingCancelled = false

    // 전송 대기 첨부 (이미지·파일 — 노트/폴더 인용은 에디터 안 토큰으로)
    @State private var pendingImages: [Data] = []
    @State private var pendingFiles: [ChatFile] = []

    /// 에디터 안에 현재 들어 있는 인용 토큰들
    private var composerRefs: [ChatRef] { composerAttr.chatSerialized.refs }

    // 피커 표시 상태
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var showPhotoPicker = false
    @State private var showCamera = false
    @State private var showFilePicker = false
    @State private var showRefPicker = false
    @State private var showModelMenu = false

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    ForEach(thread.sortedMessages) { msg in
                        messageView(msg)
                            .id(msg.uuid)
                    }
                    if pending {
                        Text("생각 중…")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .shimmering(true)
                            .id("pending")
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                // 맨 아래로 내렸을 때 마지막 메시지가 입력 필드에 붙지 않게 숨 쉴 틈
                .padding(.bottom, 28)
            }
            .scrollDismissesKeyboard(.interactively)
            .scrollEdgeEffectHidden(true, for: .bottom)
            // 타자기 출력 중 매 틱 scrollTo 를 부르면 화면 전체가 깜빡인다 —
            // 콘텐츠가 자랄 때 바닥을 유지하는 네이티브 앵커로 대체
            .defaultScrollAnchor(.bottom, for: .sizeChanges)
            .onChange(of: thread.messages?.count) { _, _ in
                guard let id = thread.sortedMessages.last?.uuid else { return }
                withAnimation(.smooth(duration: 0.25)) {
                    proxy.scrollTo(id, anchor: .bottom)
                }
            }
            .onChange(of: pending) { _, isPending in
                if isPending {
                    withAnimation(.smooth(duration: 0.25)) { proxy.scrollTo("pending", anchor: .bottom) }
                }
            }
            .onAppear {
                if let id = thread.sortedMessages.last?.uuid {
                    proxy.scrollTo(id, anchor: .bottom)
                }
            }
            // 빈 새 대화 — 최근 노트·폴더를 입력창 위에 제안 (탭 = 인용 칩 추가)
            .overlay(alignment: .bottomLeading) {
                if thread.sortedMessages.isEmpty && !pending {
                    emptySuggestions
                }
            }
        }
        .navigationTitle(thread.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarVisibility(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    onNewChat()
                } label: {
                    Image(systemName: "square.and.pencil")
                }
            }
        }
        .onDisappear { typingCancelled = true }
        .safeAreaInset(edge: .bottom, spacing: 0) { composer }
        .alert("오류", isPresented: .init(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("확인") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
        .photosPicker(isPresented: $showPhotoPicker, selection: $photoItems, maxSelectionCount: 4, matching: .images)
        .onChange(of: photoItems) { _, items in
            guard !items.isEmpty else { return }
            Task {
                for item in items {
                    if let data = try? await item.loadTransferable(type: Data.self),
                       let jpeg = ChatImage.jpeg(from: data) {
                        pendingImages.append(jpeg)
                    }
                }
                photoItems = []
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in
                if let jpeg = ChatImage.jpeg(from: image) { pendingImages.append(jpeg) }
            }
            .ignoresSafeArea()
        }
        .fileImporter(isPresented: $showFilePicker,
                      allowedContentTypes: [.pdf, .plainText, .text, .commaSeparatedText, .json],
                      allowsMultipleSelection: true) { result in
            if case .success(let urls) = result {
                for url in urls { importFile(url) }
            }
        }
        .sheet(isPresented: $showRefPicker) {
            RefPickerSheet(existing: composerRefs) { ref in
                insertRef(ref)
            }
            .presentationDetents([.medium, .large])
        }
    }

    // MARK: - 메시지 렌더링

    @ViewBuilder
    private func messageView(_ msg: ChatMsg) -> some View {
        if msg.role == "user" {
            VStack(alignment: .trailing, spacing: 6) {
                if !msg.files.isEmpty {
                    WrapChips(alignment: .trailing) {
                        ForEach(msg.files) { file in fileChip(file.name, removable: false) }
                    }
                }
                if !msg.imageNames.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(msg.imageNames, id: \.self) { name in
                            if let img = ChatImage.load(name) {
                                Image(uiImage: img)
                                    .resizable()
                                    .scaledToFill()
                                    .frame(width: 88, height: 88)
                                    .clipShape(RoundedRectangle(cornerRadius: 12))
                            }
                        }
                    }
                }
                if !msg.text.isEmpty {
                    // 인용 토큰 마커를 파란 인라인 토큰으로 복원해 입력창과 똑같이 보여준다
                    bubbleText(msg.text)
                        .font(.system(size: 16.5))
                        .lineSpacing(5)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.leading, 48)
        } else if msg.uuid == typingMsgID {
            // 타이핑 중 — 매 틱 마크다운 재파싱을 피하려고 plain 텍스트로 흘리고,
            // 완료되면 아래 분기의 마크다운 렌더로 바뀐다
            Text(msg.text)
                .font(.system(size: 16.5))
                .lineSpacing(5)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            MarkdownText(markdown: msg.text)
                .font(.system(size: 16.5))
                .lineSpacing(5)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
    }

    // MARK: - 빈 대화 제안 (최근 노트 2 + 폴더 1)

    private var recentSuggestions: [ChatRef] {
        var refs: [ChatRef] = allMemos.prefix(2).map { ChatRef(kind: "memo", uuid: $0.uuid, name: $0.title) }
        if let folder = allMemos.first(where: { $0.folder != nil })?.folder ?? allFolders.last {
            refs.append(ChatRef(kind: "folder", uuid: UUID(), name: folder.name))
        }
        // 이미 인용한 항목은 제안에서 뺀다
        let existing = composerRefs
        return refs.filter { ref in !existing.contains { $0.kind == ref.kind && $0.name == ref.name } }
    }

    private var emptySuggestions: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(recentSuggestions) { ref in
                Button {
                    insertRef(ref)
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: ref.isFolder ? "folder.fill" : "doc.text.fill")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .frame(width: 24)
                        Text(ref.name)
                            .font(.body)
                            .foregroundStyle(.primary.opacity(0.85))
                            .lineLimit(1)
                    }
                    .padding(.vertical, 11)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 26)
        .padding(.bottom, 6)
    }

    // MARK: - 컴포저

    private var composer: some View {
        VStack(spacing: 8) {
            if let query = mentionQ {
                mentionSuggestions(query)
            }
            VStack(alignment: .leading, spacing: 12) {
                // 이미지·파일 첨부 미리보기 (노트/폴더 인용은 아래 에디터 안 토큰)
                if !pendingFiles.isEmpty || !pendingImages.isEmpty {
                    attachmentsPreview
                }
                TokenTextEditor(text: $composerAttr,
                                height: $composerHeight,
                                mentionQuery: $mentionQ,
                                controller: editor,
                                placeholder: "무엇이든 물어보세요")
                    .frame(height: composerHeight)
                HStack(spacing: 10) {
                    plusMenu
                    modelChip
                    Spacer()
                    Button(action: send) {
                        Image(systemName: "arrow.up")
                            .font(.body.weight(.bold))
                            .foregroundStyle(.black)
                            .frame(width: 36, height: 36)
                            // 라이트/다크 무관하게 또렷한 흰 원 + 검은 화살표
                            .background(Color.white, in: .circle)
                            .opacity(canSend ? 1 : 0.35)
                    }
                    .buttonStyle(.plain)
                    .disabled(!canSend)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 12)
            .glassEffect(.regular, in: .rect(cornerRadius: 28))
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 10)
    }

    /// 이미지 썸네일 + 파일 토큰 미리보기
    private var attachmentsPreview: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !pendingImages.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(Array(pendingImages.enumerated()), id: \.offset) { index, data in
                            if let img = UIImage(data: data) {
                                Image(uiImage: img)
                                    .resizable()
                                    .scaledToFill()
                                    .frame(width: 56, height: 56)
                                    .clipShape(RoundedRectangle(cornerRadius: 10))
                                    .overlay(alignment: .topTrailing) {
                                        Button {
                                            pendingImages.remove(at: index)
                                        } label: {
                                            Image(systemName: "xmark.circle.fill")
                                                .font(.caption)
                                                .foregroundStyle(.white, .black.opacity(0.6))
                                        }
                                        .padding(2)
                                    }
                            }
                        }
                    }
                }
            }
            if !pendingFiles.isEmpty {
                WrapChips(alignment: .leading, spacing: 12) {
                    ForEach(pendingFiles) { file in
                        inlineToken(icon: "paperclip", name: file.name) {
                            pendingFiles.removeAll { $0.name == file.name }
                        }
                    }
                }
            }
        }
    }

    /// 파란 인라인 인용 토큰 (레퍼런스: 아이콘 + 이름, 배경 없음, 탭하면 제거)
    private func inlineToken(icon: String, name: String, onRemove: @escaping () -> Void) -> some View {
        Button(action: onRemove) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.subheadline)
                Text(name)
                    .font(.system(size: 16.5, weight: .medium))
                    .lineLimit(1)
            }
            .foregroundStyle(.blue)
        }
        .buttonStyle(.plain)
    }

    /// 말풍선용 — 마커(⟦F|이름⟧/⟦N|이름⟧)를 파란 아이콘+이름 토큰으로 복원한 Text
    private func bubbleText(_ raw: String) -> Text {
        guard raw.contains("⟦") else { return Text(raw) }
        let ns = raw as NSString
        var result = Text(verbatim: "")
        var last = 0
        for match in ChatTokenMarker.regex.matches(in: raw, range: NSRange(location: 0, length: ns.length)) {
            result = result + Text(ns.substring(with: NSRange(location: last, length: match.range.location - last)))
            let kind = ns.substring(with: match.range(at: 1))
            let name = ns.substring(with: match.range(at: 2))
            let icon = kind == "F" ? "folder.fill" : "doc.text.fill"
            result = result + (Text(Image(systemName: icon)) + Text(" \(name)"))
                .fontWeight(.medium)
                .foregroundStyle(.blue)
            last = match.range.location + match.range.length
        }
        result = result + Text(ns.substring(from: last))
        return result
    }

    private func fileChip(_ name: String, removable: Bool) -> some View {
        HStack(spacing: 5) {
            Image(systemName: "paperclip")
                .font(.caption2)
            Text(name)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
            if removable {
                Button {
                    pendingFiles.removeAll { $0.name == name }
                } label: {
                    Image(systemName: "xmark")
                        .font(.caption2.weight(.bold))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.quaternary.opacity(0.5), in: Capsule())
    }

    // MARK: + 메뉴 / 모델 칩

    private var plusMenu: some View {
        Menu {
            Button {
                showCamera = true
            } label: {
                Label("카메라", systemImage: "camera")
            }
            Button {
                showPhotoPicker = true
            } label: {
                Label("사진", systemImage: "photo")
            }
            Button {
                showFilePicker = true
            } label: {
                Label("파일", systemImage: "paperclip")
            }
            Divider()
            Button {
                showRefPicker = true
            } label: {
                Label("노트·폴더 인용", systemImage: "at")
            }
        } label: {
            Image(systemName: "plus")
                .font(.body.weight(.semibold))
                .frame(width: 34, height: 34)
                .background(.quaternary.opacity(0.5), in: .circle)
        }
        .buttonStyle(.plain)
        .tint(.primary)
    }

    /// 채팅 엔진/모델 칩 — 시스템 Menu 는 체크를 왼쪽에 강제하므로,
    /// 체크를 오른쪽에 두기 위해 커스텀 팝오버를 쓴다
    private var modelChip: some View {
        Button {
            showModelMenu = true
        } label: {
            HStack(spacing: 4) {
                Text(chipLabel)
                    .font(.footnote.weight(.semibold))
                    .lineLimit(1)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 13)
            .frame(height: 36)
            .background(.quaternary, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.primary.opacity(0.15), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .tint(.primary)
        .popover(isPresented: $showModelMenu, arrowEdge: .bottom) {
            modelMenuContent
                .presentationCompactAdaptation(.popover)
        }
    }

    private var modelMenuContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                modelRow("Apple Intelligence", .apple, "")
                sectionHeader("GPT")
                modelRow("5.6 Sol", .openai, "gpt-5.6-sol")
                modelRow("5.6 Terra", .openai, "gpt-5.6-terra")
                modelRow("5.6 Luna", .openai, "gpt-5.6-luna")
                sectionHeader("Claude")
                modelRow("Opus 4.8", .anthropic, "claude-opus-4-8")
                modelRow("Sonnet 4.6", .anthropic, "claude-sonnet-4-6")
                modelRow("Sonnet 4.5", .anthropic, "claude-sonnet-4-5")
                sectionHeader("Gemini")
                modelRow("3 Pro", .gemini, "gemini-3-pro")
                modelRow("2.5 Flash", .gemini, "gemini-2.5-flash")
                sectionHeader("Grok")
                modelRow("Grok 4", .grok, "grok-4")
                modelRow("Grok 4 Fast", .grok, "grok-4-fast")
            }
            .padding(.vertical, 10)
        }
        .frame(width: 250, height: 470)
    }

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 4)
    }

    /// 체크 표시를 오른쪽 끝에 정렬한 선택 행
    private func modelRow(_ title: String, _ engine: EngineChoice, _ model: String) -> some View {
        Button {
            select(engine, model)
            showModelMenu = false
        } label: {
            HStack {
                Text(title)
                    .font(.subheadline)
                Spacer()
                if engine == .apple ? settings.chatEngine == .apple : isModel(engine, model) {
                    Image(systemName: "checkmark")
                        .font(.footnote.weight(.semibold))
                }
            }
            .padding(.horizontal, 16)
            .frame(height: 40)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var canSend: Bool {
        let serialized = composerAttr.chatSerialized
        return !pending && (!serialized.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            || !pendingImages.isEmpty || !pendingFiles.isEmpty || !serialized.refs.isEmpty)
    }

    private func select(_ engine: EngineChoice, _ model: String) {
        settings.chatEngine = engine
        settings.chatModel = model
    }

    private func isModel(_ engine: EngineChoice, _ model: String) -> Bool {
        settings.chatEngine == engine && effectiveChatModel == model
    }

    private var effectiveChatModel: String {
        if !settings.chatModel.isEmpty { return settings.chatModel }
        switch settings.chatEngine {
        case .apple: return ""
        case .anthropic: return settings.anthropicModel
        case .openai: return settings.openaiModel
        case .gemini: return settings.geminiModel
        case .grok: return settings.grokModel
        }
    }

    private var chipLabel: String {
        switch settings.chatEngine {
        case .apple: return "Apple"
        case .anthropic:
            let m = effectiveChatModel
            if m.contains("opus-4-8") { return "Opus 4.8" }
            if m.contains("sonnet-4-6") { return "Sonnet 4.6" }
            if m.contains("sonnet-4-5") { return "Sonnet 4.5" }
            return "Claude"
        case .openai:
            let m = effectiveChatModel
            if m.contains("sol") { return "GPT Sol" }
            if m.contains("terra") { return "GPT Terra" }
            if m.contains("luna") { return "GPT Luna" }
            return "GPT"
        case .gemini:
            let m = effectiveChatModel
            if m.contains("3-pro") { return "Gemini 3 Pro" }
            if m.contains("2.5-flash") { return "Gemini Flash" }
            return "Gemini"
        case .grok:
            return effectiveChatModel.contains("fast") ? "Grok 4 Fast" : "Grok 4"
        }
    }

    // MARK: - @멘션

    private func mentionCandidates(_ query: String) -> [ChatRef] {
        let folders = allFolders
            .filter { query.isEmpty || $0.name.localizedCaseInsensitiveContains(query) }
            .map { ChatRef(kind: "folder", uuid: UUID(), name: $0.name) }
        // Folder 모델에는 uuid 가 없어 이름으로 식별한다 — ChatRef.uuid 는 칩 id 용도
        let memos = allMemos
            .filter { query.isEmpty || $0.title.localizedCaseInsensitiveContains(query) }
            .map { ChatRef(kind: "memo", uuid: $0.uuid, name: $0.title) }
        return Array((folders + memos).prefix(6))
    }

    private func mentionSuggestions(_ query: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(mentionCandidates(query)) { ref in
                Button {
                    // 에디터가 "@질의"를 토큰으로 치환한다
                    insertRef(ref)
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: ref.isFolder ? "folder.fill" : "doc.text.fill")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Text(ref.name)
                            .font(.subheadline)
                            .lineLimit(1)
                        Spacer()
                        Text(ref.isFolder ? "폴더" : "노트")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                    .padding(.horizontal, 14)
                    .frame(height: 40)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 6)
        .glassEffect(.regular, in: .rect(cornerRadius: 18))
    }

    /// 인용 토큰을 에디터 캐럿 위치에 삽입 (중복 인용은 무시)
    private func insertRef(_ ref: ChatRef) {
        guard !composerRefs.contains(where: { $0.kind == ref.kind && $0.name == ref.name }) else { return }
        editor.insert(ref)
    }

    // MARK: - 파일 첨부

    private func importFile(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let name = url.lastPathComponent
        var text = ""
        if url.pathExtension.lowercased() == "pdf" {
            text = PDFDocument(url: url)?.string ?? ""
        } else {
            text = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        }
        guard !text.isEmpty else {
            errorMessage = "'\(name)'에서 텍스트를 추출하지 못했습니다."
            return
        }
        pendingFiles.append(ChatFile(name: name, text: String(text.prefix(60_000))))
    }

    // MARK: - 전송

    private func send() {
        guard canSend else { return }
        let serialized = composerAttr.chatSerialized
        let text = serialized.text.trimmingCharacters(in: .whitespacesAndNewlines)

        var names: [String] = []
        for data in pendingImages {
            let name = UUID().uuidString + ".jpg"
            try? data.write(to: AppPaths.chatImagesDir.appendingPathComponent(name))
            names.append(name)
        }
        // text 에는 인용 토큰이 ⟦F|이름⟧/⟦N|이름⟧ 마커로 들어 있다 —
        // 말풍선은 마커를 파란 토큰으로 복원하고, AI 전송 시에는 이름으로 풀어 쓴다
        let msg = ChatMsg(role: "user", text: text, refs: serialized.refs, imageNames: names, files: pendingFiles)
        msg.thread = thread
        context.insert(msg)
        thread.updatedAt = .now
        try? context.save()

        composerAttr = NSAttributedString(string: "")
        pendingImages = []
        pendingFiles = []
        pending = true
        Task { await complete() }
    }

    private func complete() async {
        defer { pending = false }
        do {
            var msgs = buildAPIMessages()
            guard let last = msgs.popLast() else { return }
            let reply = try await ai.chatComplete(history: msgs, userMessage: last)
            let botMsg = ChatMsg(role: "assistant", text: "")
            botMsg.thread = thread
            context.insert(botMsg)
            thread.updatedAt = .now
            pending = false
            await typeOut(reply, into: botMsg)
            try? context.save()
            autoTitleIfNeeded()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// 타자기 출력 — 전체 답변을 ~3.5초에 걸쳐 흘려보낸다 (뷰 이탈 시 즉시 완성)
    private func typeOut(_ full: String, into msg: ChatMsg) async {
        typingCancelled = false
        typingMsgID = msg.uuid
        defer { typingMsgID = nil }
        let chars = Array(full)
        let step = max(2, chars.count / 140)
        var index = 0
        while index < chars.count, !typingCancelled {
            let next = min(chars.count, index + step)
            msg.text += String(chars[index..<next])
            index = next
            try? await Task.sleep(nanoseconds: 24_000_000)
        }
        if msg.text.count < chars.count { msg.text = full }
    }

    /// 스레드 → API 메시지 목록.
    /// 인용 자료(노트/폴더/파일)는 중복 없이 맨 앞에 한 번만 주입해 후속 질문에도 근거가 유지되게 한다.
    private func buildAPIMessages() -> [AIMessage] {
        let messages = thread.sortedMessages
        var seenRefs = Set<String>()
        var contextBlocks: [String] = []
        for msg in messages where msg.role == "user" {
            for ref in msg.refs {
                let key = ref.kind + ref.name
                guard seenRefs.insert(key).inserted else { continue }
                contextBlocks.append(refManifest(ref))
            }
            for file in msg.files {
                let key = "file" + file.name
                guard seenRefs.insert(key).inserted else { continue }
                contextBlocks.append("《파일: \(file.name)》\n\(file.text)")
            }
        }

        var result: [AIMessage] = []
        if !contextBlocks.isEmpty {
            let limit = settings.chatEngine == .apple ? 3200 : 100_000
            let block = AIService.truncate(contextBlocks.joined(separator: "\n\n"), limit: limit)
            result.append(AIMessage(role: .user, text: "[인용 자료]\n" + block))
            result.append(AIMessage(role: .assistant, text: "인용 자료를 확인했습니다."))
        }
        for msg in messages {
            // 인용 토큰 마커는 이름으로 풀어 자연스러운 문장으로 보낸다
            let clean = ChatTokenMarker.plain(msg.text)
            var am = AIMessage(role: msg.role == "user" ? .user : .assistant,
                               text: clean.isEmpty ? "(첨부를 참고해 주세요)" : clean)
            if msg.role == "user", !msg.imageNames.isEmpty {
                am.images = msg.imageNames.compactMap { name in
                    try? Data(contentsOf: AppPaths.chatImagesDir.appendingPathComponent(name))
                }
            }
            result.append(am)
        }
        return result
    }

    private func refManifest(_ ref: ChatRef) -> String {
        if ref.isFolder {
            guard let folder = allFolders.first(where: { $0.name == ref.name }) else {
                return "《폴더: \(ref.name)》 (삭제됨)"
            }
            let memos = (folder.memos ?? []).sorted { $0.createdAt < $1.createdAt }
            let body = memos.map { "[노트] \($0.title)\n\(String($0.transcriptText.prefix(30_000)))" }
                .joined(separator: "\n\n")
            return "《폴더: \(folder.name)》\n\(body)"
        }
        guard let memo = allMemos.first(where: { $0.uuid == ref.uuid })
            ?? allMemos.first(where: { $0.title == ref.name }) else {
            return "《노트: \(ref.name)》 (삭제됨)"
        }
        return "《노트: \(memo.title)》\n\(String(memo.transcriptText.prefix(40_000)))"
    }

    private func autoTitleIfNeeded() {
        guard thread.title == "새 대화" else { return }
        let msgs = thread.sortedMessages
        guard let firstUser = msgs.first(where: { $0.role == "user" }),
              let firstBot = msgs.first(where: { $0.role == "assistant" }) else { return }
        Task {
            if let title = try? await ai.chatTitle(firstUser: firstUser.text, firstAssistant: firstBot.text),
               !title.isEmpty {
                thread.title = String(title.prefix(30))
                try? context.save()
            }
        }
    }
}

// MARK: - 인용 대상 선택 시트 (+ 메뉴의 "노트·폴더 인용")

struct RefPickerSheet: View {
    /// 이미 입력창에 들어 있는 인용들 (체크 표시용)
    var existing: [ChatRef]
    /// 행 탭 = 입력창에 토큰 삽입
    var onPick: (ChatRef) -> Void

    @Environment(\.dismiss) private var dismiss
    @Query(sort: \Folder.createdAt) private var folders: [Folder]
    @Query(sort: \Memo.createdAt, order: .reverse) private var memos: [Memo]
    @State private var search = ""
    @State private var picked: [ChatRef] = []

    var body: some View {
        NavigationStack {
            List {
                Section("폴더") {
                    ForEach(folders.filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) }) { folder in
                        pickRow(ChatRef(kind: "folder", uuid: UUID(), name: folder.name), icon: "folder.fill")
                    }
                }
                Section("노트") {
                    ForEach(memos.filter { search.isEmpty || $0.title.localizedCaseInsensitiveContains(search) }) { memo in
                        pickRow(ChatRef(kind: "memo", uuid: memo.uuid, name: memo.title), icon: "doc.text.fill")
                    }
                }
            }
            .searchable(text: $search, prompt: "이름 검색")
            .navigationTitle("노트·폴더 인용")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("완료") { dismiss() }
                }
            }
        }
    }

    private func isSelected(_ ref: ChatRef) -> Bool {
        (existing + picked).contains { $0.kind == ref.kind && $0.name == ref.name }
    }

    private func pickRow(_ ref: ChatRef, icon: String) -> some View {
        Button {
            guard !isSelected(ref) else { return } // 제거는 입력창에서 백스페이스로
            picked.append(ref)
            onPick(ref)
        } label: {
            HStack {
                Label(ref.name, systemImage: icon)
                    .lineLimit(1)
                Spacer()
                if isSelected(ref) {
                    Image(systemName: "checkmark")
                        .font(.body.weight(.semibold))
                }
            }
        }
        .tint(.primary)
    }
}

// MARK: - 카메라

struct CameraPicker: UIViewControllerRepresentable {
    var onImage: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = UIImagePickerController.isSourceTypeAvailable(.camera) ? .camera : .photoLibrary
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage {
                parent.onImage(image)
            }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}

// MARK: - 이미지 유틸

enum ChatImage {
    /// 긴 변 1536px 로 줄인 JPEG (토큰·용량 절약)
    static func jpeg(from data: Data) -> Data? {
        guard let image = UIImage(data: data) else { return nil }
        return jpeg(from: image)
    }

    static func jpeg(from image: UIImage) -> Data? {
        let maxSide: CGFloat = 1536
        let size = image.size
        let scale = min(1, maxSide / max(size.width, size.height))
        let target = CGSize(width: size.width * scale, height: size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: target)
        let resized = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: target)) }
        return resized.jpegData(compressionQuality: 0.7)
    }

    static func load(_ name: String) -> UIImage? {
        UIImage(contentsOfFile: AppPaths.chatImagesDir.appendingPathComponent(name).path)
    }
}

// MARK: - 칩 줄바꿈 레이아웃

/// 폭을 넘치면 다음 줄로 흐르는 칩 컨테이너 (trailing 정렬 지원)
struct WrapChips: Layout {
    var alignment: HorizontalAlignment = .leading
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > maxWidth {
                widest = max(widest, x - spacing)
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        widest = max(widest, x - spacing)
        return CGSize(width: proposal.width ?? widest, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        // 줄 단위로 나눈 뒤 정렬 방향에 맞춰 배치한다
        var rows: [[(LayoutSubview, CGSize)]] = [[]]
        var x: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > bounds.width {
                rows.append([])
                x = 0
            }
            rows[rows.count - 1].append((view, size))
            x += size.width + spacing
        }
        var y = bounds.minY
        for row in rows {
            let rowWidth = row.reduce(0) { $0 + $1.1.width } + spacing * CGFloat(max(0, row.count - 1))
            let rowHeight = row.map(\.1.height).max() ?? 0
            var px = alignment == .trailing ? bounds.maxX - rowWidth : bounds.minX
            for (view, size) in row {
                view.place(at: CGPoint(x: px, y: y), proposal: ProposedViewSize(size))
                px += size.width + spacing
            }
            y += rowHeight + spacing
        }
    }
}
