import ActivityKit
import SwiftUI
import WidgetKit

/// 녹음 중 잠금화면 배너 + 다이나믹 아일랜드.
/// 레이아웃은 의도적으로 단순하게 둔다 — 고정 프레임/자체 배경/좁은 영역의 긴 텍스트를
/// 넣었더니 시스템이 콘텐츠를 통째로 그리지 못하는 문제가 있었다.
struct RecordingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
            lockScreen(context.state)
                .activityBackgroundTint(.black)
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                // 좁은 leading/trailing 에는 짧은 것만 — 긴 텍스트는 잘린다.
                // 카메라 주변으로 콘텐츠가 물리지 않게 여백을 직접 준다
                // 좌우 글꼴 크기를 맞춰야 같은 줄에 놓인 것처럼 정렬돼 보인다
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 6) {
                        statusDot(context.state)
                        Text(headline(context.state))
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.white)
                            .lineLimit(1)
                            .animation(nil, value: headline(context.state))
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                    .padding(.leading, 6)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    timeText(context.state)
                        .font(.subheadline.monospacedDigit().weight(.semibold))
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
                        .padding(.trailing, 6)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(alignment: .center, spacing: 12) {
                        VStack(alignment: .leading, spacing: 6) {
                            waveform(context.state, maxHeight: 20, count: 16)
                            Text(transcriptText(context.state))
                                .font(.subheadline)
                                .foregroundStyle(.white.opacity(0.75))
                                .lineLimit(2, reservesSpace: true)
                                // 갱신마다 텍스트가 바뀌면 잘린 끝부분이 움찔거린다 — 애니메이션 끔
                                .contentTransition(.identity)
                                .animation(nil, value: transcriptText(context.state))
                        }
                        Spacer(minLength: 0)
                        stopButton
                    }
                    .padding(.horizontal, 6)
                    .padding(.top, 4)
                }
            } compactLeading: {
                // 축소 상태는 점 하나만 — 알약 길이는 leading/trailing 콘텐츠 폭으로 정해지므로
                // 점을 작게 두고 안쪽(오른쪽)으로 당겨 전체 폭을 줄인다
                statusDot(context.state)
                    .padding(.leading, 3)
            } compactTrailing: {
                timeText(context.state)
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.red)
            } minimal: {
                statusDot(context.state)
            }
            .keylineTint(.red)
        }
    }

    // MARK: 잠금화면

    private func lockScreen(_ state: RecordingActivityAttributes.ContentState) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(headline(state))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .lineLimit(1)

            // reservesSpace 로 항상 3줄 자리를 차지한다 — 전사가 들어와도 높이가 안 변한다.
            // 컨테이너에 고정 frame 을 걸면 표시 자체가 깨졌던 적이 있어 이 방식을 쓴다
            Text(transcriptText(state))
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.75))
                .lineLimit(3, reservesSpace: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentTransition(.identity)
                .animation(nil, value: transcriptText(state))

            // 시간은 종료 버튼 바로 왼쪽에 붙인다 — 남는 폭은 앞의 Spacer 가 흡수
            HStack(alignment: .center, spacing: 0) {
                waveform(state, maxHeight: 30, count: 42)
                Spacer(minLength: 6)
                timeText(state)
                    .font(.title3.monospacedDigit().weight(.medium))
                    .foregroundStyle(.red)
                    .padding(.trailing, 10)
                stopButton
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: 부품

    /// 흰 테두리 원 안의 빨간 정지 사각형.
    /// AppIntents 대신 딥링크 — 인텐트 타입을 두 모듈에 복제하면 매칭이 깨진다
    private var stopButton: some View {
        Link(destination: URL(string: "dictly://stop")!) {
            ZStack {
                Circle()
                    .strokeBorder(Color.white, lineWidth: 3)
                    .frame(width: 38, height: 38)
                RoundedRectangle(cornerRadius: 5)
                    .fill(Color.red)
                    .frame(width: 16, height: 16)
            }
        }
    }

    /// 축소 상태 표시 — 녹음 중이면 빨간 점, 일시정지면 흐린 점
    private func statusDot(_ state: RecordingActivityAttributes.ContentState) -> some View {
        Circle()
            .fill(state.isPaused ? Color.white.opacity(0.4) : Color.red)
            .frame(width: 8, height: 8)
    }

    /// 실제 입력 레벨로 그리는 파형 — 상태가 갱신될 때마다 막대가 새 값으로 흐른다
    private func waveform(_ state: RecordingActivityAttributes.ContentState,
                          maxHeight: CGFloat, count: Int) -> some View {
        let samples = bars(from: state.levels, count: count)
        return HStack(alignment: .center, spacing: 2.5) {
            ForEach(Array(samples.enumerated()), id: \.offset) { _, value in
                Capsule()
                    .fill(state.isPaused ? Color.white.opacity(0.3) : Color.red)
                    .frame(width: 3, height: Swift.max(3, maxHeight * CGFloat(value)))
            }
        }
        // 갱신 주기(1초)에 맞춰 보간해야 끊김 없이 흐른다.
        // 짧게 주면 0.3초 움직이고 0.7초 멈춰 있어 작은 막대가 움찔거린다
        .animation(.linear(duration: 1.0), value: samples)
    }

    /// 최근 레벨을 막대 개수에 맞춰 자르고, 모자라면 앞을 낮은 값으로 채운다
    private func bars(from levels: [Float], count: Int) -> [Float] {
        let floor: Float = 0.12
        var out = levels.suffix(count).map { Swift.min(1, Swift.max(floor, $0)) }
        if out.count < count {
            out = Array(repeating: floor, count: count - out.count) + out
        }
        return out
    }

    /// Text(timerInterval:) 은 구간 내 **최대값의 폭**을 미리 확보한다.
    /// 24시간 구간이면 "23:59:59" 만큼 자리를 잡아 컴팩트 알약이 불필요하게 넓어지고
    /// 오른쪽 정렬도 어긋난다. 어차피 파형 때문에 1초마다 갱신하므로 정적 텍스트를 쓴다.
    private func timeText(_ state: RecordingActivityAttributes.ContentState) -> some View {
        Text(clock(state.elapsed))
            // 1초마다 바뀌므로 애니메이션을 끄지 않으면 숫자가 미세하게 떤다
            .contentTransition(.identity)
            .animation(nil, value: state.elapsed)
    }

    private func transcriptText(_ state: RecordingActivityAttributes.ContentState) -> String {
        state.latestLine.isEmpty ? "듣는 중…" : state.latestLine
    }

    private func headline(_ state: RecordingActivityAttributes.ContentState) -> String {
        if state.isPaused { return "일시정지됨" }
        return state.title.isEmpty ? "녹음 중" : state.title
    }

    private func clock(_ sec: Double) -> String {
        let total = Int(sec)
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        return h > 0
            ? String(format: "%d:%02d:%02d", h, m, s)
            : String(format: "%d:%02d", m, s)
    }
}
