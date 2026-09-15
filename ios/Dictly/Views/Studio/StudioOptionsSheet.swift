import SwiftUI

/// pre-generation options per studio kind (desktop StudioOptionsModal)
struct StudioOptionsSheet: View {
    let kind: StudioKind
    let onGenerate: (Prompts.StudioOptions) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(AppSettings.self) private var settings
    @State private var opts = Prompts.StudioOptions()
    @State private var quizTypes: Set<String> = ["verbal", "calc", "ox"]
    @State private var techniques: Set<String> = ["앞글자", "스토리", "연상", "리듬"]

    var body: some View {
        @Bindable var settings = settings
        NavigationStack {
            Form {
                Section("생성 엔진") {
                    Picker("엔진", selection: $settings.studioEngine) {
                        ForEach(EngineChoice.allCases) { engine in
                            Text(engine.label).tag(engine)
                        }
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()
                }
                switch kind {
                case .summary:
                    Section("형식") {
                        Picker("형식", selection: $opts.format) {
                            Text("핵심 요약").tag("summary")
                            Text("브리핑 문서").tag("briefing")
                            Text("학습 가이드").tag("guide")
                            Text("블로그 글").tag("blog")
                        }
                        .pickerStyle(.inline)
                        .labelsHidden()
                    }
                case .quiz:
                    Section("난이도") {
                        Picker("난이도", selection: $opts.difficulty) {
                            Text("쉬움").tag("easy")
                            Text("보통").tag("medium")
                            Text("어려움").tag("hard")
                        }
                        .pickerStyle(.segmented)
                    }
                    Section("문제 수") {
                        Stepper("\(opts.count)개", value: $opts.count, in: 3...20)
                    }
                    Section("문제 유형") {
                        typeToggle("말문제", id: "verbal", set: $quizTypes)
                        typeToggle("계산문제", id: "calc", set: $quizTypes)
                        typeToggle("OX퀴즈", id: "ox", set: $quizTypes)
                    }
                case .flashcards:
                    Section("카드 수") {
                        Stepper("\(opts.cardCount)장", value: $opts.cardCount, in: 5...60, step: 5)
                    }
                    Section("초점") {
                        Picker("초점", selection: $opts.focus) {
                            Text("개념 위주").tag("concept")
                            Text("공식 위주").tag("formula")
                            Text("골고루").tag("mixed")
                        }
                        .pickerStyle(.segmented)
                    }
                case .mnemonic:
                    Section("암기 기법") {
                        typeToggle("앞글자", id: "앞글자", set: $techniques)
                        typeToggle("스토리", id: "스토리", set: $techniques)
                        typeToggle("연상", id: "연상", set: $techniques)
                        typeToggle("리듬", id: "리듬", set: $techniques)
                    }
                case .tutor:
                    Section("수업 모드") {
                        Picker("모드", selection: $opts.tutorMode) {
                            Text("차근차근 배우기").tag("learn")
                            Text("시험 직전 스프린트").tag("sprint")
                        }
                        .pickerStyle(.segmented)
                    }
                    Section("과목명 (선택)") {
                        TextField("예: 재무관리", text: $opts.tutorSubject)
                    }
                default:
                    EmptyView()
                }

                if kind != .tutor {
                    Section("추가 요청 (선택)") {
                        TextField("예: 3장 내용 위주로", text: $opts.custom, axis: .vertical)
                            .lineLimit(2...4)
                    }
                }
            }
            .navigationTitle("\(kind.name) 옵션")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("취소") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(kind == .tutor ? "수업 시작" : "생성") {
                        opts.types = Array(quizTypes)
                        opts.techniques = Array(techniques)
                        dismiss()
                        onGenerate(opts)
                    }
                    .bold()
                    .disabled(kind == .quiz && quizTypes.isEmpty)
                }
            }
        }
    }

    private func typeToggle(_ label: String, id: String, set: Binding<Set<String>>) -> some View {
        Toggle(label, isOn: Binding(
            get: { set.wrappedValue.contains(id) },
            set: { on in
                if on { set.wrappedValue.insert(id) } else { set.wrappedValue.remove(id) }
            }
        ))
    }
}
