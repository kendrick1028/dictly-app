import Foundation
import Security
import WidgetKit

/// 위젯과 공유하는 시간표 페이로드 — App Group 대신 키체인 공유 그룹으로 전달
/// (프로비저닝의 keychain-access-groups: 676C73FL9J.* 를 활용)
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
    /// "system" | "white" | "black" | "clear"
    var background: String
    /// 구분선 색 팔레트 인덱스 (-1 = 기본)
    var dividerIndex: Int
    /// 수업 블록 글자색 (-1 = 흰색, -2 = 검은색, 0 이상 = 팔레트 인덱스)
    var textIndex: Int
    /// 위젯 글자 크기 배율 (1.0 = 기본)
    var fontScale: Double
}

enum TimetableSync {
    static let accessGroup = "676C73FL9J.com.leehyunwoo.dictly"
    static let account = "sharedTimetable"

    @MainActor
    static func push(classes: [TimetableClass], settings: AppSettings) {
        let payload = SharedTimetablePayload(
            classes: classes.map {
                .init(title: $0.title, room: $0.room, professor: $0.professor,
                      weekday: $0.weekday, startHour: $0.startHour,
                      durationHours: $0.durationHours, colorIndex: $0.colorIndex)
            },
            background: settings.widgetBackground,
            dividerIndex: settings.widgetDividerIndex,
            textIndex: settings.timetableTextIndex,
            fontScale: settings.widgetFontScale
        )
        guard let data = try? JSONEncoder().encode(payload) else { return }
        write(data)
        WidgetCenter.shared.reloadAllTimelines()
    }

    private static func write(_ data: Data) {
        // 공유 그룹 우선, 실패(시뮬레이터 등) 시 기본 키체인
        if !write(data, group: accessGroup) {
            _ = write(data, group: nil)
        }
    }

    private static func write(_ data: Data, group: String?) -> Bool {
        var deleteQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.leehyunwoo.dictly.shared",
            kSecAttrAccount as String: account
        ]
        if let group { deleteQuery[kSecAttrAccessGroup as String] = group }
        SecItemDelete(deleteQuery as CFDictionary)

        var addQuery = deleteQuery
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(addQuery as CFDictionary, nil) == errSecSuccess
    }
}
