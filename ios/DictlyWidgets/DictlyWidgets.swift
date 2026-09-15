import WidgetKit
import SwiftUI
import Security

// MARK: - 공유 페이로드 (앱과 동일 구조, 키체인 공유 그룹으로 수신)

struct SharedTimetablePayload: Codable {
    struct SharedClass: Codable {
        var title: String
        var room: String
        var professor: String
        var weekday: Int
        var startHour: Int
        var durationHours: Int
        var colorIndex: Int
    }
    var classes: [SharedClass]
    var background: String
    var dividerIndex: Int
    /// 수업 블록 글자색 (-1 = 흰색, -2 = 검은색, 0 이상 = 팔레트 인덱스).
    /// 이 키가 없던 시절의 페이로드도 계속 읽히도록 옵셔널로 둔다
    var textIndex: Int?
    /// 위젯 글자 크기 배율 (1.0 = 기본)
    var fontScale: Double?
}

enum TimetableStore {
    static func load() -> SharedTimetablePayload? {
        for group in ["676C73FL9J.com.leehyunwoo.dictly", nil] {
            var query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: "com.leehyunwoo.dictly.shared",
                kSecAttrAccount as String: "sharedTimetable",
                kSecReturnData as String: true,
                kSecMatchLimit as String: kSecMatchLimitOne
            ]
            if let group { query[kSecAttrAccessGroup as String] = group }
            var item: CFTypeRef?
            if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
               let data = item as? Data,
               let payload = try? JSONDecoder().decode(SharedTimetablePayload.self, from: data) {
                return payload
            }
        }
        return nil
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: 1)
    }
}

/// 앱과 동일한 팔레트 (Dictly/Views/Timetable/TimetableView.swift 와 순서까지 일치해야 한다)
enum WidgetPalette {
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

// MARK: - Provider

struct TimetableEntry: TimelineEntry {
    let date: Date
    let payload: SharedTimetablePayload?
}

struct TimetableProvider: TimelineProvider {
    func placeholder(in context: Context) -> TimetableEntry {
        TimetableEntry(date: .now, payload: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (TimetableEntry) -> Void) {
        completion(TimetableEntry(date: .now, payload: TimetableStore.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TimetableEntry>) -> Void) {
        let entry = TimetableEntry(date: .now, payload: TimetableStore.load())
        // 다음 정시에 갱신
        let next = Calendar.current.nextDate(after: .now, matching: DateComponents(minute: 0), matchingPolicy: .nextTime) ?? .now.addingTimeInterval(3600)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

// MARK: - helpers

private func todayWeekdayIndex(_ date: Date) -> Int? {
    // Calendar: 1=일 … 7=토 → 0=월 … 4=금
    let wd = Calendar.current.component(.weekday, from: date)
    let mapped = wd - 2
    return (0...4).contains(mapped) ? mapped : nil
}

/// 배경을 뷰로 깐다 — 셰이프 스타일로 주면 위젯 기본 머티리얼이 비쳐 검정이 회색으로 보인다
@ViewBuilder
private func widgetBackgroundView(_ payload: SharedTimetablePayload?) -> some View {
    switch payload?.background ?? "system" {
    case "white": Color.white
    case "black": Color.black
    case "clear": Color.clear
    default: Color(.systemBackground)
    }
}

private func textColor(_ payload: SharedTimetablePayload?) -> Color {
    switch payload?.background ?? "system" {
    case "white": .black
    case "black": .white
    default: .primary
    }
}

private func dividerColor(_ payload: SharedTimetablePayload?) -> Color {
    guard let payload, payload.dividerIndex >= 0 else { return Color.gray.opacity(0.35) }
    return WidgetPalette.color(payload.dividerIndex)
}

// MARK: - Views

struct NextClassView: View {
    let entry: TimetableEntry

    var body: some View {
        let fg = textColor(entry.payload)
        VStack(alignment: .leading, spacing: 6) {
            Text("다음 수업")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(fg.opacity(0.55))
            if let next = nextClass() {
                RoundedRectangle(cornerRadius: 6)
                    .fill(WidgetPalette.color(next.colorIndex))
                    .frame(width: 34, height: 5)
                Text(next.title)
                    .font(.headline)
                    .foregroundStyle(fg)
                    .lineLimit(2)
                Text("\(next.startHour):00 – \(next.startHour + next.durationHours):00")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(fg.opacity(0.7))
                if !next.room.isEmpty {
                    Text(next.room)
                        .font(.caption2)
                        .foregroundStyle(fg.opacity(0.55))
                        .lineLimit(1)
                }
            } else {
                Spacer()
                Text("오늘 남은 수업이 없어요")
                    .font(.subheadline)
                    .foregroundStyle(fg.opacity(0.6))
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .containerBackground(for: .widget) { widgetBackgroundView(entry.payload) }
    }

    private func nextClass() -> SharedTimetablePayload.SharedClass? {
        guard let payload = entry.payload,
              let today = todayWeekdayIndex(entry.date) else { return nil }
        let hour = Calendar.current.component(.hour, from: entry.date)
        return payload.classes
            .filter { $0.weekday == today && $0.startHour + $0.durationHours > hour }
            .sorted { $0.startHour < $1.startHour }
            .first
    }
}

/// 월~금 × 시간 격자로 그리는 실제 시간표. 행 범위는 등록된 수업에 맞춰 잡아
/// 위젯 높이를 빈 시간대에 낭비하지 않는다
struct TimetableGridView: View {
    let entry: TimetableEntry

    private static let days = ["월", "화", "수", "목", "금"]

    var body: some View {
        let payload = entry.payload
        let fg = textColor(payload)
        let line = dividerColor(payload)
        let blockFG = WidgetPalette.textColor(payload?.textIndex ?? -1)
        let scale = payload?.fontScale ?? 1.0
        let classes = payload?.classes ?? []
        let range = hourRange(classes)
        let rows = range.upperBound - range.lowerBound

        GeometryReader { geo in
            // 시각 열과 요일 헤더도 글자 배율을 따라 커진다
            let timeW: CGFloat = 15 * scale
            let headerH: CGFloat = 13 * scale
            let colW = max(1, (geo.size.width - timeW) / CGFloat(Self.days.count))
            let rowH = max(1, (geo.size.height - headerH) / CGFloat(rows))
            let gridW = colW * CGFloat(Self.days.count)

            ZStack(alignment: .topLeading) {
                // 요일 헤더
                ForEach(Array(Self.days.enumerated()), id: \.offset) { index, day in
                    Text(day)
                        .font(.system(size: 9 * scale, weight: .semibold))
                        .foregroundStyle(fg.opacity(0.75))
                        .frame(width: colW, height: headerH)
                        .offset(x: timeW + colW * CGFloat(index))
                }
                // 시각 라벨
                ForEach(0..<rows, id: \.self) { row in
                    Text("\(range.lowerBound + row)")
                        .font(.system(size: 8 * scale).monospacedDigit())
                        .foregroundStyle(fg.opacity(0.55))
                        .frame(width: timeW - 2, height: rowH, alignment: .topTrailing)
                        .offset(y: headerH + rowH * CGFloat(row))
                }
                // 격자
                ForEach(0...rows, id: \.self) { row in
                    Rectangle()
                        .fill(line)
                        .frame(width: gridW, height: 0.5)
                        .offset(x: timeW, y: headerH + rowH * CGFloat(row))
                }
                ForEach(0...Self.days.count, id: \.self) { col in
                    Rectangle()
                        .fill(line)
                        .frame(width: 0.5, height: rowH * CGFloat(rows))
                        .offset(x: timeW + colW * CGFloat(col), y: headerH)
                }
                // 수업 블록
                ForEach(Array(classes.enumerated()), id: \.offset) { _, cls in
                    if (0..<Self.days.count).contains(cls.weekday) {
                        classBlock(cls, fg: blockFG, scale: scale,
                                   width: colW, height: rowH * CGFloat(max(1, cls.durationHours)))
                            .offset(x: timeW + colW * CGFloat(cls.weekday),
                                    y: headerH + rowH * CGFloat(cls.startHour - range.lowerBound))
                    }
                }
            }
        }
        // 위젯 기본 컨테이너 마진(.contentMarginsDisabled)을 끄고 최소한만 준다
        .padding(5)
        .containerBackground(for: .widget) { widgetBackgroundView(payload) }
    }

    /// 표시 항목은 **블록의 실제 높이**로 정한다.
    /// 1시간 높이(rowH)로 판정하면 하프 사이즈에서 3시간짜리 수업도 강의실이 숨겨졌다.
    private func classBlock(_ cls: SharedTimetablePayload.SharedClass, fg: Color, scale: Double,
                            width: CGFloat, height: CGFloat) -> some View {
        let showRoom = height >= 26 * scale
        let showProfessor = height >= 38 * scale
        return VStack(alignment: .leading, spacing: 1) {
            Text(cls.title)
                .font(.system(size: 9 * scale, weight: .bold))
                .lineLimit(showProfessor ? 2 : 1)
                .minimumScaleFactor(0.75)
            if showRoom, !cls.room.isEmpty {
                Text(cls.room)
                    .font(.system(size: 7 * scale))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            if showProfessor, !cls.professor.isEmpty {
                Text(cls.professor).font(.system(size: 7 * scale)).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(fg)
        .padding(.horizontal, 3)
        .padding(.vertical, 2)
        .frame(width: width, height: height, alignment: .topLeading)
        .background(WidgetPalette.color(cls.colorIndex))
    }

    /// 수업이 걸쳐 있는 시간대만 그린다 (없으면 9~18시)
    private func hourRange(_ classes: [SharedTimetablePayload.SharedClass]) -> Range<Int> {
        guard !classes.isEmpty,
              let lo = classes.map(\.startHour).min(),
              let hi = classes.map({ $0.startHour + max(1, $0.durationHours) }).max(),
              lo < hi else { return 9..<18 }
        return lo..<hi
    }
}

// MARK: - Widgets

struct TimetableWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "DictlyTimetable", provider: TimetableProvider()) { entry in
            TimetableGridView(entry: entry)
        }
        .configurationDisplayName("주간 시간표")
        .description("월~금 수업을 시간표 형태로 보여줍니다.")
        .supportedFamilies([.systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}

struct NextClassWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "DictlyNextClass", provider: TimetableProvider()) { entry in
            NextClassView(entry: entry)
        }
        .configurationDisplayName("다음 수업")
        .description("오늘 남은 다음 수업을 보여줍니다.")
        .supportedFamilies([.systemSmall])
    }
}

@main
struct DictlyWidgetBundle: WidgetBundle {
    var body: some Widget {
        TimetableWidget()
        NextClassWidget()
        RecordingLiveActivity()
    }
}
