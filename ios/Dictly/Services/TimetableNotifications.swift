import Foundation
import UserNotifications

/// 시간표 수업 시작 전 로컬 알림 — 알림을 누르면 과목명 폴더로 바로 녹음을 시작한다
enum TimetableNotifications {
    /// 수업 알림 식별자 접두사. 다른 알림을 건드리지 않고 이것만 갈아끼운다
    private static let idPrefix = "class-"
    /// 알림 탭 → 녹음 시작에 쓰는 폴더 이름 키
    static let folderKey = "folder"

    @discardableResult
    static func requestAuthorization() async -> Bool {
        #if DEBUG
        // 캡처 모드에서는 권한 팝업이 화면을 가리므로 요청하지 않는다
        if ProcessInfo.processInfo.environment["DICTLY_CAPTURE"] != nil { return false }
        #endif
        return (try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .sound])) ?? false
    }

    /// iOS 는 앱당 대기 알림을 64개까지만 유지하므로 여유를 두고 자른다
    private static let maxRequests = 56
    /// 학기 종료일이 멀어도 이 기간까지만 미리 깔고, 앱을 열 때마다 다시 채운다
    private static let horizonDays = 28

    /// 현재 학기 시간표 기준으로 알림을 다시 깐다.
    /// 학기 시작·종료일이 있으면 그 기간의 실제 날짜에만 예약한다 (주간 반복으로는 기간 제한이 안 된다)
    @MainActor
    static func reschedule(classes: [TimetableClass], leadMinutes: Int, enabled: Bool,
                           startDate: Date?, endDate: Date?) async {
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests()
        center.removePendingNotificationRequests(
            withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix(idPrefix) }
        )

        // 폴더 생성 여부와 무관하게 모든 수업에 알림을 보낸다
        let targets = classes
        guard enabled, !targets.isEmpty else { return }
        guard await requestAuthorization() else { return }

        let calendar = Calendar.current
        let now = Date()
        let from = max(now, startDate ?? now)
        let horizon = calendar.date(byAdding: .day, value: horizonDays, to: now) ?? now
        let until = min(endDate ?? horizon, horizon)
        guard until >= from else { return }

        var added = 0
        for cls in targets {
            let fireMinutes = cls.startHour * 60 - leadMinutes
            guard fireMinutes >= 0, (0..<5).contains(cls.weekday) else { continue }

            var when = DateComponents()
            when.weekday = cls.weekday + 2      // 0 = 월 → Calendar 의 2 = 월요일
            when.hour = fireMinutes / 60
            when.minute = fireMinutes % 60

            // 기간 안의 해당 요일·시각을 하나씩 예약한다
            var cursor = from
            while added < maxRequests,
                  let next = calendar.nextDate(after: cursor, matching: when,
                                               matchingPolicy: .nextTime),
                  next <= until {
                let content = UNMutableNotificationContent()
                content.title = cls.title
                var detail: [String] = []
                if !cls.room.isEmpty { detail.append(cls.room) }
                detail.append(leadMinutes > 0 ? "\(leadMinutes)분 후 시작" : "지금 시작")
                content.body = detail.joined(separator: " · ")
                content.sound = .default
                content.userInfo = [folderKey: cls.title]

                let stamp = Int(next.timeIntervalSince1970)
                let request = UNNotificationRequest(
                    identifier: "\(idPrefix)\(cls.weekday)-\(cls.startHour)-\(stamp)",
                    content: content,
                    trigger: UNCalendarNotificationTrigger(
                        dateMatching: calendar.dateComponents(
                            [.year, .month, .day, .hour, .minute], from: next),
                        repeats: false
                    )
                )
                try? await center.add(request)
                added += 1
                cursor = next
            }
        }
    }
}

/// 알림 탭을 앱 상태로 넘겨주는 델리게이트
@MainActor
final class NotificationCoordinator: NSObject, UNUserNotificationCenterDelegate {
    var onOpenFolder: ((String) -> Void)?

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let info = response.notification.request.content.userInfo
        guard let folder = info[TimetableNotifications.folderKey] as? String else { return }
        await MainActor.run { self.onOpenFolder?(folder) }
    }

    /// 앱을 쓰는 중에도 배너를 띄운다
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}
