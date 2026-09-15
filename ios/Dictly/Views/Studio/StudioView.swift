import SwiftUI
import SwiftData

/// 스튜디오 스코프 — 폴더 또는 미분류
enum StudioScope: Hashable {
    case folder(Folder)
    case unfiled

    var folder: Folder? {
        if case .folder(let f) = self { return f }
        return nil
    }

    var title: String {
        switch self {
        case .folder(let f): f.name
        case .unfiled: "폴더 없음"
        }
    }
}

// MARK: - 폴더 스튜디오: 3페이지 (소스 선택 → 스튜디오 → 항목)
// 스튜디오 탭이 노트 탭에 통합되면서 이 뷰가 노트 탭의 폴더 뷰 역할을 겸한다

struct StudioFolderView: View {
    let scope: StudioScope

    @Environment(\.modelContext) private var context
    @Environment(AIService.self) private var ai
    @Environment(AppSettings.self) private var settings
    @Environment(AppState.self) private var appState
    @Query(sort: \Memo.createdAt, order: .reverse) private var allMemos: [Memo]
    @Query(sort: \StudioItem.createdAt, order: .reverse) private var allItems: [StudioItem]

    @State private var page = 1
    @State private var selection: Set<UUID> = []
    @State private var jobs: [StudioKind: String] = [:]
    @State private var optionsKind: StudioKind?
    @State private var errorMessage: String?
    @State private var openItem: StudioItem?
    @State private var sourcesExpanded = false
    @State private var panelMinimized = false
    @State private var showRename = false
    @State private var renameText = ""

    /// 아래로 스크롤하면 패널을 헤더만 남기고 접고, 위로 스크롤하면 되돌린다.
    /// 바운스 구간은 ScrollProbe 가 걸러내므로 맨 위·맨 아래에서 멋대로 열리지 않는다
    private func handleScroll(_ old: ScrollProbe, _ new: ScrollProbe) {
        guard let minimize = new.minimizeIntent(from: old),
              minimize != panelMinimized else { return }
        withAnimation(.smooth(duration: 0.32)) { panelMinimized = minimize }
    }

    private var memosInScope: [Memo] {
        switch scope {
        case .folder(let folder): allMemos.filter { $0.folder == folder }
        case .unfiled: allMemos.filter { $0.folder == nil }
        }
    }

    /// 이 스코프에서 생성된 항목 (신규 폴더 항목 + 구버전 단일 노트 항목)
    private var itemsInScope: [StudioItem] {
        allItems.filter { item in
            switch scope {
            case .folder(let folder):
                if item.folder == folder { return true }
                if let m = item.memo { return m.folder == folder }
                return false
            case .unfiled:
                if item.folder == nil, item.memo == nil, !(item.sources?.isEmpty ?? true) { return true }
                if let m = item.memo { return m.folder == nil }
                return false
            }
        }
    }

    private var selectedMemos: [Memo] {
        memosInScope.filter { selection.contains($0.uuid) }.sorted { $0.createdAt < $1.createdAt }
    }

    var body: some View {
        // TabView(.page) 는 페이지를 safe area 앞에서 클리핑해 리스트가 탭바 위에서 평평하게
        // 잘리고(iOS 27 기기에서 구분선으로 보임), safe area 를 조작하면 selection 동기화까지
        // 깨진다. 가로 ScrollView 페이징으로 교체 — 스크롤 뷰는 탭바 뒤까지 자연스럽게
        // 내려가고 안쪽 List 도 자동 인셋을 그대로 받는다
        ScrollView(.horizontal) {
            LazyHStack(spacing: 0) {
                sourcePage
                    .containerRelativeFrame(.horizontal)
                    .id(0)
                featurePage
                    .containerRelativeFrame(.horizontal)
                    .id(1)
                itemsPage
                    .containerRelativeFrame(.horizontal)
                    .id(2)
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.paging)
        .scrollPosition(id: $pagePos)
        .scrollIndicators(.hidden)
        // page(피커·로직의 기준) ↔ pagePos(스크롤 위치) 양방향 동기화.
        // 초기 정렬은 아래 진입 onAppear 가 페이지를 확정한 뒤 한 번만 수행한다 —
        // 여기서 먼저 맞춰버리면 진입 로직의 page 변경과 경합해 피커·콘텐츠가 어긋난다
        .onChange(of: page) { _, p in
            guard pagePos != p else { return }
            withAnimation(.smooth(duration: 0.3)) { pagePos = p }
        }
        .onChange(of: pagePos) { _, p in
            if let p, p != page { page = p }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            pagePicker
                .background(Color(.systemGroupedBackground))
        }
        // 소스·스튜디오 두 페이지에 걸쳐 같은 패널을 쓴다. 페이지별 오버레이로 두면
        // 스와이프 중 두 장이 같이 밀려 보이므로 컨테이너에 한 장만 얹는다
        .overlay(alignment: .bottom) {
            if page != 2 {
                selectedSourcesPanel
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        // 3페이지가 각각 List(그룹 배경)와 ScrollView(배경 없음)로 달라서 페이지 피커·콘텐츠·
        // 탭바 뒤 색이 어긋난다. 컨테이너에서 한 번만 칠하고 리스트 자체 배경은 숨긴다
        .background(Color(.systemGroupedBackground).ignoresSafeArea())
        .navigationTitle(scope.title)
        #if DEBUG
        .onAppear {
            if ProcessInfo.processInfo.environment["DICTLY_CAPTURE"] == "studio" { page = 1 }
        }
        #endif
        .navigationBarTitleDisplayMode(.inline)
        // 폴더 관리 (구 FolderDetailView 의 기능 이관)
        .toolbar {
            if let folder = scope.folder {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            renameText = folder.name
                            showRename = true
                        } label: {
                            Label("이름 변경", systemImage: "pencil")
                        }
                        Button {
                            folder.favorite.toggle()
                        } label: {
                            Label(folder.favorite ? "즐겨찾기 해제" : "즐겨찾기", systemImage: "star")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
        }
        .alert("폴더 이름 변경", isPresented: $showRename) {
            TextField("이름", text: $renameText)
            Button("변경") {
                let name = renameText.trimmingCharacters(in: .whitespaces)
                if !name.isEmpty { scope.folder?.name = name }
            }
            Button("취소", role: .cancel) {}
        }
        .navigationDestination(item: $openItem) { item in
            StudioItemView(item: item)
        }
        .sheet(item: $optionsKind) { kind in
            StudioOptionsSheet(kind: kind) { opts in
                startGeneration(kind: kind, opts: opts)
            }
            .presentationDetents([.medium, .large])
        }
        .alert("생성 실패", isPresented: .init(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("확인") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
        .onAppear {
            if let pre = appState.studioPreselect, memosInScope.contains(where: { $0.uuid == pre }) {
                selection.insert(pre)
                appState.studioPreselect = nil
                page = 1
            } else if selection.isEmpty && page == 1 && memosInScope.count == 1 {
                // 소스가 하나뿐이면 자동 선택
                selection = Set(memosInScope.map(\.uuid))
            } else if selection.isEmpty && !memosInScope.isEmpty && page == 1 {
                page = 0
            }
            // 진입 페이지가 확정된 뒤 페이저를 애니메이션 없이 한 번만 정렬
            if pagePos != page { pagePos = page }
        }
        // 선택을 줄여 접힌 높이에 다 들어가면 핸들이 사라지므로 펼침 상태도 같이 되돌린다
        .onChange(of: selectedMemos.count) { _, count in
            if count <= Self.collapsedSourceRows, sourcesExpanded {
                withAnimation(.smooth(duration: 0.3)) { sourcesExpanded = false }
            }
        }
    }

    // MARK: page picker

    /// 네이티브 세그먼트 썸 색 — 라이트: 흰색, 다크: 밝은 회색 (트랙보다 떠 보여야 한다)
    private static let pickerThumb = Color(UIColor { tc in
        tc.userInterfaceStyle == .dark ? .systemGray4 : .systemBackground
    })

    private var pagePicker: some View {
        // 세그먼티드 컨트롤처럼 트랙 배경 + 선택 썸이 미끄러지는 구조 —
        // 선택 칩만 덩그러니 강조되면 배경 없는 버튼들이 떠 보인다
        HStack(spacing: 0) {
            pageTab("소스", index: 0, badge: selection.isEmpty ? nil : "\(selection.count)")
            pageTab("스튜디오", index: 1, badge: nil)
            pageTab("항목", index: 2, badge: itemsInScope.isEmpty && jobs.isEmpty ? nil : "\(itemsInScope.count + jobs.count)")
        }
        .padding(3)
        .background(Color(.tertiarySystemFill), in: Capsule())
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    private func pageTab(_ title: String, index: Int, badge: String?) -> some View {
        Button {
            withAnimation(.smooth(duration: 0.3)) { page = index }
        } label: {
            HStack(spacing: 5) {
                Text(title)
                    .font(.subheadline.weight(page == index ? .semibold : .regular))
                if let badge {
                    Text(badge)
                        .font(.caption2.bold())
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(page == index ? Color.primary.opacity(0.15) : Color.gray.opacity(0.15), in: Capsule())
                }
            }
            .foregroundStyle(page == index ? .primary : .secondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 7)
            .background {
                if page == index {
                    Capsule()
                        .fill(Self.pickerThumb)
                        .shadow(color: .black.opacity(0.15), radius: 3, y: 1)
                        .matchedGeometryEffect(id: "pickerThumb", in: pickerNS)
                }
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: 1) 소스 선택

    private var sourcePage: some View {
        List {
            Section {
                if memosInScope.isEmpty {
                    Text("이 폴더에는 아직 녹음이 없습니다.")
                        .foregroundStyle(.secondary)
                        .font(.subheadline)
                }
                ForEach(memosInScope) { memo in
                    HStack(spacing: 12) {
                        // 체크박스만 선택을 토글한다 — .borderless 여야 행 전체로
                        // 히트 영역이 번지지 않아 나머지 영역이 상세로 들어갈 수 있다
                        Button {
                            if selection.contains(memo.uuid) {
                                selection.remove(memo.uuid)
                            } else {
                                selection.insert(memo.uuid)
                            }
                        } label: {
                            Image(systemName: selection.contains(memo.uuid) ? "checkmark.circle.fill" : "circle")
                                .font(.title3)
                                .foregroundStyle(selection.contains(memo.uuid) ? Color.primary : Color.secondary.opacity(0.5))
                                .padding(.vertical, 6)
                                .padding(.trailing, 4)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.borderless)

                        NavigationLink(value: memo) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(memo.title)
                                    .font(.subheadline.weight(.medium))
                                    .foregroundStyle(.primary)
                                    .lineLimit(1)
                                Text("\(memo.createdAt.shortString) · \(memo.durationSec.timeString)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            } header: {
                HStack {
                    Text("소스 노트")
                    Spacer()
                    Button(selection.count == memosInScope.count && !memosInScope.isEmpty ? "전체 해제" : "전체 선택") {
                        if selection.count == memosInScope.count {
                            selection.removeAll()
                        } else {
                            selection = Set(memosInScope.map(\.uuid))
                        }
                    }
                    .font(.caption)
                    .textCase(nil)
                }
            }
        }
        .scrollContentBackground(.hidden)
        // 탭바 위로 깔리는 스크롤 엣지 밴드가 패널 아래에 구분선처럼 보여서 끈다
        .scrollEdgeEffectHidden(true, for: .bottom)
        // 패널이 가리는 만큼 고정 인셋 — 확장/축소가 인셋을 건드리지 않게 한다.
        // 탭바 몫(~80)은 자동 인셋으로 들어오므로 패널 높이만 잡는다
        .contentMargins(.bottom, 210, for: .scrollContent)
        .onScrollGeometryChange(for: ScrollProbe.self) { ScrollProbe($0) } action: { old, new in
            handleScroll(old, new)
        }
    }

    // MARK: 2) 스튜디오 (기능 그리드 + 선택 소스 글라스 패널)

    private var featurePage: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    ForEach(StudioKind.allCases) { kind in
                        featureCard(kind)
                    }
                }
            }
            .padding(16)
            // 펼친 패널 높이까지 미리 확보한 고정 여백 — 확장/축소가 스크롤 인셋을
            // 건드리지 않아야 접힐 때 유리 뒤로 콘텐츠가 비치는 플래시가 없다.
            // 탭바 몫(~80)은 자동 인셋으로 들어오므로 패널 높이만 잡는다
            .padding(.bottom, 210)
        }
        .scrollEdgeEffectHidden(true, for: .bottom)
        .onScrollGeometryChange(for: ScrollProbe.self) { ScrollProbe($0) } action: { old, new in
            handleScroll(old, new)
        }
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
            .background(kind.tint.opacity(0.09), in: RoundedRectangle(cornerRadius: 14))
            .opacity(selection.isEmpty ? 0.45 : 1)
        }
        .buttonStyle(.plain)
        .disabled(jobs[kind] != nil || selection.isEmpty)
    }

    // 소스 목록 행 높이와 접힘/펼침 기준 — 패널 높이 계산에 그대로 쓰인다
    private static let sourceRowHeight: CGFloat = 32
    private static let collapsedSourceRows = 3
    private static let expandedSourceRows = 6

    /// 접은 상태에서 다 보이지 않는 소스가 있을 때만 드래그 핸들을 노출한다
    private var canExpandSources: Bool {
        selectedMemos.count > Self.collapsedSourceRows
    }

    /// 접었을 때(3행)·펼쳤을 때(최대 6행) 소스 목록 높이
    private var collapsedListHeight: CGFloat {
        CGFloat(min(selectedMemos.count, Self.collapsedSourceRows)) * Self.sourceRowHeight
    }
    private var expandedListHeight: CGFloat {
        CGFloat(min(selectedMemos.count, Self.expandedSourceRows)) * Self.sourceRowHeight
    }

    /// 드래그 중인 이동량(위로 끌면 +) — 손가락을 1:1로 따라오게 하는 값
    @State private var dragUp: CGFloat = 0
    @State private var dragging = false
    /// 제스처 인식 시점의 translation — minimumDistance 만큼의 초기 점프를 상쇄한다
    @State private var dragStartH: CGFloat = 0
    @Namespace private var pickerNS
    /// 가로 페이징 스크롤의 현재 페이지 (page 와 양방향 동기화).
    /// 초기값을 page 와 어긋난 상수로 두면 onChange 가 발화하지 않아 피커와 콘텐츠가
    /// 어긋난 채 시작한다 — onAppear 에서 page 로 맞춘다
    @State private var pagePos: Int?

    /// 손을 뗀 상태의 목표 높이
    private var baseListRevealed: CGFloat {
        panelMinimized ? 0 : (sourcesExpanded ? expandedListHeight : collapsedListHeight)
    }

    /// 실제로 그릴 높이 — 드래그 중이면 손가락 위치, 아니면 목표 높이
    private var listRevealed: CGFloat {
        guard dragging else { return baseListRevealed }
        return min(expandedListHeight, max(0, baseListRevealed + dragUp))
    }

    private func panelDragChanged(_ value: DragGesture.Value) {
        if !dragging {
            dragging = true
            dragStartH = value.translation.height
        }
        dragUp = -(value.translation.height - dragStartH)
    }

    private func panelDragEnded(_ value: DragGesture.Value) {
        settlePanel(predicted: baseListRevealed - (value.predictedEndTranslation.height - dragStartH))
    }

    /// 드래그를 끝낸 지점(투사 속도 포함)으로 정착할 상태를 고른다
    private func settlePanel(predicted: CGFloat) {
        withAnimation(.spring(response: 0.38, dampingFraction: 0.82)) {
            dragging = false
            dragUp = 0
            if predicted < collapsedListHeight * 0.5 {
                panelMinimized = true
                sourcesExpanded = false
            } else if !canExpandSources || predicted < (collapsedListHeight + expandedListHeight) * 0.5 {
                panelMinimized = false
                sourcesExpanded = false
            } else {
                panelMinimized = false
                sourcesExpanded = true
            }
        }
    }

    private func sourceListRow(_ memo: Memo) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "doc.text.fill")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(memo.title)
                .font(.caption)
                .lineLimit(1)
            Spacer(minLength: 8)
            Text(memo.durationSec.timeString)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .monospacedDigit()
        }
        .frame(height: Self.sourceRowHeight)
    }

    /// 선택된 소스 + 생성 엔진을 보여주는 하단 글라스 패널
    /// 소스가 3개를 넘으면 노트 탭 녹음 패널처럼 핸들을 끌어올려 나머지를 본다
    private var selectedSourcesPanel: some View {
        @Bindable var settings = settings
        return VStack(alignment: .leading, spacing: 0) {
            // drag handle — 노트 탭 녹음 패널과 같은 사양(42×5, 위 8 / 아래 9).
            // 3개 이하라 펼칠 게 없어도 패널 생김새를 맞추려고 항상 두고, 제스처만 막는다
            Capsule()
                .fill(Color.secondary.opacity(0.5))
                .frame(width: 42, height: 5)
                .frame(maxWidth: .infinity)
                .padding(.top, 8)
                .padding(.bottom, 9)
                // 핸들 히트 영역: 너무 부풀리면 바로 아래 헤더 행 탭까지 삼킨다
                .contentShape(Rectangle().inset(by: -10))
                .onTapGesture {
                    withAnimation(.spring(response: 0.38, dampingFraction: 0.82)) {
                        if panelMinimized {
                            panelMinimized = false
                        } else if canExpandSources {
                            sourcesExpanded.toggle()
                        }
                    }
                }
                // 임계값 토글이 아니라 손가락을 그대로 따라오게 한다 —
                // onChanged 는 애니메이션 없이 즉시 반영, 손을 뗄 때만 스프링으로 정착.
                // 좌표계는 반드시 .global — 로컬 기준이면 패널이 자라며 핸들이 움직이는 만큼
                // translation 이 반대로 튀어 매 프레임 진동(점멸)한다
                .gesture(
                    DragGesture(minimumDistance: 1, coordinateSpace: .global)
                        .onChanged(panelDragChanged)
                        .onEnded(panelDragEnded)
                )
            HStack {
                Label(selection.isEmpty ? "선택된 소스 없음" : "선택된 소스 \(selection.count)개",
                      systemImage: "doc.text.fill")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Menu {
                    ForEach(EngineChoice.allCases) { engine in
                        Button {
                            settings.studioEngine = engine
                        } label: {
                            if settings.studioEngine == engine {
                                Label(engine.label, systemImage: "checkmark")
                            } else {
                                Text(engine.label)
                            }
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "sparkles")
                        Text(settings.studioEngine.short)
                        Image(systemName: "chevron.up.chevron.down")
                            .font(.caption2)
                    }
                    .font(.caption)
                }
                .tint(.primary)
            }
            // 아래로 스크롤해 최소화되면 헤더만 남긴다
            if selection.isEmpty {
                if !panelMinimized {
                    Text("소스 페이지에서 노트를 선택하면 그 내용을 바탕으로 생성됩니다.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.top, 8)
                }
            } else {
                ScrollView(showsIndicators: sourcesExpanded) {
                    VStack(spacing: 0) {
                        ForEach(selectedMemos) { memo in
                            sourceListRow(memo)
                        }
                    }
                }
                .frame(height: listRevealed)
                .clipped()
                .opacity(min(1, listRevealed / 24))
                .padding(.top, min(8, listRevealed / 4))
                .scrollDisabled(!sourcesExpanded)
                .allowsHitTesting(!dragging)
            }
        }
        // 노트 탭 패널과 같은 방식 — 세로 여백은 핸들이 직접 갖고 컨테이너는 가로만 준다
        .padding(.horizontal, 14)
        .padding(.bottom, 14)
        // .interactive() — 탭바처럼 터치에 반응하는 표준 리퀴드 글라스
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 26))
        // 유리 전체를 히트 영역으로: 패널 위 스와이프가 뒤 콘텐츠 스크롤로 새지 않고,
        // 핸들이 아닌 곳을 쓸어도 확장/축소된다 (엔진 메뉴 탭은 10pt 임계로 보호.
        // 펼친 소스 목록 위에서는 안쪽 ScrollView 팬이 우선해 목록 스크롤이 유지된다)
        .contentShape(.rect(cornerRadius: 26))
        .gesture(
            DragGesture(minimumDistance: 10, coordinateSpace: .global)
                .onChanged(panelDragChanged)
                .onEnded(panelDragEnded)
        )
        // 하단 알약 탭바와 좌우 폭을 맞춘다 (탭바 인셋 ≈ 20pt)
        .padding(.horizontal, 20)
        // 탭바에 딱 붙지 않게 살짝 띄운다
        .padding(.bottom, 10)
    }

    // MARK: 3) 항목

    private var itemsPage: some View {
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
                    }
                }
            }
            Section {
                if itemsInScope.isEmpty && jobs.isEmpty {
                    VStack(spacing: 0) {
                        Image(systemName: "sparkles")
                            .font(.system(size: 22, weight: .medium))
                            .foregroundStyle(.secondary)
                            .frame(width: 46, height: 46)
                            .background(SK.surface2, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                            .padding(.bottom, 12)
                        Text("아직 만든 항목이 없어요")
                            .font(.headline)
                        Text("소스를 고르고 스튜디오 탭에서\n첫 결과물을 만들어 보세요")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.top, 5)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 28)
                    .listRowBackground(Color.clear)
                }
                ForEach(itemsInScope) { item in
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
                if !itemsInScope.isEmpty {
                    Text("생성된 항목 · \(itemsInScope.count)")
                }
            }
        }
        .scrollContentBackground(.hidden)
        // iOS 27에서는 이 엣지 이펙트가 탭바 위에 구분선처럼 그려진다 —
        // 다른 두 페이지와 똑같이 끈다 (26에서 괜찮아 보였을 뿐이다)
        .scrollEdgeEffectHidden(true, for: .bottom)
    }

    // MARK: generation

    private func tapped(_ kind: StudioKind) {
        guard !selection.isEmpty else { return }
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
        item.folder = scope.folder
        item.sources = selectedMemos
        return item
    }

    private func combinedManifest(_ memos: [Memo]) -> String {
        guard memos.count > 1 else { return memos.first?.manifest ?? "" }
        return memos.enumerated().map { index, memo in
            let n = index + 1
            let lines = memo.segments
                .map { "[t:\(n):\(Int($0.tStart))] \($0.text)" }
                .joined(separator: "\n")
            return "[노트 \(n)] \(memo.title)\n\(lines)"
        }.joined(separator: "\n\n")
    }

    private func startGeneration(kind: StudioKind, opts: Prompts.StudioOptions) {
        let sources = selectedMemos
        guard !sources.isEmpty else { return }

        if kind == .tutor {
            let content = TutorContent(
                mode: opts.tutorMode,
                subject: opts.tutorSubject.isEmpty ? scope.title : opts.tutorSubject,
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

        // 생성 시작 → 곧바로 항목 페이지로 이동해 진행 상황을 보여준다
        jobs[kind] = "생성 중…"
        withAnimation(.smooth(duration: 0.3)) { page = 2 }

        let manifest = combinedManifest(sources)
        let multi = sources.count > 1
        let fallbackTitle = "\(scope.title) \(kind.name)"

        Task {
            defer { jobs[kind] = nil }
            do {
                var raw = try await ai.generate(kind: kind, opts: opts, manifest: manifest, multi: multi)
                var normalized: (title: String, contentJSON: String)
                do {
                    normalized = try StudioParse.normalize(kind: kind, raw: raw, fallbackTitle: fallbackTitle)
                } catch {
                    jobs[kind] = "형식 재시도 중…"
                    raw = try await ai.generate(kind: kind, opts: opts, manifest: manifest, multi: multi, retry: true)
                    normalized = try StudioParse.normalize(kind: kind, raw: raw, fallbackTitle: fallbackTitle)
                }
                var contentJSON = normalized.contentJSON
                if kind == .examRadar,
                   let data = contentJSON.data(using: .utf8),
                   let radar = try? JSONDecoder().decode(ExamRadarContent.self, from: data) {
                    let allSegments = sources.flatMap(\.segments)
                    contentJSON = StudioParse.encodeContent(StudioParse.blendExamRadar(radar, segments: allSegments))
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
        let sources = selectedMemos
        let sourceIDs = Set(sources.map(\.uuid))
        if let existing = itemsInScope.first(where: {
            $0.kind == .chat && Set($0.sourceMemos.map(\.uuid)) == sourceIDs
        }) {
            openItem = existing
            return
        }
        let item = newItem(
            kind: .chat,
            title: "\(scope.title) 질문 채팅",
            contentJSON: StudioParse.encodeContent(ChatContent(turns: []))
        )
        context.insert(item)
        try? context.save()
        openItem = item
    }
}
