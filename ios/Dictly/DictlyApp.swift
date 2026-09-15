import SwiftUI
import SwiftData
import UserNotifications

@main
struct DictlyApp: App {
    @State private var settings: AppSettings
    @State private var appState = AppState()
    @State private var ai: AIService
    @State private var recorder: RecorderViewModel
    @State private var notifications = NotificationCoordinator()

    init() {
        let settings = AppSettings()
        let ai = AIService(settings: settings)
        _settings = State(initialValue: settings)
        _ai = State(initialValue: ai)
        _recorder = State(initialValue: RecorderViewModel(settings: settings, ai: ai))
    }

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .preferredColorScheme(
                    settings.appearance == "light" ? .light :
                    settings.appearance == "dark" ? .dark : nil)
                .environment(settings)
                .environment(appState)
                .environment(ai)
                .environment(recorder)
                // 수업 알림 탭 → 해당 과목 폴더로 녹음 시작 (RootTabView 가 이어받는다)
                .task {
                    notifications.onOpenFolder = { name in
                        appState.pendingClassFolder = name
                    }
                    UNUserNotificationCenter.current().delegate = notifications
                }
                // Live Activity 종료 버튼(dictly://stop) → 녹음 정지
                .onOpenURL { url in
                    guard url.scheme == "dictly", url.host == "stop" else { return }
                    Task { await recorder.stop() }
                }
        }
        .modelContainer(for: [Folder.self, Memo.self, StudioItem.self, Agent.self, Timetable.self, TimetableClass.self, ChatThread.self, ChatMsg.self])
    }
}

struct RootTabView: View {
    @Environment(AppState.self) private var appState
    /// 첫 실행 워크스루 완료 여부 — 끝나야 모델 다운로드 동의로 이어진다
    @AppStorage("introSeenV1") private var introSeen = false
    @State private var showIntro = false
    @Environment(RecorderViewModel.self) private var recorder
    @Environment(AppSettings.self) private var settings
    @Environment(\.modelContext) private var context
    @Query(sort: \Folder.createdAt) private var folders: [Folder]

    var body: some View {
        @Bindable var appState = appState
        TabView(selection: $appState.selectedTab) {
            Tab("노트", systemImage: "waveform", value: AppState.Tab.library) {
                LibraryView()
            }
            Tab("채팅", systemImage: "bubble.left.and.bubble.right.fill", value: AppState.Tab.chat) {
                ChatListView()
            }
            Tab("시간표", systemImage: "calendar", value: AppState.Tab.timetable) {
                TimetableView()
            }
            Tab("설정", systemImage: "gearshape.fill", value: AppState.Tab.settings) {
                SettingsView()
            }
        }
        // 1회 병합: 죽은 필드였던 keywords(구 '전사 키워드 사전')를 용어 사전으로 합친다 (멱등)
        .task {
            let all = (try? context.fetch(FetchDescriptor<Agent>())) ?? []
            var changed = false
            for agent in all where !agent.keywords.isEmpty {
                let extra = agent.keywords.trimmingCharacters(in: .whitespacesAndNewlines)
                if !extra.isEmpty, !agent.correctionKeywords.contains(extra) {
                    agent.correctionKeywords += (agent.correctionKeywords.isEmpty ? "" : ", ") + extra
                }
                agent.keywords = ""
                changed = true
            }
            // 프리셋 에이전트 기본 제공 — 최초 1회만 (사용자가 지우면 다시 만들지 않는다)
            if !UserDefaults.standard.bool(forKey: "cpaPresetsSeeded") {
                let existing = Set(all.compactMap(\.presetID))
                for preset in PresetCatalog.all where !existing.contains(preset.packID) {
                    if let agent = PresetCatalog.makeAgent(packID: preset.packID) {
                        context.insert(agent)
                        changed = true
                    }
                }
                UserDefaults.standard.set(true, forKey: "cpaPresetsSeeded")
            }
            if changed { try? context.save() }
            // 활성 에이전트 스냅샷 갱신 (병합 반영 + 신규 agentPresetID 백필)
            if let uuid = UUID(uuidString: settings.activeAgentUUID),
               let active = all.first(where: { $0.uuid == uuid }) {
                settings.applyActiveAgent(active)
            }
        }
        // intercept dictly://seek links from markdown cite chips when no player handles them
        .environment(\.openURL, OpenURLAction { url in
            url.scheme == "dictly" ? .handled : .systemAction
        })
        // id 는 엔진+모델 쌍이라 설정/녹음 패널에서 모델을 바꾸는 순간에도 다시 돈다.
        // 인트로가 끝나기 전에는 아무 시트도 띄우지 않는다 (첫 실행: 인트로 → 다운로드 동의 순서)
        .task(id: "\(settings.sttEngine.rawValue)|\(settings.whisperModel)") {
            guard introSeen else { return }
            syncEnginePreparation()
        }
        // 첫 실행 워크스루 — 주요 기능 소개 후 모델 다운로드 동의로 이어진다
        .fullScreenCover(isPresented: $showIntro) {
            IntroView {
                introSeen = true
                showIntro = false
                syncEnginePreparation()
            }
        }
        .onAppear {
            #if DEBUG
            if let mode = ProcessInfo.processInfo.environment["DICTLY_CAPTURE"] {
                // 노트 탭(LibraryView)이 먼저 떠서 샘플을 시딩할 시간을 준 뒤 목표 탭으로 이동
                Task {
                    try? await Task.sleep(for: .milliseconds(1500))
                    switch mode {
                    case "chat": appState.selectedTab = .chat
                    case "timetable": appState.selectedTab = .timetable
                    case "settings": appState.selectedTab = .settings
                    default: break
                    }
                }
                return   // 캡처 중에는 인트로/동의 시트를 띄우지 않는다
            }
            #endif
            if !introSeen { showIntro = true }
        }
        // 다운로드 크기를 고지하고 동의를 받는 화면 — "나중에" 는 미다운로드 상태로 남고 안내 팝업이 뜬다
        .fullScreenCover(isPresented: $appState.showWhisperSetup) {
            ModelSetupSheet()
        }

        // 수업 알림에서 넘어온 과목명 → 그 폴더로 바로 녹음 시작
        .onChange(of: appState.pendingClassFolder) { _, name in
            guard let name else { return }
            appState.pendingClassFolder = nil
            startRecording(inFolderNamed: name)
        }
    }

    /// 선택된 전사 모델에 맞는 사전 준비 — 안 받은 모델은 크기 고지 + 동의 시트부터 (4.2.3)
    private func syncEnginePreparation() {
        switch settings.sttEngine {
        case .whisper where WhisperEngine.isLive(settings.whisperModel):
            // 상호 배타: WhisperKit 상주 인스턴스를 내리고 Lightning 만 올린다
            WhisperPreloader.shared.release()
            if LightningPreloader.isDownloaded {
                LightningPreloader.shared.preload()
            } else {
                appState.showWhisperSetup = true
            }
        case .whisper:
            LightningPreloader.shared.release()
            let variant = WhisperPreloader.shared.resolvedVariant(settings.whisperModel)
            if WhisperPreloader.isDownloaded(variant) {
                WhisperPreloader.shared.preload(model: settings.whisperModel)
            } else {
                appState.showWhisperSetup = true
            }
        case .gptAPI:
            WhisperPreloader.shared.release()
            LightningPreloader.shared.release()
        }
    }

    /// 과목명 폴더를 찾아(없으면 만들어) 녹음을 띄운다
    private func startRecording(inFolderNamed name: String) {
        guard !recorder.isBusy, !appState.isRecordingPresented else { return }
        let folder = folders.first { $0.name == name } ?? {
            let created = Folder(name: name)
            context.insert(created)
            try? context.save()
            return created
        }()
        appState.recordFolder = folder
        appState.selectedTab = .library
        appState.isRecordingPresented = true
        Task { await recorder.start(folderName: name) }
    }
}
