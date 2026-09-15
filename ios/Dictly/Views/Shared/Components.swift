import SwiftUI

/// animated input-level bars shown while recording
struct LevelMeter: View {
    let level: Float
    @State private var history: [Float] = Array(repeating: 0, count: 28)

    var body: some View {
        HStack(alignment: .center, spacing: 3) {
            ForEach(Array(history.enumerated()), id: \.offset) { _, v in
                Capsule()
                    .fill(Color.primary.opacity(0.85))
                    .frame(width: 3, height: 4 + CGFloat(v) * 30)
            }
        }
        .frame(height: 36)
        .onChange(of: level) { _, newValue in
            history.removeFirst()
            history.append(newValue)
        }
        .animation(.linear(duration: 0.1), value: history)
    }
}

/// small status capsule (엔진 표시 등)
struct StatusChip: View {
    var icon: String
    var text: String
    var tint: Color = .secondary

    var body: some View {
        Label(text, systemImage: icon)
            .font(.caption)
            .foregroundStyle(tint)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(tint.opacity(0.12), in: Capsule())
    }
}

struct EmptyStateView: View {
    var icon: String
    var title: String
    var message: String

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: icon)
        } description: {
            Text(message)
        }
    }
}

/// text shimmer for in-progress states (교정 중 청크) — a highlight band sweeps
/// across dimmed text, ported from the reference web shimmer effect
struct ShimmerEffect: ViewModifier {
    @State private var phase: CGFloat = -0.7

    func body(content: Content) -> some View {
        content
            .opacity(0.45)
            .overlay {
                content
                    .mask(
                        GeometryReader { geo in
                            LinearGradient(
                                gradient: Gradient(stops: [
                                    .init(color: .clear, location: 0),
                                    .init(color: .black, location: 0.4),
                                    .init(color: .black, location: 0.6),
                                    .init(color: .clear, location: 1)
                                ]),
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                            .frame(width: geo.size.width * 0.7)
                            .offset(x: geo.size.width * phase)
                        }
                    )
            }
            .onAppear {
                withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) {
                    phase = 1.0
                }
            }
    }
}

/// 스크롤 방향으로 하단 글라스 패널을 접을지 판단하는 데 필요한 최소 정보.
/// 맨 위·맨 아래의 바운스(고무줄) 구간은 방향이 뒤집힌 델타를 내보내기 때문에,
/// 오프셋이 실제 스크롤 가능 범위 안에 있을 때만 방향을 신뢰한다
struct ScrollProbe: Equatable {
    var offset: CGFloat
    var minOffset: CGFloat
    var maxOffset: CGFloat

    init(_ geo: ScrollGeometry) {
        offset = geo.contentOffset.y
        minOffset = -geo.contentInsets.top
        maxOffset = max(-geo.contentInsets.top,
                        geo.contentSize.height + geo.contentInsets.bottom - geo.containerSize.height)
    }

    /// true = 접기, false = 펼치기, nil = 무시 (미세 이동이거나 바운스 구간)
    func minimizeIntent(from old: ScrollProbe) -> Bool? {
        let delta = offset - old.offset
        guard abs(delta) > 2 else { return nil }
        let edge: CGFloat = 1
        guard offset > minOffset + edge, offset < maxOffset - edge else { return nil }
        return delta > 0
    }
}

extension View {
    @ViewBuilder
    func shimmering(_ active: Bool) -> some View {
        if active {
            modifier(ShimmerEffect())
        } else {
            self
        }
    }
}

extension Double {
    /// 3672.4 → "1:01:12" / 75 → "1:15"
    var timeString: String {
        let total = Int(self)
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }
}

extension Date {
    var shortString: String {
        let df = DateFormatter()
        df.locale = Locale(identifier: "ko_KR")
        df.dateFormat = "M월 d일 (E) HH:mm"
        return df.string(from: self)
    }
}
