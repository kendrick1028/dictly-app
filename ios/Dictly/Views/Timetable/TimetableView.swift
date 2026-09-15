import SwiftUI
import SwiftData

extension Color {
    init(hex: UInt32) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: 1)
    }
}

/// 시간표 팔레트 — 지정 60색. 계열끼리 묶고 각 계열 안에서 어두운 → 밝은 순.
/// (저장된 인덱스가 범위를 넘으면 clamp)
enum PastelPalette {
    static let colors: [Color] = [
        // 레드
        Color(hex: 0x8B1E2D), Color(hex: 0xDF301C), Color(hex: 0xE63946),
        Color(hex: 0xE73F1E), Color(hex: 0xEC5B38),
        // 오렌지
        Color(hex: 0xFB6C00), Color(hex: 0xFF9100), Color(hex: 0xFF9A00),
        Color(hex: 0xF9B637), Color(hex: 0xFFC349), Color(hex: 0xFFDD9C),
        // 옐로우
        Color(hex: 0xF4D35E), Color(hex: 0xFFEA88), Color(hex: 0xFFF1D1),
        // 그린
        Color(hex: 0x091413), Color(hex: 0x1B5E20), Color(hex: 0x285A48),
        Color(hex: 0x408A71), Color(hex: 0x66BB6A), Color(hex: 0x7DCCAD),
        Color(hex: 0x7CD5C7), Color(hex: 0xA5D6A7), Color(hex: 0xB0E4CC),
        Color(hex: 0xE8F5E9),
        // 틸
        Color(hex: 0x224248), Color(hex: 0x325E6A), Color(hex: 0x44A1A4),
        Color(hex: 0x00B7CD), Color(hex: 0x97DDE9),
        // 블루
        Color(hex: 0x1B262C), Color(hex: 0x222831), Color(hex: 0x30475E),
        Color(hex: 0x0F4C75), Color(hex: 0x4D6787), Color(hex: 0x457B9D),
        Color(hex: 0x118AB2), Color(hex: 0x3282B8), Color(hex: 0x5FACD3),
        Color(hex: 0xBBE1FA),
        // 인디고·바이올렛
        Color(hex: 0x464B71), Color(hex: 0x525EA7), Color(hex: 0x6367FF),
        Color(hex: 0x8494FF), Color(hex: 0xC9BEFF),
        // 핑크·퍼플
        Color(hex: 0x612D53), Color(hex: 0x853953), Color(hex: 0xF599C6),
        Color(hex: 0xFFDBFD),
        // 브라운·웜뉴트럴
        Color(hex: 0x524646), Color(hex: 0x715A5A), Color(hex: 0xC1A57B),
        Color(hex: 0xA8A492), Color(hex: 0xFCF2E5),
        // 그레이
        Color(hex: 0x2C2C2C), Color(hex: 0x37353E), Color(hex: 0x44444E),
        Color(hex: 0xD3DAD9), Color(hex: 0xECECEC), Color(hex: 0xF2F2ED),
        Color(hex: 0xF3F4F4)
    ]

    static func color(_ index: Int) -> Color {
        colors[max(0, min(colors.count - 1, index))]
    }

    /// 수업 블록 글자색 — -1 = 흰색(기본), -2 = 검은색, 0 이상 = 팔레트 인덱스
    static func textColor(_ index: Int) -> Color {
        switch index {
        case -2: .black
        case let i where i >= 0: color(i)
        default: .white
        }
    }
}

/// 시간표 — 월~금 · 9~18시 그리드, 1시간 단위
struct TimetableView: View {
    static let days = ["월", "화", "수", "목", "금"]
    static let startHour = 9
    static let endHour = 18
    private let hourHeight: CGFloat = 62
    private let timeColWidth: CGFloat = 17

    @Environment(\.modelContext) private var context
    @Environment(AppSettings.self) private var settings
    @Query(sort: \TimetableClass.createdAt) private var classes: [TimetableClass]
    @Query(sort: \Timetable.createdAt) private var timetables: [Timetable]

    /// 새 수업 추가 슬롯 (탭한 위치)
    @State private var draftSlot: SlotRef?
    @State private var editing: TimetableClass?
    @State private var showNewTimetable = false
    @State private var showRenameTimetable = false
    @State private var timetableName = ""

    /// 선택된 학기 시간표 (없으면 첫 번째)
    private var activeTimetable: Timetable? {
        timetables.first { $0.uuid.uuidString == settings.activeTimetableUUID } ?? timetables.first
    }

    /// 화면·위젯에 쓰는 수업 — 선택된 시간표 소속만
    private var visibleClasses: [TimetableClass] {
        guard let active = activeTimetable else { return [] }
        return classes.filter { $0.timetable?.uuid == active.uuid }
    }

    /// 첫 실행/업데이트 직후 기본 시간표를 만들고 소속 없는 기존 수업을 옮긴다
    private func ensureTimetable() {
        if timetables.isEmpty {
            let created = Timetable(name: "내 시간표")
            context.insert(created)
            for cls in classes where cls.timetable == nil {
                cls.timetable = created
            }
            try? context.save()
            settings.activeTimetableUUID = created.uuid.uuidString
        } else if activeTimetable.map({ $0.uuid.uuidString != settings.activeTimetableUUID }) ?? false {
            settings.activeTimetableUUID = activeTimetable?.uuid.uuidString ?? ""
        }
    }

    struct SlotRef: Identifiable {
        var id: String { "\(weekday)-\(hour)" }
        var weekday: Int
        var hour: Int
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    dayHeader
                    grid
                }
                .padding(.leading, 6)
                .padding(.trailing, 12)
                .padding(.bottom, 20)
            }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                // 가운데(.principal) 가 아니라 왼쪽에. 제목이므로 유리 버튼 배경은 뺀다
                ToolbarItem(placement: .topBarLeading) {
                    timetableMenu
                }
                .sharedBackgroundVisibility(.hidden)
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink {
                        TimetableSettingsView(timetable: activeTimetable)
                    } label: {
                        Image(systemName: "gearshape")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        draftSlot = SlotRef(weekday: 0, hour: Self.startHour)
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(item: $draftSlot) { slot in
                ClassEditorSheet(weekday: slot.weekday, startHour: slot.hour, timetable: activeTimetable)
                    .presentationDetents([.large])
            }
            .sheet(item: $editing) { cls in
                ClassEditorSheet(editing: cls)
                    .presentationDetents([.large])
            }
            .alert("새 시간표", isPresented: $showNewTimetable) {
                TextField("학기 이름", text: $timetableName)
                Button("취소", role: .cancel) {}
                Button("만들기") { createTimetable() }
            } message: {
                Text("예: 2026-1학기")
            }
            .alert("시간표 이름 변경", isPresented: $showRenameTimetable) {
                TextField("학기 이름", text: $timetableName)
                Button("취소", role: .cancel) {}
                Button("저장") { renameTimetable() }
            }
            // 시간표/위젯 설정이 바뀔 때마다 위젯에 동기화 (보이는 학기만)
            .onChange(of: classes) { _, _ in
                TimetableSync.push(classes: visibleClasses, settings: settings)
            }
            .onChange(of: settings.activeTimetableUUID) { _, _ in
                TimetableSync.push(classes: visibleClasses, settings: settings)
            }
            .onChange(of: settings.widgetBackground) { _, _ in
                TimetableSync.push(classes: visibleClasses, settings: settings)
            }
            .onChange(of: settings.widgetDividerIndex) { _, _ in
                TimetableSync.push(classes: visibleClasses, settings: settings)
            }
            .onChange(of: settings.timetableTextIndex) { _, _ in
                TimetableSync.push(classes: visibleClasses, settings: settings)
            }
            .onChange(of: settings.widgetFontScale) { _, _ in
                TimetableSync.push(classes: visibleClasses, settings: settings)
            }
            .onAppear {
                ensureTimetable()
                TimetableSync.push(classes: visibleClasses, settings: settings)
            }
            // 수업·학기·알림 설정이 바뀌면 주간 반복 알림을 다시 깐다
            .task(id: alarmSignature) {
                #if DEBUG
                if ProcessInfo.processInfo.environment["DICTLY_CAPTURE"] != nil { return }
                #endif
                await TimetableNotifications.reschedule(
                    classes: visibleClasses,
                    leadMinutes: settings.classAlarmLeadMinutes,
                    enabled: settings.classAlarmEnabled,
                    startDate: activeTimetable?.startDate,
                    endDate: activeTimetable?.endDate
                )
            }
        }
    }

    /// 알림을 다시 깔아야 하는 조건을 한 문자열로 묶은 값
    private var alarmSignature: String {
        let classPart = visibleClasses
            .map { "\($0.weekday)-\($0.startHour)-\($0.title)-\($0.room)-\($0.createsFolder)" }
            .joined(separator: "|")
        let term = "\(activeTimetable?.startDate?.timeIntervalSince1970 ?? 0)"
            + "-\(activeTimetable?.endDate?.timeIntervalSince1970 ?? 0)"
        return "\(settings.classAlarmEnabled)-\(settings.classAlarmLeadMinutes)-\(term)-\(classPart)"
    }

    // MARK: 학기 시간표 드롭다운

    private var timetableMenu: some View {
        Menu {
            ForEach(timetables) { tt in
                Button {
                    settings.activeTimetableUUID = tt.uuid.uuidString
                } label: {
                    if tt.uuid == activeTimetable?.uuid {
                        Label(tt.name, systemImage: "checkmark")
                    } else {
                        Text(tt.name)
                    }
                }
            }
            Divider()
            Button {
                timetableName = ""
                showNewTimetable = true
            } label: {
                Label("새 시간표", systemImage: "plus")
            }
            if let active = activeTimetable {
                Button {
                    timetableName = active.name
                    showRenameTimetable = true
                } label: {
                    Label("이름 변경", systemImage: "pencil")
                }
                if timetables.count > 1 {
                    Button(role: .destructive) {
                        deleteTimetable(active)
                    } label: {
                        Label("이 시간표 삭제", systemImage: "trash")
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(activeTimetable?.name ?? "시간표")
                    .font(.headline)
                Image(systemName: "chevron.down")
                    .font(.caption2.weight(.semibold))
            }
            .foregroundStyle(.primary)
        }
    }

    private func createTimetable() {
        let name = timetableName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        let created = Timetable(name: name)
        context.insert(created)
        try? context.save()
        settings.activeTimetableUUID = created.uuid.uuidString
    }

    private func renameTimetable() {
        let name = timetableName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty, let active = activeTimetable else { return }
        active.name = name
        try? context.save()
    }

    /// 삭제하면 소속 수업도 함께 지워지고(cascade) 남은 첫 시간표로 옮겨간다
    private func deleteTimetable(_ timetable: Timetable) {
        let next = timetables.first { $0.uuid != timetable.uuid }
        context.delete(timetable)
        try? context.save()
        settings.activeTimetableUUID = next?.uuid.uuidString ?? ""
    }

    private var dayHeader: some View {
        HStack(spacing: 2) {
            Color.clear.frame(width: timeColWidth)
            ForEach(Array(Self.days.enumerated()), id: \.offset) { _, day in
                Text(day)
                    .font(.caption.weight(.semibold))
                    .frame(maxWidth: .infinity)
            }
        }
        .padding(.vertical, 8)
    }

    private var grid: some View {
        HStack(alignment: .top, spacing: 2) {
            // 시간 라벨 열
            VStack(spacing: 0) {
                ForEach(Self.startHour..<Self.endHour, id: \.self) { hour in
                    Text("\(hour)")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(width: timeColWidth, height: hourHeight, alignment: .topTrailing)
                        .padding(.trailing, 2)
                }
            }
            // 요일 열
            ForEach(0..<5, id: \.self) { weekday in
                dayColumn(weekday)
            }
        }
    }

    private func dayColumn(_ weekday: Int) -> some View {
        let totalHeight = CGFloat(Self.endHour - Self.startHour) * hourHeight
        return ZStack(alignment: .top) {
            // 빈 슬롯 (탭 → 추가)
            VStack(spacing: 0) {
                ForEach(Self.startHour..<Self.endHour, id: \.self) { hour in
                    Rectangle()
                        .fill(Color.clear)
                        .frame(height: hourHeight)
                        .overlay(alignment: .top) {
                            Divider().opacity(0.5)
                        }
                        .contentShape(Rectangle())
                        .onTapGesture {
                            draftSlot = SlotRef(weekday: weekday, hour: hour)
                        }
                }
            }
            // 수업 블록
            ForEach(visibleClasses.filter { $0.weekday == weekday }) { cls in
                classBlock(cls)
                    .offset(y: CGFloat(cls.startHour - Self.startHour) * hourHeight)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: totalHeight)
        .background(.quaternary.opacity(0.18))
    }

    private func classBlock(_ cls: TimetableClass) -> some View {
        Button {
            editing = cls
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(cls.title)
                    .font(.caption.weight(.bold))
                    .lineLimit(2)
                if !cls.room.isEmpty {
                    Text(cls.room)
                        .font(.system(size: 9))
                        .lineLimit(1)
                }
                if !cls.professor.isEmpty {
                    Text(cls.professor)
                        .font(.system(size: 9))
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .foregroundStyle(PastelPalette.textColor(settings.timetableTextIndex))
            .padding(6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: CGFloat(cls.durationHours) * hourHeight - 3)
            .background(PastelPalette.color(cls.colorIndex))
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 1.5)
    }
}

// MARK: - 시간표 설정 (수업 알림 / 위젯 배경 / 구분선 색 / 글자 색)

struct TimetableSettingsView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(\.modelContext) private var context

    /// 학기 기간은 시간표마다 따로 저장된다
    var timetable: Timetable?

    var body: some View {
        @Bindable var settings = settings
        Form {
                if let timetable {
                    Section {
                        DatePicker("시작일",
                                   selection: Binding(
                                    get: { timetable.startDate ?? Date() },
                                    set: { timetable.startDate = $0; try? context.save() }),
                                   displayedComponents: .date)
                        DatePicker("종료일",
                                   selection: Binding(
                                    get: { timetable.endDate ?? Date() },
                                    set: { timetable.endDate = $0; try? context.save() }),
                                   displayedComponents: .date)
                        if timetable.startDate != nil || timetable.endDate != nil {
                            Button("기간 지우기", role: .destructive) {
                                timetable.startDate = nil
                                timetable.endDate = nil
                                try? context.save()
                            }
                        }
                    } header: {
                        Text("\(timetable.name) 학기 기간")
                    } footer: {
                        Text("이 기간에만 수업 알림이 옵니다. 노트 주차(N주차)도 시작일을 기준으로 계산됩니다.")
                    }
                }
                Section {
                    Toggle("수업 알림", isOn: $settings.classAlarmEnabled)
                    Picker("알림 시점", selection: $settings.classAlarmLeadMinutes) {
                        Text("정각").tag(0)
                        Text("5분 전").tag(5)
                        Text("10분 전").tag(10)
                        Text("15분 전").tag(15)
                        Text("30분 전").tag(30)
                        Text("1시간 전").tag(60)
                    }
                    .disabled(!settings.classAlarmEnabled)
                } header: {
                    Text("수업 알림")
                } footer: {
                    Text("현재 시간표의 수업 시작 전에 알립니다. 알림을 누르면 과목명 폴더로 바로 녹음이 시작됩니다.")
                }
                // 배경·글자 크기를 한 섹션으로 묶고 둘 다 드롭다운으로 통일
                Section("위젯") {
                    Picker("배경", selection: $settings.widgetBackground) {
                        Text("시스템").tag("system")
                        Text("흰색").tag("white")
                        Text("검은색").tag("black")
                        Text("투명").tag("clear")
                    }
                    Picker("글자 크기", selection: $settings.widgetFontScale) {
                        Text("아주 작게").tag(0.8)
                        Text("작게").tag(0.9)
                        Text("기본").tag(1.0)
                        Text("크게").tag(1.15)
                        Text("아주 크게").tag(1.35)
                    }
                }
                Section("구분선 색") {
                    Button {
                        settings.widgetDividerIndex = -1
                    } label: {
                        textChoiceRow("기본 (회색)", selected: settings.widgetDividerIndex == -1)
                    }
                    // 팔레트는 기본적으로 접어두고 눌러서 편다
                    DisclosureGroup("색상 선택") {
                        palette(selected: settings.widgetDividerIndex) {
                            settings.widgetDividerIndex = $0
                        }
                    }
                }
                Section("글자 색") {
                    Button {
                        settings.timetableTextIndex = -1
                    } label: {
                        textChoiceRow("흰색 (기본)", selected: settings.timetableTextIndex == -1)
                    }
                    Button {
                        settings.timetableTextIndex = -2
                    } label: {
                        textChoiceRow("검은색", selected: settings.timetableTextIndex == -2)
                    }
                    DisclosureGroup("색상 선택") {
                        palette(selected: settings.timetableTextIndex) {
                            settings.timetableTextIndex = $0
                        }
                    }
                }
        }
        // 어느 시간표의 설정인지 제목에서 바로 보이게 한다
        .navigationTitle(timetable?.name ?? "시간표 설정")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func palette(selected: Int, onPick: @escaping (Int) -> Void) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 9), spacing: 10) {
            ForEach(0..<PastelPalette.colors.count, id: \.self) { idx in
                Circle()
                    .fill(PastelPalette.colors[idx])
                    .frame(width: 30, height: 30)
                    .overlay(
                        Circle()
                            .strokeBorder(Color.primary.opacity(selected == idx ? 0.8 : 0.08),
                                          lineWidth: selected == idx ? 2.5 : 1)
                    )
                    .onTapGesture { onPick(idx) }
            }
        }
        .padding(.vertical, 6)
    }

    private func textChoiceRow(_ label: String, selected: Bool) -> some View {
        HStack {
            Text(label)
                .foregroundStyle(.primary)
            Spacer()
            if selected {
                Image(systemName: "checkmark")
            }
        }
    }
}

// MARK: - 수업 추가/편집 시트

struct ClassEditorSheet: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    var editing: TimetableClass?
    /// 새 수업이 들어갈 학기 시간표
    var timetable: Timetable?

    @State private var title = ""
    @State private var room = ""
    @State private var professor = ""
    @State private var weekday = 0
    @State private var startHour = TimetableView.startHour
    @State private var durationHours = 1
    @State private var colorIndex = 0
    @State private var createsFolder = true

    init(weekday: Int = 0, startHour: Int = TimetableView.startHour, timetable: Timetable? = nil) {
        self.editing = nil
        self.timetable = timetable
        _weekday = State(initialValue: weekday)
        _startHour = State(initialValue: startHour)
        _colorIndex = State(initialValue: Int.random(in: 0..<PastelPalette.colors.count))
    }

    init(editing: TimetableClass) {
        self.editing = editing
        self.timetable = editing.timetable
        _title = State(initialValue: editing.title)
        _room = State(initialValue: editing.room)
        _professor = State(initialValue: editing.professor)
        _weekday = State(initialValue: editing.weekday)
        _startHour = State(initialValue: editing.startHour)
        _durationHours = State(initialValue: editing.durationHours)
        _colorIndex = State(initialValue: editing.colorIndex)
        _createsFolder = State(initialValue: editing.createsFolder)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("수업 정보") {
                    TextField("강의명", text: $title)
                    TextField("강의실", text: $room)
                    TextField("교수명", text: $professor)
                }
                Section("시간") {
                    Picker("요일", selection: $weekday) {
                        ForEach(0..<5, id: \.self) { d in
                            Text(TimetableView.days[d]).tag(d)
                        }
                    }
                    .pickerStyle(.segmented)
                    Picker("시작", selection: $startHour) {
                        ForEach(TimetableView.startHour..<TimetableView.endHour, id: \.self) { hour in
                            Text("\(hour):00").tag(hour)
                        }
                    }
                    Stepper("수업 시간: \(durationHours)시간", value: $durationHours,
                            in: 1...(TimetableView.endHour - startHour))
                }
                Section {
                    Toggle("과목 폴더 만들기", isOn: $createsFolder)
                } footer: {
                    Text("끄면 이 과목의 폴더를 만들지 않습니다. 수업 알림은 그대로 옵니다.")
                }
                Section("색상") {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 9), spacing: 10) {
                        ForEach(0..<PastelPalette.colors.count, id: \.self) { idx in
                            Circle()
                                .fill(PastelPalette.colors[idx])
                                .frame(width: 30, height: 30)
                                .overlay(
                                    Circle()
                                        .strokeBorder(Color.primary.opacity(colorIndex == idx ? 0.8 : 0.08),
                                                      lineWidth: colorIndex == idx ? 2.5 : 1)
                                )
                                .onTapGesture { colorIndex = idx }
                        }
                    }
                    .padding(.vertical, 6)
                }
                if editing != nil {
                    Section {
                        Button("수업 삭제", role: .destructive) {
                            if let editing {
                                context.delete(editing)
                                try? context.save()
                            }
                            dismiss()
                        }
                    }
                }
            }
            .navigationTitle(editing == nil ? "수업 추가" : "수업 편집")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("취소") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("저장") { save() }
                        .bold()
                        .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    /// 과목은 곧 폴더 — 같은 이름이 없으면 만들어 둔다 (알림 → 녹음이 여기로 저장된다)
    private func ensureFolder(named name: String) {
        let descriptor = FetchDescriptor<Folder>(predicate: #Predicate { $0.name == name })
        let existing = (try? context.fetch(descriptor)) ?? []
        guard existing.isEmpty else { return }
        context.insert(Folder(name: name))
    }

    /// 토글을 끄면 자동으로 만들었던 폴더를 지운다.
    /// 노트가 들어 있는 폴더는 남긴다 — 녹음을 함께 지울 수는 없다
    private func removeFolderIfEmpty(named name: String) {
        let descriptor = FetchDescriptor<Folder>(predicate: #Predicate { $0.name == name })
        for folder in (try? context.fetch(descriptor)) ?? [] where folder.memos?.isEmpty ?? true {
            context.delete(folder)
        }
    }

    private func save() {
        let name = title.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        if createsFolder {
            ensureFolder(named: name)
        } else {
            removeFolderIfEmpty(named: name)
        }
        if let editing {
            editing.title = name
            editing.room = room.trimmingCharacters(in: .whitespaces)
            editing.professor = professor.trimmingCharacters(in: .whitespaces)
            editing.weekday = weekday
            editing.startHour = startHour
            editing.durationHours = min(durationHours, TimetableView.endHour - startHour)
            editing.colorIndex = colorIndex
            editing.createsFolder = createsFolder
        } else {
            let cls = TimetableClass(
                title: name,
                room: room.trimmingCharacters(in: .whitespaces),
                professor: professor.trimmingCharacters(in: .whitespaces),
                weekday: weekday,
                startHour: startHour,
                durationHours: min(durationHours, TimetableView.endHour - startHour),
                colorIndex: colorIndex
            )
            cls.timetable = timetable
            cls.createsFolder = createsFolder
            context.insert(cls)
        }
        try? context.save()
        dismiss()
    }
}
