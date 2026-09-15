import SwiftUI
import SwiftData

/// 통합 노트 홈: 날짜별 노트 리스트 + 하단 플로팅 녹음 패널
struct LibraryView: View {
    @Environment(\.modelContext) private var context
    @Environment(AppState.self) private var appState
    @Query(sort: \Memo.createdAt, order: .reverse) private var memos: [Memo]
    @Query(sort: \Folder.createdAt) private var folders: [Folder]

    @State private var search = ""
    @State private var panelMinimized = false
    @State private var folderToDelete: Folder?
    @State private var navPath = NavigationPath()
    @AppStorage("libraryGroupMode") private var groupMode = GroupMode.date

    enum GroupMode: String {
        case date, folder
        var label: String { self == .date ? "날짜별" : "폴더별" }
        var icon: String { self == .date ? "calendar" : "folder" }
    }

    private var filteredMemos: [Memo] {
        guard !search.isEmpty else { return memos }
        return memos.filter {
            $0.title.localizedCaseInsensitiveContains(search) ||
            $0.transcriptText.localizedCaseInsensitiveContains(search)
        }
    }

    /// notes grouped by calendar day, newest first
    private var dayGroups: [(day: Date, memos: [Memo])] {
        let cal = Calendar.current
        let groups = Dictionary(grouping: memos) { cal.startOfDay(for: $0.createdAt) }
        return groups.keys.sorted(by: >).map { day in
            (day, groups[day]!.sorted { $0.createdAt > $1.createdAt })
        }
    }

    var body: some View {
        @Bindable var appState = appState
        NavigationStack(path: $navPath) {
            noteList
            .navigationTitle("노트")
            .searchable(text: $search, prompt: "제목·전사 내용 검색")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker("보기", selection: $groupMode) {
                            Label(GroupMode.date.label, systemImage: GroupMode.date.icon)
                                .tag(GroupMode.date)
                            Label(GroupMode.folder.label, systemImage: GroupMode.folder.icon)
                                .tag(GroupMode.folder)
                        }
                    } label: {
                        Image(systemName: groupMode.icon)
                    }
                }
                #if DEBUG
                ToolbarItem(placement: .topBarLeading) {
                    Button("샘플") { insertSampleMemo() }
                }
                #endif
            }
            // 폴더를 열면 곧장 스튜디오 폴더 뷰(소스/스튜디오/항목 3페이지) — 스튜디오 탭 통합
            .navigationDestination(for: Folder.self) { folder in
                StudioFolderView(scope: .folder(folder))
            }
            .navigationDestination(for: StudioScope.self) { scope in
                StudioFolderView(scope: scope)
            }
            .navigationDestination(for: Memo.self) { memo in
                MemoDetailView(memo: memo)
            }
            .navigationDestination(for: StudioItem.self) { item in
                StudioItemView(item: item)
            }
            .navigationDestination(for: UnfiledRoute.self) { _ in
                StudioFolderView(scope: .unfiled)
            }
            // 노트 상세 "스튜디오에서 열기" → 그 노트의 폴더 뷰로 진입 + 소스 미리 선택
            .onChange(of: appState.studioMemoUUID) { _, uuid in
                guard let uuid, let memo = memos.first(where: { $0.uuid == uuid }) else { return }
                appState.studioMemoUUID = nil
                appState.studioPreselect = uuid
                navPath.append(memo.folder.map { StudioScope.folder($0) } ?? StudioScope.unfiled)
            }
            // 폴더 삭제 — Memo.folder 가 nullify 관계라 노트는 지워지지 않고 "폴더 없음" 으로 간다
            .alert("폴더 삭제", isPresented: .init(
                get: { folderToDelete != nil },
                set: { if !$0 { folderToDelete = nil } })
            ) {
                Button("취소", role: .cancel) { folderToDelete = nil }
                Button("삭제", role: .destructive) {
                    if let folderToDelete {
                        context.delete(folderToDelete)
                        try? context.save()
                    }
                    folderToDelete = nil
                }
            } message: {
                Text("‘\(folderToDelete?.name ?? "")’ 폴더를 삭제합니다.\n안에 있던 노트는 지워지지 않고 ‘폴더 없음’으로 이동합니다.")
            }
            // overlay + 고정 하단 여백: 패널 확장/축소가 리스트 인셋을 건드리지 않아
            // 접힐 때 리스트 배경이 유리 뒤로 비치는 플래시가 원천적으로 사라진다
            .contentMargins(.bottom, 220, for: .scrollContent)
            // iOS 27 에서 스크롤 엣지 이펙트가 패널·탭바 위에 구분 밴드로 그려진다 — 끈다
            .scrollEdgeEffectHidden(true, for: .bottom)
            // 아래로 스크롤하면 녹음 시작 버튼만 남기고 접는다 (위로 스크롤하면 복귀)
            .onScrollGeometryChange(for: ScrollProbe.self) { ScrollProbe($0) } action: { old, new in
                guard let minimize = new.minimizeIntent(from: old),
                      minimize != panelMinimized else { return }
                withAnimation(.smooth(duration: 0.32)) { panelMinimized = minimize }
            }
            .overlay(alignment: .bottom) {
                RecordPanel(minimized: $panelMinimized)
            }
            #if DEBUG
            // 스크린샷 캡처 모드 — DICTLY_CAPTURE 환경변수로 목표 화면까지 자동 이동
            // (샘플 시딩은 RootTabView 가 탭과 무관하게 수행)
            .task {
                guard let mode = ProcessInfo.processInfo.environment["DICTLY_CAPTURE"] else { return }
                if memos.isEmpty { insertSampleMemo() }
                try? await Task.sleep(for: .milliseconds(600))
                switch mode {
                case "memo": if let m = memos.first { navPath.append(m) }
                case "studio": navPath.append(StudioScope.unfiled)
                default: break
                }
            }
            #endif
        }
        .fullScreenCover(isPresented: $appState.isRecordingPresented) {
            RecordingSessionView()
        }
    }

    private var noteList: some View {
        List {
                if search.isEmpty {
                    let favs = memos.filter(\.favorite)
                    if !favs.isEmpty {
                        Section("즐겨찾기") {
                            ForEach(favs) { memo in
                                MemoRow(memo: memo)
                            }
                        }
                    }
                    if memos.isEmpty {
                        Section {
                            Text("아직 노트가 없습니다.\n아래에서 녹음을 시작해 보세요.")
                                .foregroundStyle(.secondary)
                                .font(.subheadline)
                        }
                    }
                    switch groupMode {
                    case .date:
                        ForEach(dayGroups, id: \.day) { group in
                            Section(dayLabel(group.day)) {
                                ForEach(group.memos) { memo in
                                    MemoRow(memo: memo)
                                }
                            }
                        }
                    case .folder:
                        // 스튜디오와 같은 방식 — 폴더 목록만 보여주고 들어가서 노트를 본다.
                        // "폴더 없음" 은 맨 위에 별도 섹션으로 분리한다
                        let looseCount = memos.filter { $0.folder == nil }.count
                        if looseCount > 0 {
                            Section {
                                NavigationLink(value: UnfiledRoute()) {
                                    folderRow(icon: "tray.fill", tint: .gray,
                                              title: "폴더 없음", count: looseCount)
                                }
                            }
                        }
                        Section {
                            ForEach(folders) { folder in
                                NavigationLink(value: folder) {
                                    folderRow(icon: "folder.fill",
                                              tint: Color.accentColor,
                                              title: folder.name,
                                              count: folder.memos?.count ?? 0)
                                }
                                .swipeActions(edge: .trailing) {
                                    Button(role: .destructive) {
                                        folderToDelete = folder
                                    } label: {
                                        Label("삭제", systemImage: "trash")
                                    }
                                }
                            }
                        } header: {
                            Text("폴더")
                        }
                    }
                } else {
                    Section("검색 결과 \(filteredMemos.count)건") {
                        ForEach(filteredMemos) { memo in
                            MemoRow(memo: memo)
                        }
                    }
                }
            }
        .listStyle(.insetGrouped)
        .scrollDismissesKeyboard(.interactively)
    }

    private func folderRow(icon: String, tint: Color, title: String, count: Int) -> some View {
        Label {
            HStack {
                Text(title)
                Spacer()
                Text("\(count)")
                    .foregroundStyle(.secondary)
                    .font(.subheadline)
            }
        } icon: {
            Image(systemName: icon)
                .foregroundStyle(tint)
        }
    }

    private func dayLabel(_ day: Date) -> String {
        let df = DateFormatter()
        df.locale = Locale(identifier: "ko_KR")
        df.dateFormat = "M월 d일 (E)"
        if Calendar.current.isDateInToday(day) { return "오늘 · " + df.string(from: day) }
        if Calendar.current.isDateInYesterday(day) { return "어제 · " + df.string(from: day) }
        return df.string(from: day)
    }

    #if DEBUG
    /// simulator/dev helper: seed a realistic lecture memo without recording
    private func insertSampleMemo() {
        let texts: [(Double, Double, String, String?)] = [
            (0, 14, "오늘은 자본구조 이론 중에서 MM의 수정 이론을 다뤄보겠습니다. 법인세가 존재할 때 기업 가치가 어떻게 달라지는지가 핵심입니다.", nil),
            (14, 31, "법인세가 있으면 부채 사용 기업의 가치는 무부채 기업의 가치에 부채의 절세효과를 더한 것이 됩니다. 수식으로는 $V_L = V_U + Bt$ 이렇게 표현합니다.", "법인세가 있으면 부채 사용 기업의 가치는 무부채 기업의 가치에 부채의 절세효과를 더한 것이 됩니다. 수식으로는 브이엘은 브이유 더하기 비티 이렇게 표현합니다."),
            (31, 47, "여기서 $t$는 법인세율이고, $B$는 부채의 시장가치입니다. 그러니까 부채를 100억 쓰고 세율이 30%면 절세효과는 30억이 되는 거죠.", nil),
            (47, 65, "다음으로 가중평균자본비용, 즉 WACC를 봅시다. 부채 비중이 늘어나면 WACC는 감소합니다. 시험에 정말 자주 나오는 부분이니 꼭 기억하세요.", "다음으로 가중평균자본비용, 즉 왁을 봅시다. 부채 비중이 늘어나면 왁은 감소합니다. 시험에 정말 자주 나오는 부분이니 꼭 기억하세요."),
            (65, 84, "자기자본비용은 $K_e = \\rho + (\\rho - K_d)(1-t)\\frac{B}{S}$ 로 구합니다. 부채가 늘수록 자기자본비용은 올라가지만 저렴한 부채 효과가 더 커서 전체 자본비용은 내려갑니다.", nil),
            (84, 100, "정리하면, 법인세만 고려할 경우 부채를 100% 쓰는 것이 기업 가치를 극대화합니다. 다음 시간에는 파산비용까지 고려한 균형부채이론을 다루겠습니다. 중간고사는 4월 21일입니다.", nil)
        ]
        var segments = texts.map { MemoSegment(tStart: $0.0, tEnd: $0.1, text: $0.2, origText: $0.3) }
        // 파란 스팬 렌더 검증용: 교정된 두 세그먼트에 적극 교정 구간을 심는다
        // seg1: "$V_L = V_U + Bt$" (수식 전체), seg3: "WACC" 두 곳
        if let r = segments[1].text.range(of: "$V_L = V_U + Bt$") {
            let start = segments[1].text.distance(from: segments[1].text.startIndex, to: r.lowerBound)
            segments[1].corrSpans = [CorrSpan(start: start, len: segments[1].text.distance(from: r.lowerBound, to: r.upperBound))]
        }
        segments[3].corrSpans = segments[3].text.ranges(of: "WACC").map {
            CorrSpan(start: segments[3].text.distance(from: segments[3].text.startIndex, to: $0.lowerBound), len: 4)
        }
        let memo = Memo(title: "재무관리 7강 — 자본구조와 MM이론", durationSec: 100, audioFileName: nil, language: "ko-KR", segments: segments)
        context.insert(memo)

        let quiz = QuizContent(questions: [
            .init(type: "verbal", question: "법인세가 존재할 때 부채 사용 기업의 가치 $V_L$은 어떻게 구성되는지 설명해 보세요.", options: nil,
                  answer: "$V_L = V_U + Bt$ — 무부채 기업 가치에 부채의 절세효과를 더한 값", explanation: "법인세 하에서 이자비용의 절세효과만큼 기업 가치가 증가합니다. [t:14]"),
            .init(type: "calc", question: "부채 200억, 법인세율 25%일 때 절세효과는?", options: nil,
                  answer: "50억", explanation: "$Bt = 200 × 0.25 = 50$억 [t:31]"),
            .init(type: "ox", question: "법인세만 고려하면 부채 비중이 늘수록 WACC는 증가한다.", options: ["O", "X"],
                  answer: "X", explanation: "부채 비중이 늘면 WACC는 감소합니다. [t:47]")
        ])
        context.insert(StudioItem(kind: .quiz, title: "MM이론 확인 퀴즈", contentJSON: StudioParse.encodeContent(quiz), memo: memo))

        let mindmap = MindmapContent(root: MindmapNode(label: "자본구조와 MM이론", children: [
            MindmapNode(label: "MM 수정이론 (법인세)", children: [
                MindmapNode(label: "$V_L = V_U + Bt$ — 절세효과 [t:14]", children: nil),
                MindmapNode(label: "부채 100% 시 기업가치 극대화 [t:84]", children: nil)
            ]),
            MindmapNode(label: "자본비용", children: [
                MindmapNode(label: "WACC — 부채 비중↑ 시 감소 [t:47]", children: nil),
                MindmapNode(label: "$K_e = \\rho + (\\rho-K_d)(1-t)B/S$ [t:65]", children: nil)
            ])
        ]))
        context.insert(StudioItem(kind: .mindmap, title: "MM이론 마인드맵", contentJSON: StudioParse.encodeContent(mindmap), memo: memo))

        // 캡처/검증용 채팅 스레드
        if ((try? context.fetch(FetchDescriptor<ChatThread>())) ?? []).isEmpty {
            let t1 = ChatThread(title: "MM이론 절세효과 질문")
            context.insert(t1)
            let q1 = ChatMsg(role: "user", text: "부채 200억에 세율 25%면 기업가치가 얼마나 늘어나?")
            q1.thread = t1
            context.insert(q1)
            let a1 = ChatMsg(role: "assistant", text: "절세효과 $Bt = 200 × 0.25 = 50$억만큼 기업가치가 증가해요. 강의에서 같은 예시를 다뤘어요 [t:31]")
            a1.thread = t1
            context.insert(a1)
            let t2 = ChatThread(title: "WACC 감소 이유 정리")
            context.insert(t2)
            let q2 = ChatMsg(role: "user", text: "부채 비중이 늘면 왜 WACC가 줄어?")
            q2.thread = t2
            context.insert(q2)
            let a2 = ChatMsg(role: "assistant", text: "저렴한 세후 부채비용 $K_d(1-t)$의 비중이 커지는 효과가 자기자본비용 상승보다 크기 때문이에요 [t:47]")
            a2.thread = t2
            context.insert(a2)
        }

        // 캡처/검증용 시간표
        if ((try? context.fetch(FetchDescriptor<Timetable>())) ?? []).isEmpty {
            let tt = Timetable(name: "2026 2학기")
            context.insert(tt)
            let classes: [(String, String, String, Int, Int, Int, Int)] = [
                ("재무관리", "미래관 B104", "정문석", 0, 9, 2, 12),
                ("기업재무제학", "미래관 B104", "김진용", 1, 11, 2, 3),
                ("쟁점현대한국사", "인문학관 430", "김혜윤", 2, 10, 2, 21),
                ("법인세법", "법학관 111", "임정화", 1, 14, 2, 30),
                ("계량경제학", "미래관 B103", "권혁준", 3, 13, 2, 44),
                ("개인스포츠", "체육관 101", "최수민", 4, 15, 1, 7)
            ]
            for c in classes {
                let cls = TimetableClass(title: c.0, room: c.1, professor: c.2,
                                         weekday: c.3, startHour: c.4, durationHours: c.5, colorIndex: c.6)
                cls.timetable = tt
                context.insert(cls)
            }
            UserDefaults.standard.set(tt.uuid.uuidString, forKey: "activeTimetableUUID")
        }
        try? context.save()
    }
    #endif
}

// MARK: - 하단 플로팅 녹음 패널 (폴더·에이전트·실시간 교정 + 녹음 시작)

struct RecordPanel: View {
    /// 리스트를 아래로 스크롤하는 동안에는 녹음 시작 버튼만 남긴다.
    /// 핸들로도 되돌릴 수 있게 바인딩으로 받는다
    @Binding var minimized: Bool

    @Environment(RecorderViewModel.self) private var vm
    @Environment(AppSettings.self) private var settings
    @Environment(AppState.self) private var appState
    @Environment(\.modelContext) private var context
    @Query(sort: \Folder.createdAt) private var folders: [Folder]
    @Query(sort: \Agent.createdAt) private var agents: [Agent]

    @State private var showNewFolder = false
    @State private var newFolderName = ""
    @State private var expanded = false
    // 정적 목록으로 즉시 시드 — 네트워크 갱신(availableModels)은 세션당 1회 메모이즈
    @State private var whisperModels: [String] = WhisperEngine.curatedModels
    @Namespace private var glassNS

    /// 모델이 메모리에 올라오기 전에는 녹음을 막는다 —
    /// 녹음을 시작해 놓고 로딩을 기다리는 상황을 만들지 않기 위해서다
    private var modelPreparing: Bool {
        guard settings.sttEngine == .whisper else { return false }
        return WhisperEngine.isLive(settings.whisperModel)
            ? LightningPreloader.shared.shouldBlockRecording
            : WhisperPreloader.shared.shouldBlockRecording
    }

    /// 다운로드 동의 전이면 녹음 대신 동의 시트를 연다 — 몰래 받지 않는다 (App Review 4.2.3)
    private var needsModelDownload: Bool {
        guard settings.sttEngine == .whisper else { return false }
        return WhisperEngine.isLive(settings.whisperModel)
            ? !LightningPreloader.isDownloaded
            : !WhisperPreloader.isDownloaded(WhisperPreloader.shared.resolvedVariant(settings.whisperModel))
    }

    /// 프리로더의 실제 단계를 그대로 보여준다 — 재특수화가 도는데
    /// "몇 초짜리 로드" 문구가 떠 있으면 멈춘 것처럼 보인다
    private var modelPreparingLabel: String {
        if WhisperEngine.isLive(settings.whisperModel) {
            switch LightningPreloader.shared.phase {
            case .downloading(let pct): return "가중치 다운로드 \(pct)%"
            default: return "모델 불러오는 중…"
            }
        }
        switch WhisperPreloader.shared.phase {
        case .downloading(let pct): return "다운로드 중 \(pct)%"
        case .optimizing: return "뉴럴엔진 최적화 중… (최초 1회)"
        default: return "모델 불러오는 중…"
        }
    }

    /// 폴더·에이전트·실시간 교정 3행(각 44) + 구분선
    private static let baseRows: CGFloat = 133
    /// 전사 모델·언어·교정 모델 3행 — 확장 시 추가로 드러나는 높이
    private static let extraRows: CGFloat = 135
    private static let maxRows: CGFloat = baseRows + extraRows

    /// 드래그 중인 이동량(위로 끌면 +) — 손가락을 1:1로 따라오게 하는 값
    @State private var dragUp: CGFloat = 0
    @State private var dragging = false
    /// 제스처 인식 시점의 translation — minimumDistance 만큼의 초기 점프를 상쇄한다
    @State private var dragStartH: CGFloat = 0

    /// 손을 뗀 상태에서의 목표 높이
    private var baseRevealed: CGFloat {
        minimized ? 0 : (expanded ? Self.maxRows : Self.baseRows)
    }

    /// 실제로 그릴 높이 — 드래그 중이면 손가락 위치, 아니면 목표 높이
    private var revealed: CGFloat {
        guard dragging else { return baseRevealed }
        return min(Self.maxRows, max(0, baseRevealed + dragUp))
    }

    /// 확장 영역(추가 옵션)이 드러난 높이
    private var extraRevealed: CGFloat {
        min(Self.extraRows, max(0, revealed - Self.baseRows))
    }

    private func dragChanged(_ value: DragGesture.Value) {
        if !dragging {
            dragging = true
            dragStartH = value.translation.height
        }
        dragUp = -(value.translation.height - dragStartH)
    }

    private func dragEnded(_ value: DragGesture.Value) {
        settle(predicted: baseRevealed - (value.predictedEndTranslation.height - dragStartH))
    }

    /// 드래그를 끝낸 지점(투사 속도 포함)으로 정착할 상태를 고른다
    private func settle(predicted: CGFloat) {
        withAnimation(.spring(response: 0.38, dampingFraction: 0.82)) {
            dragging = false
            dragUp = 0
            if predicted < Self.baseRows * 0.5 {
                minimized = true
                expanded = false
            } else if predicted < Self.baseRows + Self.extraRows * 0.5 {
                minimized = false
                expanded = false
            } else {
                minimized = false
                expanded = true
            }
        }
    }

    var body: some View {
        @Bindable var settings = settings
        // 하나의 글라스 패널 — 단일 유리는 컨테이너 없이 써야 크기 변화 시
        // 유리가 매 프레임 콘텐츠 프레임을 정확히 따라간다 (스냅샷 보간 어긋남 방지)
        VStack(spacing: 0) {
                    // drag handle — 위로 끌거나 탭하면 패널이 확장된다
                    Capsule()
                        .fill(Color.secondary.opacity(0.5))
                        .frame(width: 42, height: 5)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 8)
                        // 최소화되면 바로 아래가 녹음 버튼이라 간격을 좁힌다
                        .padding(.bottom, 6 + min(3, revealed / 44))
                        // 핸들 히트 영역: 너무 부풀리면(-20) 바로 아래 폴더 행 탭까지 삼킨다
                        .contentShape(Rectangle().inset(by: -10))
                        .onTapGesture {
                            withAnimation(.spring(response: 0.38, dampingFraction: 0.82)) {
                                if minimized {
                                    minimized = false
                                } else {
                                    expanded.toggle()
                                }
                            }
                        }
                        // 임계값을 넘겨 토글하는 게 아니라 손가락을 그대로 따라오게 한다 —
                        // onChanged 는 애니메이션 없이 즉시 반영하고, 손을 뗄 때만 스프링으로 정착.
                        // 좌표계는 반드시 .global — 로컬 기준이면 패널이 자라며 핸들이 움직이는
                        // 만큼 translation 이 반대로 튀어 매 프레임 진동(점멸)한다
                        .gesture(
                            DragGesture(minimumDistance: 1, coordinateSpace: .global)
                                .onChanged(dragChanged)
                                .onEnded(dragEnded)
                        )

                    // 접을 때는 뷰를 제거하지 않고 높이를 0으로 깎아 clip 한다 —
                    // 제거하면 행들이 버튼 위로 미끄러져 내려가며 사라져 어색하다
                    VStack(spacing: 0) {
                        panelRow("폴더") {
                            folderMenu
                        }
                        Divider().padding(.leading, 4)
                        panelRow("에이전트") {
                            agentMenu
                        }
                        Divider().padding(.leading, 4)
                        Toggle(isOn: $settings.liveCorrect) {
                            Text("실시간 교정")
                                .font(.subheadline.weight(.medium))
                        }
                        .frame(height: 44)

                        // 추가 옵션 — 패널이 늘어나는 만큼 행들이 아래에서 함께 밀려 올라오며
                        // 드러난다 (창 높이와 행 오프셋을 같은 커브로 애니메이션)
                        VStack(spacing: 0) {
                            Divider().padding(.leading, 4)
                            panelRow("전사 모델") {
                                sttModelMenu
                            }
                            Divider().padding(.leading, 4)
                            panelRow("언어") {
                                languageMenu
                            }
                            Divider().padding(.leading, 4)
                            panelRow("교정 모델") {
                                correctionModelMenu
                            }
                        }
                        .frame(height: extraRevealed, alignment: .top)
                        .clipped()
                        .opacity(min(1, extraRevealed / 60))
                        .allowsHitTesting(expanded && !dragging)
                    }
                    .frame(height: revealed, alignment: .top)
                    // 접힘에 필요한 건 세로 클리핑뿐이다. .clipped() 는 가로도 잘라서
                    // 경계에 닿는 토글의 오른쪽 끝이 살짝 잘려 보였다
                    .mask(alignment: .top) {
                        Rectangle().padding(.horizontal, -16)
                    }
                    .opacity(min(1, revealed / 60))
                    .allowsHitTesting(!minimized && !dragging)

                    Button {
                        appState.isRecordingPresented = true
                        let folder = appState.recordFolder?.name ?? ""
                        Task { await vm.start(folderName: folder) }
                    } label: {
                        Label(needsModelDownload ? "녹음 시작" : (modelPreparing ? modelPreparingLabel : "녹음 시작"),
                              systemImage: modelPreparing && !needsModelDownload ? "arrow.down.circle" : "waveform")
                            .font(.headline)
                            .foregroundStyle(.black)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 15)
                            .background(Color.white, in: RoundedRectangle(cornerRadius: 20))
                            .overlay(
                                RoundedRectangle(cornerRadius: 20)
                                    .strokeBorder(Color.black.opacity(0.08), lineWidth: 1)
                            )
                            .shadow(color: .black.opacity(0.10), radius: 8, y: 2)
                    }
                    .buttonStyle(.plain)
                    .disabled(vm.isBusy || (modelPreparing && !needsModelDownload))
                    .padding(.top, min(8, revealed / 16))
                    .padding(.bottom, 12)
                }
        .padding(.horizontal, 16)
        // .interactive() — 탭바처럼 터치에 반응하는 표준 리퀴드 글라스
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 26))
        // 유리 전체를 히트 영역으로: 패널 위 스와이프가 뒤 리스트 스크롤로 새지 않고,
        // 핸들이 아닌 곳을 쓸어도 확장/축소된다. 본문이 거의 Menu 라 일반 .gesture 로는
        // 메뉴의 press-drag 가 드래그를 삼킨다 — highPriority 로 올리되 10pt 임계라
        // 탭(<10pt)은 그대로 메뉴/토글/버튼에 전달된다
        .contentShape(.rect(cornerRadius: 26))
        .highPriorityGesture(
            DragGesture(minimumDistance: 10, coordinateSpace: .global)
                .onChanged(dragChanged)
                .onEnded(dragEnded)
        )
        // 하단 알약 탭바와 좌우 폭을 맞춘다 (탭바 인셋 ≈ 20pt)
        .padding(.horizontal, 20)
        // 탭바에 딱 붙지 않게 살짝 띄운다
        .padding(.bottom, 10)
        .task(id: expanded) {
            if expanded {
                whisperModels = await WhisperEngine.availableModels()
            }
        }
        .alert("새 폴더", isPresented: $showNewFolder) {
            TextField("폴더 이름", text: $newFolderName)
            Button("만들고 선택") {
                let name = newFolderName.trimmingCharacters(in: .whitespaces)
                guard !name.isEmpty else { return }
                let folder = Folder(name: name)
                context.insert(folder)
                try? context.save()
                appState.recordFolder = folder
            }
            Button("취소", role: .cancel) {}
        }
    }

    private func panelRow(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        HStack {
            Text(title)
                .font(.subheadline.weight(.medium))
            Spacer()
            content()
        }
        .frame(height: 44)
    }

    /// 전사 모델: Apple / Whisper 변형 / GPT API
    private var sttModelMenu: some View {
        Menu {
            Section("Whisper 로컬") {
                if LightningSupport.isSupported {
                    whisperModelButton(WhisperEngine.liveModel,
                                       label: WhisperEngine.pickerLabel(WhisperEngine.liveModel))
                }
                ForEach(whisperMenuModels, id: \.self) { model in
                    whisperModelButton(model, label: WhisperEngine.pickerLabel(model))
                }
            }
            Button {
                settings.sttEngine = .gptAPI
            } label: {
                if settings.sttEngine == .gptAPI {
                    Label("GPT 실시간 전사", systemImage: "checkmark")
                } else {
                    Text("GPT 실시간 전사")
                }
            }
        } label: {
            menuValueLabel(sttModelLabel)
        }
        // 하단 패널에서 위로 열릴 때 iOS 가 순서를 뒤집지 않게 고정한다
        .menuOrder(.fixed)
        .tint(.primary)
    }

    /// 저장된 모델이 큐레이션 목록에 없어도(과거 선택) 메뉴에서 체크 표시가 사라지지 않게 덧붙인다
    private var whisperMenuModels: [String] {
        var list = whisperModels
        if !settings.whisperModel.isEmpty, !WhisperEngine.isLive(settings.whisperModel),
           !list.contains(settings.whisperModel) {
            list.append(settings.whisperModel)
        }
        return WhisperEngine.sortedForDisplay(list)
    }

    private func whisperModelButton(_ model: String, label: String) -> some View {
        Button {
            settings.sttEngine = .whisper
            settings.whisperModel = model
        } label: {
            if settings.sttEngine == .whisper && settings.whisperModel == model {
                Label(label, systemImage: "checkmark")
            } else {
                Text(label)
            }
        }
    }

    private var sttModelLabel: String {
        switch settings.sttEngine {
        case .whisper: "Whisper · \(WhisperEngine.displayName(settings.whisperModel))"
        case .gptAPI: "GPT 실시간"
        }
    }

    /// 전사 언어 — 영어 강의 등 녹음 직전에 바로 바꿀 수 있게 패널에 노출
    private static let languageChoices: [(id: String, label: String)] = [
        ("ko-KR", "한국어"), ("en-US", "English"), ("ja-JP", "日本語")
    ]

    private var languageMenu: some View {
        Menu {
            ForEach(Self.languageChoices, id: \.id) { choice in
                Button {
                    settings.transcribeLocaleID = choice.id
                } label: {
                    if settings.transcribeLocaleID == choice.id {
                        Label(choice.label, systemImage: "checkmark")
                    } else {
                        Text(choice.label)
                    }
                }
            }
        } label: {
            menuValueLabel(currentLanguageLabel)
        }
        .tint(.primary)
    }

    private var currentLanguageLabel: String {
        Self.languageChoices.first { $0.id == settings.transcribeLocaleID }?.label
            ?? Locale(identifier: "ko_KR").localizedString(forIdentifier: settings.transcribeLocaleID)
            ?? settings.transcribeLocaleID
    }

    private var correctionModelMenu: some View {
        Menu {
            ForEach(EngineChoice.allCases) { engine in
                Button {
                    settings.correctionEngine = engine
                } label: {
                    if settings.correctionEngine == engine {
                        Label(engine.label, systemImage: "checkmark")
                    } else {
                        Text(engine.label)
                    }
                }
            }
        } label: {
            menuValueLabel(settings.correctionEngine.short)
        }
        .tint(.primary)
    }

    private var folderMenu: some View {
        Menu {
            Button {
                appState.recordFolder = nil
            } label: {
                if appState.recordFolder == nil {
                    Label("폴더 없음", systemImage: "checkmark")
                } else {
                    Text("폴더 없음")
                }
            }
            ForEach(folders) { folder in
                Button {
                    appState.recordFolder = folder
                } label: {
                    if appState.recordFolder == folder {
                        Label(folder.name, systemImage: "checkmark")
                    } else {
                        Text(folder.name)
                    }
                }
            }
            Divider()
            Button {
                newFolderName = ""
                showNewFolder = true
            } label: {
                Label("새 폴더…", systemImage: "folder.badge.plus")
            }
        } label: {
            menuValueLabel(appState.recordFolder?.name ?? "폴더 없음")
        }
        .tint(.primary)
    }

    private var agentMenu: some View {
        Menu {
            Button {
                settings.applyActiveAgent(nil)
            } label: {
                if settings.activeAgentUUID.isEmpty {
                    Label("없음", systemImage: "checkmark")
                } else {
                    Text("없음")
                }
            }
            ForEach(agents) { agent in
                Button {
                    settings.applyActiveAgent(agent)
                } label: {
                    if settings.activeAgentUUID == agent.uuid.uuidString {
                        Label(agent.name, systemImage: "checkmark")
                    } else {
                        Text(agent.name)
                    }
                }
            }
        } label: {
            menuValueLabel(agents.first { $0.uuid.uuidString == settings.activeAgentUUID }?.name ?? "없음")
        }
        .tint(.primary)
    }

    private func menuValueLabel(_ text: String) -> some View {
        HStack(spacing: 5) {
            Text(text)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
            Image(systemName: "chevron.up.chevron.down")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .foregroundStyle(.primary)
    }
}

// MARK: - 폴더 브라우저 (미분류 포함)

struct FolderBrowserView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \Folder.createdAt) private var folders: [Folder]
    @Query(sort: \Memo.createdAt, order: .reverse) private var memos: [Memo]

    @State private var showNewFolder = false
    @State private var newFolderName = ""

    var body: some View {
        List {
            if folders.isEmpty && memos.isEmpty {
                Text("아직 폴더가 없습니다.")
                    .foregroundStyle(.secondary)
                    .font(.subheadline)
            }
            ForEach(folders) { folder in
                NavigationLink(value: folder) {
                    Label {
                        HStack {
                            Text(folder.name)
                            Spacer()
                            Text("\(folder.memos?.count ?? 0)")
                                .foregroundStyle(.secondary)
                                .font(.subheadline)
                        }
                    } icon: {
                        Image(systemName: folder.favorite ? "star.fill" : "folder.fill")
                            .foregroundStyle(folder.favorite ? .yellow : Color.accentColor)
                    }
                }
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) {
                        context.delete(folder)
                        try? context.save()
                    } label: {
                        Label("삭제", systemImage: "trash")
                    }
                }
                .swipeActions(edge: .leading) {
                    Button {
                        folder.favorite.toggle()
                    } label: {
                        Label("즐겨찾기", systemImage: "star")
                    }
                    .tint(.yellow)
                }
            }
            let looseCount = memos.filter { $0.folder == nil }.count
            if looseCount > 0 {
                NavigationLink(value: UnfiledRoute()) {
                    Label {
                        HStack {
                            Text("폴더 없음")
                            Spacer()
                            Text("\(looseCount)")
                                .foregroundStyle(.secondary)
                                .font(.subheadline)
                        }
                    } icon: {
                        Image(systemName: "tray.fill")
                            .foregroundStyle(.gray)
                    }
                }
            }
        }
        .navigationTitle("폴더")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    newFolderName = ""
                    showNewFolder = true
                } label: {
                    Image(systemName: "folder.badge.plus")
                }
            }
        }
        .alert("새 폴더", isPresented: $showNewFolder) {
            TextField("폴더 이름", text: $newFolderName)
            Button("만들기") {
                let name = newFolderName.trimmingCharacters(in: .whitespaces)
                guard !name.isEmpty else { return }
                context.insert(Folder(name: name))
                try? context.save()
            }
            Button("취소", role: .cancel) {}
        }
    }
}

/// 노트 탭 폴더 뷰에서 "폴더 없음" 으로 들어가기 위한 내비게이션 경로
struct UnfiledRoute: Hashable {}

// MARK: - note row (time · duration · folder badge)

/// 시간표 학기 시작일을 기준으로 "과목명 N주차" 부제목을 만든다.
/// 같은 날 두 번째 녹음부터는 주차를 올리지 않고 "(2)" 를 붙인다.
enum ClassWeekLabel {
    static func text(for memo: Memo, timetables: [Timetable]) -> String? {
        guard let folder = memo.folder else { return nil }
        let name = folder.name
        guard let start = timetables.first(where: { timetable in
            timetable.startDate != nil
                && (timetable.classes ?? []).contains { $0.title == name }
        })?.startDate else { return nil }

        let calendar = Calendar.current
        let from = calendar.startOfDay(for: start)
        let to = calendar.startOfDay(for: memo.createdAt)
        guard let days = calendar.dateComponents([.day], from: from, to: to).day,
              days >= 0 else { return nil }

        let sameDay = (folder.memos ?? [])
            .filter { calendar.isDate($0.createdAt, inSameDayAs: memo.createdAt) }
            .sorted { $0.createdAt < $1.createdAt }
        let index = (sameDay.firstIndex { $0.uuid == memo.uuid } ?? 0) + 1
        let suffix = index > 1 ? " (\(index))" : ""
        return "\(name) \(days / 7 + 1)주차\(suffix)"
    }
}

struct MemoRow: View {
    @Bindable var memo: Memo
    @Environment(\.modelContext) private var context
    @Query(sort: \Folder.createdAt) private var folders: [Folder]
    @Query(sort: \Timetable.createdAt) private var timetables: [Timetable]

    private var timeLabel: String {
        let df = DateFormatter()
        df.dateFormat = "HH:mm"
        return df.string(from: memo.createdAt)
    }

    private var subtitle: String {
        let base = "\(timeLabel) · \(memo.durationSec.timeString)"
        if let week = ClassWeekLabel.text(for: memo, timetables: timetables) {
            return "\(base) · \(week)"
        }
        return "\(base) · \(memo.folder?.name ?? "폴더 없음")"
    }

    var body: some View {
        NavigationLink(value: memo) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 5) {
                    if memo.favorite {
                        Image(systemName: "star.fill").font(.caption2).foregroundStyle(.yellow)
                    }
                    Text(memo.title).font(.headline).lineLimit(1)
                }
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
        .swipeActions(edge: .leading) {
            Button {
                memo.favorite.toggle()
            } label: {
                Label("즐겨찾기", systemImage: "star")
            }
            .tint(.yellow)
        }
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) { delete() } label: {
                Label("삭제", systemImage: "trash")
            }
        }
        .contextMenu {
            Menu("폴더로 이동") {
                Button("폴더 없음") { memo.folder = nil }
                ForEach(folders) { folder in
                    Button(folder.name) { memo.folder = folder }
                }
            }
            Button(role: .destructive) { delete() } label: {
                Label("삭제", systemImage: "trash")
            }
        }
    }

    private func delete() {
        if let url = memo.audioURL {
            try? FileManager.default.removeItem(at: url)
        }
        context.delete(memo)
        try? context.save()
    }
}
