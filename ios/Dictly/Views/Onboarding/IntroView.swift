import SwiftUI
import AVFoundation

/// 첫 실행 워크스루 — 주요 기능을 실제 화면 캡처와 큰 글씨로 소개한다.
/// 마지막 "시작하기"에서 onFinish 가 불리고, 이어서 모델 다운로드 동의 시트로 연결된다.
struct IntroView: View {
    let onFinish: () -> Void
    @State private var page: Int = {
        #if DEBUG
        // 캡처 검증용 — 시작 페이지를 환경변수로 지정할 수 있다
        if let raw = ProcessInfo.processInfo.environment["DICTLY_INTRO_PAGE"], let n = Int(raw) { return n }
        #endif
        return 0
    }()

    private struct Feature: Identifiable {
        let id = UUID()
        let icon: String
        let tint: Color
        let title: String
        let body: String
    }

    fileprivate enum Media {
        case image(String)
        /// 번들 mp4 (무음·자동 반복). poster 는 로딩 전 잠깐 비치는 캡처
        case video(name: String, poster: String?)
    }

    private struct Page {
        let title: String
        let subtitle: String
        let image: String?
        let features: [Feature]
        /// 좌우로 넘겨 보는 캡처·영상 모음 (한 개면 그냥 한 장짜리)
        var media: [Media] = []
    }

    private static let pages: [Page] = [
        Page(title: "무료·무제한\n로컬 전사",
             subtitle: "전사가 전부 아이폰 안에서 돌아가요.\n서버도, 요금도, 인터넷도 필요 없어요.",
             image: nil,
             features: [
                Feature(icon: "square.stack.3d.up.fill", tint: .orange,
                        title: "모델을 취향대로", body: "가벼운 Small부터 정확한 Turbo+까지 직접 골라 써요"),
                Feature(icon: "bolt.fill", tint: .yellow,
                        title: "Whisper Live (beta)", body: "말하는 순간 글자가 따라오는 실시간 로컬 전사"),
                Feature(icon: "key.fill", tint: .blue,
                        title: "GPT Transcribe Live", body: "API 키를 연결하면 GPT 실시간 전사 모델도 쓸 수 있어요")
             ]),
        Page(title: "녹음하면\n바로 글이 돼요",
             subtitle: "강의를 틀어놓기만 하세요. 말하는 동안\n실시간으로 글자가 흐르고, 곧바로 문단이 완성돼요.",
             image: nil, features: [],
             media: [.video(name: "OnbTranscribe", poster: nil)]),
        Page(title: "받아쓰면서\nAI가 다듬어요",
             subtitle: "잘못 들은 용어와 어색한 문장을 녹음 중에 실시간으로 고쳐요. 표시된 부분은 원문과 비교할 수 있어요.",
             image: "IntroCorrect", features: []),
        Page(title: "탭하면 그 순간부터\n다시 들려요",
             subtitle: "문단마다 녹음 시간이 붙어요.\n나중에 문단을 탭하면 그 대목부터 재생돼요.",
             image: nil, features: [],
             media: [.video(name: "OnbPlayback", poster: nil)]),
        Page(title: "과목마다\n에이전트를 만들어요",
             subtitle: "용어 사전과 수식 규칙을 직접 등록하면\n실시간 교정이 그 과목 표기를 우선 사용해요.",
             image: nil, features: [],
             media: [.image("IntroAgentList"), .image("IntroAgentDetail")]),
        Page(title: "노트 하나가\n공부 자료 세트가 돼요",
             subtitle: "요약·퀴즈·플래시카드·시험 레이더·파인만 복습까지\n스튜디오에서 한 번에 만들어요. 좌우로 넘겨 보세요.",
             image: nil, features: [],
             media: [
                .video(name: "OnbFlashcards", poster: "IntroStudioFlash"),
                .image("IntroStudioSummary"),
                .image("IntroStudioQuiz"),
                .image("IntroStudioRadar"),
                .image("IntroStudioFeynman")
             ]),
        Page(title: "노트에게\n물어보세요",
             subtitle: "AI가 노트 내용을 근거로 답하고,\n출처 칩을 누르면 그 대목을 바로 들려줘요.",
             image: "IntroChat", features: []),
        Page(title: "시간표에서\n바로 녹음",
             subtitle: "수업 시간표를 등록하면 수업 시작에 맞춰 알려주고,\n한 번에 그 과목 폴더로 녹음돼요.",
             image: "IntroTimetable", features: []),
        Page(title: "AI 기능은\n취향대로",
             subtitle: "교정·스튜디오·채팅은 설정에서\nAPI 키를 연결해 쓰세요.",
             image: nil,
             features: [
                Feature(icon: "key.fill", tint: .blue,
                        title: "API 연결", body: "설정 → API 프로바이더에서 Claude·GPT·Gemini 키를 붙여넣기만 하면 끝"),
                Feature(icon: "sparkles", tint: .purple,
                        title: "Apple Intelligence", body: "iOS 26 이상 지원 기기에서는 API 없이 로컬 AI 모델로도 돌아가요")
             ])
    ]

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 0) {
                HStack {
                    Spacer()
                    if page < Self.pages.count - 1 {
                        Button("건너뛰기") { onFinish() }
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.white.opacity(0.5))
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 14)
                .frame(height: 44)

                TabView(selection: $page) {
                    ForEach(Array(Self.pages.enumerated()), id: \.offset) { idx, p in
                        pageView(p).tag(idx)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .animation(.smooth(duration: 0.3), value: page)

                VStack(spacing: 18) {
                    HStack(spacing: 7) {
                        ForEach(0..<Self.pages.count, id: \.self) { idx in
                            Capsule()
                                .fill(.white.opacity(idx == page ? 0.95 : 0.25))
                                .frame(width: idx == page ? 22 : 7, height: 7)
                        }
                    }
                    .animation(.spring(duration: 0.35), value: page)

                    Button {
                        if page < Self.pages.count - 1 {
                            withAnimation(.smooth(duration: 0.3)) { page += 1 }
                        } else {
                            onFinish()
                        }
                    } label: {
                        Text(page < Self.pages.count - 1 ? "다음" : "시작하기")
                            .font(.headline)
                            .foregroundStyle(.black)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(.white, in: RoundedRectangle(cornerRadius: 18))
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 24)
                }
                .padding(.bottom, 16)
            }
        }
        .environment(\.colorScheme, .dark)
        .interactiveDismissDisabled(true)
    }

    @ViewBuilder
    private func pageView(_ p: Page) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(p.title)
                .font(.system(size: 34, weight: .heavy))
                .foregroundStyle(.white)
                .lineSpacing(4)
                .padding(.top, 8)
            Text(p.subtitle)
                .font(.system(size: 16))
                .foregroundStyle(.white.opacity(0.65))
                .lineSpacing(4)
                .padding(.top, 12)

            if !p.media.isEmpty {
                Spacer(minLength: 16)
                IntroMediaCarousel(items: p.media) {
                    // 마지막 항목에서 더 당기면 다음 온보딩 페이지로
                    if page < Self.pages.count - 1 {
                        withAnimation(.smooth(duration: 0.3)) { page += 1 }
                    }
                }
                // 페이지 좌우 패딩을 상쇄해 캐러셀은 화면 전체 폭을 쓴다
                .padding(.horizontal, -24)
                .frame(maxHeight: 470)
                Spacer(minLength: 8)
            } else if let name = p.image, let ui = UIImage(named: name) {
                Spacer(minLength: 16)
                // 캡처가 세로로 길어서 폭 기준으로 맞추면 페이지를 넘친다 — 높이를 상한으로 잡는다
                HStack {
                    Spacer(minLength: 0)
                    Image(uiImage: ui)
                        .resizable()
                        .scaledToFit()
                        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 24, style: .continuous)
                                .strokeBorder(.white.opacity(0.15), lineWidth: 1)
                        )
                        .shadow(color: .black.opacity(0.55), radius: 22, y: 8)
                    Spacer(minLength: 0)
                }
                .frame(maxHeight: 470)
                Spacer(minLength: 8)
            } else if !p.features.isEmpty {
                VStack(spacing: 14) {
                    ForEach(p.features) { f in
                        HStack(spacing: 14) {
                            Image(systemName: f.icon)
                                .font(.title3)
                                .foregroundStyle(f.tint)
                                .frame(width: 44, height: 44)
                                .background(f.tint.opacity(0.15), in: RoundedRectangle(cornerRadius: 13))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(f.title)
                                    .font(.subheadline.weight(.bold))
                                    .foregroundStyle(.white)
                                Text(f.body)
                                    .font(.footnote)
                                    .foregroundStyle(.white.opacity(0.6))
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(14)
                        .background(.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 18))
                    }
                }
                .padding(.top, 28)
                Spacer()
            } else {
                Spacer()
            }
        }
        .padding(.horizontal, 24)
    }
}




/// 좌우로 넘겨 보는 캡처·영상 캐러셀 — 중앙 스냅, 이전·다음 항목이 양옆에 걸쳐 보인다.
/// 도트는 두지 않는다(온보딩 페이지 도트와 겹침). 마지막 항목에서 더 당기면 onOverscrollEnd.
private struct IntroMediaCarousel: View {
    let items: [IntroView.Media]
    let onOverscrollEnd: () -> Void
    @State private var overscrollFired = false

    /// 캡처(920×1870) 기준 세로형 비율 — 항목 프레임 폭 계산용
    private let itemAspect: CGFloat = 920.0 / 1870.0

    init(items: [IntroView.Media], onOverscrollEnd: @escaping () -> Void = {}) {
        self.items = items
        self.onOverscrollEnd = onOverscrollEnd
    }

    var body: some View {
        GeometryReader { geo in
            let itemWidth = min(geo.size.height * itemAspect, geo.size.width * 0.72)
            let sideMargin = max(16, (geo.size.width - itemWidth) / 2)
            if items.count == 1 {
                HStack {
                    Spacer(minLength: 0)
                    mediaView(items[0])
                        .frame(width: itemWidth, height: geo.size.height)
                    Spacer(minLength: 0)
                }
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 12) {
                        ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                            mediaView(item)
                                .frame(width: itemWidth, height: geo.size.height)
                        }
                    }
                    .scrollTargetLayout()
                }
                // 좌우 여백 = (화면-항목)/2 → 스냅 시 항목이 정중앙, 이웃이 양옆에 걸친다
                .contentMargins(.horizontal, sideMargin, for: .scrollContent)
                .scrollTargetBehavior(.viewAligned)
                .onScrollGeometryChange(for: CGFloat.self) { g in
                    // 마지막 항목을 넘어서 당긴 거리 (0 이하 = 아직 끝 아님)
                    let maxX = g.contentSize.width - g.containerSize.width + g.contentInsets.trailing
                    return g.contentOffset.x - maxX
                } action: { _, over in
                    if over > 48, !overscrollFired {
                        overscrollFired = true
                        onOverscrollEnd()
                    } else if over < 8 {
                        overscrollFired = false
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func mediaView(_ item: IntroView.Media) -> some View {
        Group {
            switch item {
            case .image(let name):
                if let ui = UIImage(named: name) {
                    Image(uiImage: ui).resizable().scaledToFit()
                }
            case .video(let name, let poster):
                ZStack {
                    if let poster, let ui = UIImage(named: poster) {
                        Image(uiImage: ui).resizable().scaledToFill()
                    }
                    LoopingVideo(resource: name)
                }
                // 크롭·스케일된 영상 산출물의 실제 비율 (640×1306)
                .aspectRatio(640.0 / 1306.0, contentMode: .fit)
                .clipped()
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(.white.opacity(0.15), lineWidth: 1)
        )
    }
}

/// 번들 mp4 무음 반복 재생 — 온보딩 시연용
private struct LoopingVideo: UIViewRepresentable {
    let resource: String

    func makeUIView(context: Context) -> PlayerView {
        let view = PlayerView()
        if let url = Bundle.main.url(forResource: resource, withExtension: "mp4") {
            view.configure(url: url)
        }
        return view
    }

    func updateUIView(_ uiView: PlayerView, context: Context) {}

    final class PlayerView: UIView {
        override static var layerClass: AnyClass { AVPlayerLayer.self }
        private let player = AVQueuePlayer()
        private var looper: AVPlayerLooper?

        func configure(url: URL) {
            looper = AVPlayerLooper(player: player, templateItem: AVPlayerItem(url: url))
            player.isMuted = true
            // 무음 시연 영상이 음악 등 다른 앱 오디오를 끊지 않게 한다
            player.preventsDisplaySleepDuringVideoPlayback = false
            let playerLayer = layer as! AVPlayerLayer
            playerLayer.player = player
            playerLayer.videoGravity = .resizeAspect
            player.play()
        }
    }
}
