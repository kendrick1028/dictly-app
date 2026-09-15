import SwiftUI
import SwiftData

struct SettingsView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(AIService.self) private var ai
    @Environment(\.modelContext) private var context
    @Query(sort: \Agent.createdAt) private var agents: [Agent]

    @State private var speechLocales: [Locale] = []
    @State private var diagRunning = false
    @State private var diagResult: String?
    // 정적 목록으로 즉시 시드 — 네트워크 갱신(availableModels)은 세션당 1회 메모이즈
    @State private var whisperModels: [String] = WhisperEngine.curatedModels
    @State private var showIntro = false

    var body: some View {
        NavigationStack {
            Form {
                appearanceSection
                transcriptionSection
                correctionSection
                agentSection
                studioSection
                providersSection
                infoSection
            }
            .navigationTitle("설정")
            .task {
                speechLocales = await SpeechAnalyzerEngine.supportedLocales()
                whisperModels = await WhisperEngine.availableModels()
            }
            .fullScreenCover(isPresented: $showIntro) {
                IntroView { showIntro = false }
            }
        }
    }

    // MARK: 화면

    private var appearanceSection: some View {
        @Bindable var settings = settings
        return Section("화면") {
            Picker("모드", selection: $settings.appearance) {
                Text("시스템 설정").tag("system")
                Text("라이트").tag("light")
                Text("다크").tag("dark")
            }
        }
    }

    // MARK: 전사

    private var transcriptionSection: some View {
        @Bindable var settings = settings
        return Section("전사") {
            Picker("전사 엔진", selection: $settings.sttEngine) {
                ForEach(SttEngineChoice.allCases) { engine in
                    Text(engine.label).tag(engine)
                }
            }
            Picker("언어", selection: $settings.transcribeLocaleID) {
                ForEach(localeOptions, id: \.self) { id in
                    Text(localeDisplayName(id)).tag(id)
                }
            }
            if settings.sttEngine == .whisper {
                Picker("Whisper 모델", selection: $settings.whisperModel) {
                    ForEach(whisperModelOptions, id: \.self) { model in
                        Text(WhisperEngine.pickerLabel(model)).tag(model)
                    }
                }
                LabeledContent("모델 상태") {
                    if WhisperEngine.isLive(settings.whisperModel) {
                        Text(LightningPreloader.shared.statusLabel)
                            .font(.callout)
                            .foregroundStyle(LightningPreloader.shared.phase == .ready ? .green : .secondary)
                    } else {
                        Text(WhisperPreloader.shared.statusLabel)
                            .font(.callout)
                            .foregroundStyle(WhisperPreloader.shared.phase == .ready ? .green : .secondary)
                    }
                }
            }
            Group {
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text("문장 끊김 무음")
                        Spacer()
                        Text(String(format: "%.1f초", settings.vadSilenceSec))
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    }
                    Slider(value: $settings.vadSilenceSec, in: 0.5...3.0, step: 0.1)
                }
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text("최대 청크 길이")
                        Spacer()
                        Text("\(Int(settings.vadMaxSec))초")
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    }
                    Slider(value: $settings.vadMaxSec, in: 10...40, step: 1)
                }
            }
        }
    }

    /// 저장된 모델이 큐레이션 목록에 없어도(과거 선택) 피커가 빈 선택이 되지 않게 덧붙인다
    private var whisperModelOptions: [String] {
        var list = whisperModels
        if LightningSupport.isSupported { list.insert(WhisperEngine.liveModel, at: 0) }
        if !settings.whisperModel.isEmpty, !list.contains(settings.whisperModel) {
            list.append(settings.whisperModel)
        }
        return WhisperEngine.sortedForDisplay(list)
    }

    private var localeOptions: [String] {
        var ids = speechLocales.map { $0.identifier(.bcp47) }
        for essential in ["ko-KR", "en-US", "ja-JP"] where !ids.contains(essential) {
            ids.append(essential)
        }
        if !ids.contains(settings.transcribeLocaleID) { ids.append(settings.transcribeLocaleID) }
        return ids.sorted { a, b in
            if a == "ko-KR" { return true }
            if b == "ko-KR" { return false }
            return localeDisplayName(a) < localeDisplayName(b)
        }
    }

    private func localeDisplayName(_ id: String) -> String {
        Locale(identifier: "ko_KR").localizedString(forIdentifier: id) ?? id
    }


    // MARK: AI 교정

    private var correctionSection: some View {
        @Bindable var settings = settings
        return Section("AI 교정") {
            Toggle("실시간 교정", isOn: $settings.liveCorrect)
            Toggle("녹음 후 AI 제목 생성", isOn: $settings.autoTitle)
            Picker("교정 엔진", selection: $settings.correctionEngine) {
                ForEach(EngineChoice.allCases) { engine in
                    Text(engine.label).tag(engine)
                }
            }
        }
    }

    // MARK: 에이전트

    private var agentSection: some View {
        Section("에이전트") {
            Picker("활성 에이전트", selection: Binding(
                get: { settings.activeAgentUUID },
                set: { newValue in
                    settings.applyActiveAgent(agents.first { $0.uuid.uuidString == newValue })
                }
            )) {
                Text("없음").tag("")
                ForEach(agents) { agent in
                    Text(agent.name).tag(agent.uuid.uuidString)
                }
            }
            NavigationLink("에이전트 관리") {
                AgentListView()
            }
        }
    }

    // MARK: 스튜디오

    private var studioSection: some View {
        @Bindable var settings = settings
        return Section("스튜디오") {
            Picker("생성 엔진", selection: $settings.studioEngine) {
                ForEach(EngineChoice.allCases) { engine in
                    Text(engine.label).tag(engine)
                }
            }
        }
    }

    // MARK: AI 연결 (providers)

    private var providersSection: some View {
        @Bindable var settings = settings
        return Section("AI 연결") {
            HStack(spacing: 6) {
                Text("Apple Intelligence")
                Spacer()
                Group {
                    Image(systemName: AppleIntelligenceBackend.isAvailable ? "checkmark.circle.fill" : "xmark.circle.fill")
                    Text(AppleIntelligenceBackend.isAvailable ? "사용 가능" : "사용 불가")
                }
                .font(.callout)
                .foregroundStyle(AppleIntelligenceBackend.isAvailable ? AnyShapeStyle(.green) : AnyShapeStyle(.orange))
            }
            .frame(height: 22)
            providerLink("GPT", account: "openai", placeholder: "sk-…", model: $settings.openaiModel,
                         presets: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"])
            providerLink("Claude", account: "anthropic", placeholder: "sk-ant-…", model: $settings.anthropicModel,
                         presets: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-sonnet-4-5"])
            providerLink("Gemini", account: "gemini", placeholder: "AIza…", model: $settings.geminiModel,
                         presets: ["gemini-3-pro", "gemini-2.5-flash"])
            providerLink("Grok", account: "grok", placeholder: "xai-…", model: $settings.grokModel,
                         presets: ["grok-4", "grok-4-fast"])
        }
    }

    private func providerLink(_ title: String, account: String, placeholder: String, model: Binding<String>, presets: [String]) -> some View {
        NavigationLink {
            ProviderDetailView(title: title, account: account, placeholder: placeholder, model: model, presets: presets)
        } label: {
            HStack {
                Text(title)
                Spacer()
                if KeychainStore.isSet(account) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                        .font(.callout)
                }
            }
        }
    }

    // MARK: 정보

    private var infoSection: some View {
        Section("정보") {
            LabeledContent("앱", value: "Dictly for iOS")
            LabeledContent("버전", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0")
            Button("온보딩 다시 보기") { showIntro = true }
            // 실시간 로컬 엔진(개발 중) 자가진단 — MLX 연산·가중치 헤더 접근 확인
            Button {
                diagRunning = true
                diagResult = nil
                // 실제 발화가 담긴(10초 이상) 최근 녹음을 대조 전사의 기준 오디오로 쓴다
                var descriptor = FetchDescriptor<Memo>(
                    predicate: #Predicate { $0.audioFileName != nil && $0.durationSec > 10 },
                    sortBy: [SortDescriptor(\.createdAt, order: .reverse)])
                descriptor.fetchLimit = 1
                let memo = (try? context.fetch(descriptor))?.first
                let audioURL = memo?.audioURL
                let audioTitle = memo?.title ?? ""
                Task {
                    diagResult = await LightningDiag.run(audioURL: audioURL, audioTitle: audioTitle) { status in
                        diagResult = status
                    }
                    diagRunning = false
                }
            } label: {
                HStack {
                    Text("실시간 엔진 진단")
                    Spacer()
                    if diagRunning { ProgressView() }
                }
            }
            .tint(.primary)
            .disabled(diagRunning)
            if let diagResult {
                Text(diagResult)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
        }
    }
}

// MARK: - provider sub-page (API 키 + 모델)

struct ProviderDetailView: View {
    let title: String
    let account: String
    let placeholder: String
    @Binding var model: String
    var presets: [String] = []

    @State private var keyDraft = ""
    @State private var refresh = false

    private var isSet: Bool {
        _ = refresh
        return KeychainStore.isSet(account)
    }

    var body: some View {
        Form {
            Section("API 키") {
                if isSet {
                    LabeledContent("상태") {
                        Label("연결됨", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                            .font(.callout)
                    }
                }
                SecureField(isSet ? "새 키 입력 시 교체" : placeholder, text: $keyDraft)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if isSet {
                    Button("키 삭제", role: .destructive) {
                        KeychainStore.delete(account)
                        refresh.toggle()
                    }
                }
            }
            Section("모델") {
                ForEach(presets, id: \.self) { preset in
                    Button {
                        model = preset
                    } label: {
                        HStack {
                            Text(preset)
                                .font(.callout.monospaced())
                                .foregroundStyle(.primary)
                            Spacer()
                            if model == preset {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(Color.accentColor)
                            }
                        }
                    }
                }
                LabeledContent("직접 입력") {
                    TextField("모델명", text: $model)
                        .multilineTextAlignment(.trailing)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.callout.monospaced())
                }
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("저장") {
                    let key = keyDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !key.isEmpty else { return }
                    KeychainStore.set(key, for: account)
                    keyDraft = ""
                    refresh.toggle()
                }
                .bold()
                .disabled(keyDraft.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }
}
