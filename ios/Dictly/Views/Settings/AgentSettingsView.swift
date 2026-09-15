import SwiftUI
import SwiftData

/// Agent management — 과목별 프로필 (용어 사전, 수식/치환 규칙, 시스템 프롬프트, 지식 팩)
struct AgentListView: View {
    @Query(sort: \Agent.createdAt) private var agents: [Agent]
    @Environment(\.modelContext) private var context
    @Environment(AppSettings.self) private var settings

    @State private var showNew = false
    @State private var newName = ""

    var body: some View {
        List {
            if agents.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    Text("과목별 에이전트를 만들면 용어 사전·수식 규칙·치환 규칙·지식 팩이 전사와 교정에 자동 적용됩니다.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Button {
                        addAllPresets()
                    } label: {
                        Label("CPA 7과목 프리셋 한번에 추가", systemImage: "sparkles")
                            .font(.subheadline.weight(.semibold))
                    }
                }
                .padding(.vertical, 4)
            }
            ForEach(agents) { agent in
                NavigationLink {
                    AgentEditorView(agent: agent)
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(agent.name).font(.body)
                            Text(agent.correctionKeywords.isEmpty ? "설정 없음" : agent.correctionKeywords)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer()
                        if settings.activeAgentUUID == agent.uuid.uuidString {
                            Text("활성")
                                .font(.caption2.bold())
                                .foregroundStyle(.green)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(Color.green.opacity(0.12), in: Capsule())
                        }
                    }
                }
            }
            .onDelete { indexSet in
                for idx in indexSet {
                    let agent = agents[idx]
                    if settings.activeAgentUUID == agent.uuid.uuidString {
                        settings.applyActiveAgent(nil)
                    }
                    context.delete(agent)
                }
                try? context.save()
            }
        }
        .navigationTitle("에이전트")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        newName = ""
                        showNew = true
                    } label: {
                        Label("새 에이전트…", systemImage: "square.and.pencil")
                    }
                    Section("CPA 프리셋") {
                        ForEach(PresetCatalog.all, id: \.packID) { preset in
                            let exists = agents.contains { $0.presetID == preset.packID }
                            Button {
                                addPreset(preset.packID)
                            } label: {
                                if exists {
                                    Label(preset.subject, systemImage: "checkmark")
                                } else {
                                    Text(preset.subject)
                                }
                            }
                            .disabled(exists)
                        }
                    }
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .alert("새 에이전트", isPresented: $showNew) {
            TextField("과목/이름 (예: 재무관리)", text: $newName)
            Button("만들기") {
                let name = newName.trimmingCharacters(in: .whitespaces)
                guard !name.isEmpty else { return }
                context.insert(Agent(name: name))
                try? context.save()
            }
            Button("취소", role: .cancel) {}
        }
    }

    private func addPreset(_ packID: String) {
        guard !agents.contains(where: { $0.presetID == packID }),
              let agent = PresetCatalog.makeAgent(packID: packID) else { return }
        context.insert(agent)
        try? context.save()
    }

    private func addAllPresets() {
        for preset in PresetCatalog.all { addPreset(preset.packID) }
    }
}

/// TextEditor 는 placeholder API 가 없다 — 비어 있을 때만 좌상단에 예시를 겹쳐 그린다
private struct PlaceholderTextEditor: View {
    @Binding var text: String
    let placeholder: String
    var font: Font = .callout.monospaced()
    var minHeight: CGFloat = 100

    var body: some View {
        TextEditor(text: $text)
            .font(font)
            .frame(minHeight: minHeight)
            .overlay(alignment: .topLeading) {
                if text.isEmpty {
                    Text(placeholder)
                        .font(font)
                        .foregroundStyle(.tertiary)
                        .padding(.top, 8)
                        .padding(.leading, 5)
                        .allowsHitTesting(false)
                }
            }
    }
}

struct AgentEditorView: View {
    @Bindable var agent: Agent
    @Environment(AppSettings.self) private var settings

    var body: some View {
        Form {
            if let packID = agent.presetID, let pack = KnowledgeStore.pack(id: packID) {
                Section {
                    Label {
                        Text("지식 팩 연결됨 — \(pack.subject) (\(pack.countSummary))")
                            .font(.subheadline)
                    } icon: {
                        Image(systemName: "brain.fill")
                            .foregroundStyle(.tint)
                    }
                } footer: {
                    Text("녹음 중 이 과목의 관련 지식만 골라 실시간 교정에 주입됩니다. 아래 용어 사전·규칙은 자유롭게 수정해도 지식 팩과 함께 적용됩니다.")
                }
            }
            Section("이름") {
                TextField("에이전트 이름", text: $agent.name)
            }
            Section {
                TextField("예: WACC, 베타, EBITDA, 자기자본비용", text: $agent.correctionKeywords, axis: .vertical)
                    .lineLimit(2...6)
            } header: {
                Text("용어 사전")
            } footer: {
                Text("이 과목에서 자주 나오는 용어·고유명사를 쉼표로 나열하세요. 실시간 교정이 이 표기를 우선 사용합니다.")
            }
            Section {
                PlaceholderTextEditor(text: $agent.mathRulesText,
                                      placeholder: "케이 이=K_e\n베타 엘=\\beta_L\n왁=WACC")
            } header: {
                Text("수식 규칙")
            } footer: {
                Text("한 줄에 하나씩 「발음=기호」 형식.")
            }
            Section {
                PlaceholderTextEditor(text: $agent.replacementsText,
                                      placeholder: "비채=부채\n단기순이익=당기순이익")
            } header: {
                Text("치환 규칙")
            } footer: {
                Text("한 줄에 하나씩 「오인식=정정」 형식. 전사 직후 자동 치환됩니다.")
            }
            Section {
                PlaceholderTextEditor(text: $agent.systemPrompt,
                                      placeholder: "예: 당신은 세법 강의 전사를 다룹니다. 세법 용어는 법전 표기를 따르세요.",
                                      font: .body,
                                      minHeight: 120)
            } header: {
                Text("시스템 프롬프트")
            } footer: {
                Text("이 과목의 교정·요약·생성 AI에 적용되는 지침입니다.")
            }
        }
        .navigationTitle(agent.name)
        .navigationBarTitleDisplayMode(.inline)
        .onDisappear {
            // keep the live snapshot in sync when the active agent was edited
            if settings.activeAgentUUID == agent.uuid.uuidString {
                settings.applyActiveAgent(agent)
            }
        }
    }
}
