import ActivityKit
import Foundation

/// 녹음 Live Activity 속성 — **앱 타깃과 위젯 타깃이 이 파일 하나를 함께 컴파일한다.**
/// (복제해서 각 타깃에 두면 Activity.request 는 성공하는데 위젯이 화면을 못 그린다)
struct RecordingActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// 경과 시간 타이머의 기준 시각 — 텍스트가 스스로 흐르므로 잦은 갱신이 필요 없다
        var startedAt: Date
        /// 일시정지 중에 고정 표시할 경과 시간
        var elapsed: Double
        var isPaused: Bool
        /// 자동 생성된 제목 (아직 없으면 폴더명, 그것도 없으면 빈 값)
        var title: String
        /// 가장 최근 전사 (확정 청크 또는 실시간 미리보기)
        var latestLine: String
        /// 최근 입력 레벨(0~1) — 파형 막대 높이
        var levels: [Float]
    }

    var folderName: String
}
