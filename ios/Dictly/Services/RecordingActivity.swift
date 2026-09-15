import ActivityKit
import Foundation
import os

/// 녹음 종료 딥링크 — Live Activity 의 종료 버튼이 이 URL 을 연다
enum RecordingDeepLink {
    static let stop = URL(string: "dictly://stop")!
}

/// Live Activity 수명주기 — 녹음 시작/일시정지/전사 갱신/종료에 맞춰 호출한다
@MainActor
enum RecordingActivityController {
    private static var activity: Activity<RecordingActivityAttributes>?
    private static var lastUpdate = Date.distantPast
    /// ActivityKit 은 갱신 예산이 있어 너무 잦으면 표시가 아예 끊긴다.
    /// 0.5초로 낮췄다가 Live Activity 가 사라지는 회귀가 있었어서 1초로 되돌렸다.
    private static let minInterval: TimeInterval = 1.0

    private static let log = Logger(subsystem: "com.leehyunwoo.dictly", category: "LiveActivity")

    /// 시작에 실패한 이유 — 조용히 사라지지 않도록 화면에서 확인할 수 있게 남긴다
    private(set) static var lastError: String?

    static func start(folderName: String, startedAt: Date) {
        lastError = nil
        guard activity == nil else { return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            lastError = "설정에서 라이브 액티비티가 꺼져 있습니다"
            log.error("live activity disabled in settings")
            return
        }
        let state = RecordingActivityAttributes.ContentState(
            startedAt: startedAt,
            elapsed: 0,
            isPaused: false,
            title: folderName,
            latestLine: "",
            levels: []
        )
        do {
            activity = try Activity.request(
                attributes: RecordingActivityAttributes(folderName: folderName),
                content: .init(state: state, staleDate: nil)
            )
            log.info("live activity started")
        } catch {
            lastError = "라이브 액티비티 시작 실패 — \(error.localizedDescription)"
            log.error("live activity request failed: \(String(describing: error))")
        }
        lastUpdate = .now
    }

    static func update(elapsed: Double, isPaused: Bool, title: String,
                       latestLine: String, levels: [Float], force: Bool = false) {
        guard let activity else { return }
        guard force || Date.now.timeIntervalSince(lastUpdate) >= minInterval else { return }
        lastUpdate = .now
        let state = RecordingActivityAttributes.ContentState(
            startedAt: activity.content.state.startedAt,
            elapsed: elapsed,
            isPaused: isPaused,
            title: title,
            latestLine: latestLine,
            levels: levels
        )
        Task { await activity.update(.init(state: state, staleDate: nil)) }
    }

    static func end() {
        guard let activity else { return }
        self.activity = nil
        lastUpdate = .distantPast
        Task { await activity.end(nil, dismissalPolicy: .immediate) }
    }
}
