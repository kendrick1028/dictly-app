import SwiftUI
import SwiftData
import AVFoundation
import Observation

/// audio playback controller for a memo take
@MainActor
@Observable
final class PlayerController: NSObject, AVAudioPlayerDelegate {
    private var player: AVAudioPlayer?
    private var ticker: Task<Void, Never>?
    private(set) var isPlaying = false
    var position: Double = 0
    private(set) var duration: Double = 0
    /// 0~1 — 재생 중에도 즉시 반영
    var volume: Double = 1.0 {
        didSet { player?.volume = Float(volume) }
    }

    func load(url: URL) {
        guard player == nil else { return }
        player = try? AVAudioPlayer(contentsOf: url)
        player?.delegate = self
        player?.volume = Float(volume)
        duration = player?.duration ?? 0
    }

    func toggle() {
        guard let player else { return }
        if isPlaying {
            player.pause()
            isPlaying = false
            ticker?.cancel()
        } else {
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
            try? AVAudioSession.sharedInstance().setActive(true)
            player.play()
            isPlaying = true
            ticker = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: .milliseconds(200))
                    guard let self, let p = self.player else { return }
                    self.position = p.currentTime
                }
            }
        }
    }

    func seek(to sec: Double, autoplay: Bool = true) {
        guard let player else { return }
        player.currentTime = max(0, min(sec, max(0, player.duration - 0.2)))
        position = player.currentTime
        if autoplay, !isPlaying { toggle() }
    }

    func skip(_ delta: Double) {
        guard let player else { return }
        player.currentTime = max(0, min(player.currentTime + delta, player.duration))
        position = player.currentTime
    }

    func stopAndUnload() {
        ticker?.cancel()
        player?.stop()
        player = nil
        isPlaying = false
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            self.isPlaying = false
            self.position = 0
            self.ticker?.cancel()
        }
    }
}

/// Apple Music 가사 화면 스타일의 전사문 재생 뷰.
/// 라이트 모드에서도 회색(#817E7E) 그라데이션 + 흰 텍스트를 쓰므로 콘텐츠 전체를
/// 다크 컬러스킴으로 강제해 시스템 색(.primary/.secondary)이 흰색 계열로 풀리게 한다.
struct MemoDetailView: View {
    @Bindable var memo: Memo
    @Environment(\.modelContext) private var context
    @Environment(AIService.self) private var ai
    @Environment(AppState.self) private var appState
    @Environment(AppSettings.self) private var settings
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var systemScheme

    @State private var player = PlayerController()
    @State private var showOriginal = false
    @State private var showRename = false
    @State private var renameText = ""
    @State private var correcting = false
    @State private var correctProgress = 0.0
    /// 전체 교정 중 지금 처리하는 문단 — 실시간 교정과 같은 shimmer 를 준다
    @State private var correctingIndex: Int? = nil
    @State private var errorMessage: String?
    @State private var centeredSegmentID: UUID?
    /// 상단 탭: 0 전사문 · 1 스튜디오(생성) · 2 항목
    @State private var tab = 0

    // 컨트롤 자동 숨김 (5초 재생 또는 아래로 스크롤 → 숨김, 위로 스크롤/터치 → 표시)
    @State private var controlsVisible = true
    @State private var hideTask: Task<Void, Never>?
    @State private var userIsScrolling = false

    /// 강조/스크롤에 함께 쓰는 하나의 스프링 — 숫자·본문이 따로 놀지 않게 한다
    private let rowAnim: Animation = .spring(duration: 0.45, bounce: 0.25)

    /// segment currently under the playhead
    private var playingSegmentID: UUID? {
        guard player.isPlaying else { return nil }
        return memo.segments.last(where: { $0.tStart <= player.position + 0.05 })?.id
    }

    // MARK: 페이지 배경 (라이트: #817E7E 계열 그라데이션 / 다크: 검정)

    private var bgTop: Color {
        systemScheme == .light ? Color(.sRGB, red: 0.545, green: 0.533, blue: 0.533) : .black
    }
    private var bgBottom: Color {
        systemScheme == .light ? Color(.sRGB, red: 0.43, green: 0.42, blue: 0.42) : .black
    }

    var body: some View {
        VStack(spacing: 0) {
            // 고정 상단 영역: 교정본|원문 토글 + 그 아래 날짜·시간 (스크롤되지 않음)
            VStack(alignment: .leading, spacing: 10) {
                // 노트 안에서 바로 스튜디오 생성·항목 열람까지 — 교정본/원문 전환은 옵션 메뉴로 이동
                Picker("페이지", selection: $tab) {
                    Text("전사문").tag(0)
                    Text("스튜디오").tag(1)
                    Text("항목").tag(2)
                }
                .pickerStyle(.segmented)
                header
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)
            .padding(.bottom, 6)

            ZStack {
                transcriptPane
                    .opacity(tab == 0 ? 1 : 0)
                    .allowsHitTesting(tab == 0)
                MemoStudioPane(memo: memo, page: $tab)
                    .opacity(tab == 0 ? 0 : 1)
                    .allowsHitTesting(tab != 0)
            }
        }
        .background {
            LinearGradient(colors: [bgTop, bgBottom], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
        }
        .modifier(MemoDetailChrome(memo: memo, player: player, tab: $tab,
                                   showOriginal: $showOriginal, showRename: $showRename,
                                   renameText: $renameText, correcting: correcting,
                                   errorMessage: $errorMessage,
                                   correctAll: { Task { await correctAll() } },
                                   exportMarkdown: exportMarkdown,
                                   revealControls: revealControls))
        .onAppear {
            if let url = memo.audioURL { player.load(url: url) }
        }
        .onChange(of: player.isPlaying) { _, playing in
            if playing { scheduleAutoHide() } else { revealControls() }
        }
        .onDisappear {
            hideTask?.cancel()
            player.stopAndUnload()
        }
    }

    private var transcriptPane: some View {
            ScrollViewReader { proxy in
                ScrollView {
                    segmentList
                        .padding(16)
                        // 컨트롤 뒤로 끝까지 스크롤되도록 고정 여백
                        .padding(.bottom, memo.audioURL != nil ? 340 : 0)
                }
                .scrollEdgeEffectHidden(true, for: .bottom)
                // 사용자가 직접 끌 때만 방향을 읽는다 — 자동 스크롤로 컨트롤이 숨지 않게
                .onScrollPhaseChange { _, newPhase in
                    userIsScrolling = (newPhase == .interacting || newPhase == .tracking)
                }
                .onScrollGeometryChange(for: CGFloat.self, of: { $0.contentOffset.y }) { old, new in
                    guard userIsScrolling else { return }
                    if new > old + 6 { hideControls() }
                    else if new < old - 6 { revealControls() }
                }
                .onChange(of: player.position) {
                    // 재생 중인 문단을 화면 위쪽 1/3 지점에 붙여 따라간다 (Apple Music 가사 위치)
                    guard let current = playingSegmentID, current != centeredSegmentID else { return }
                    centeredSegmentID = current
                    withAnimation(.spring(duration: 0.55, bounce: 0.22)) {
                        proxy.scrollTo(current, anchor: UnitPoint(x: 0.5, y: 0.3))
                    }
                }
            }
            // Apple Music 가사 화면처럼 — 바로 끊지 않고 전사문이 컨트롤 뒤로 서서히 사라진다
            .overlay(alignment: .bottom) {
                if memo.audioURL != nil, controlsVisible {
                    playerBar
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
    }

    // MARK: 컨트롤 자동 숨김

    private func scheduleAutoHide() {
        hideTask?.cancel()
        guard player.isPlaying else { return }
        hideTask = Task {
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled, player.isPlaying else { return }
            withAnimation(.smooth(duration: 0.45)) { controlsVisible = false }
        }
    }

    private func revealControls() {
        hideTask?.cancel()
        if !controlsVisible {
            withAnimation(.smooth(duration: 0.35)) { controlsVisible = true }
        }
        scheduleAutoHide()
    }

    private func hideControls() {
        hideTask?.cancel()
        guard controlsVisible else { return }
        withAnimation(.smooth(duration: 0.35)) { controlsVisible = false }
    }

    /// 상단에는 교정 진행 상태만 잠깐 보여준다 — 날짜·길이 줄은 노트 리스트에 이미 있어 뺐다
    @ViewBuilder
    private var header: some View {
        if correcting {
            ProgressView(value: correctProgress) {
                Text("전체 교정 중… \(Int(correctProgress * 100))%").font(.caption)
            }
            .tint(.white)
        }
    }

    // MARK: 가사 스타일 전사문

    private var segmentList: some View {
        LazyVStack(alignment: .leading, spacing: 20) {
            ForEach(memo.segments) { seg in
                let isPlaying = player.isPlaying
                let isCurrent = playingSegmentID == seg.id
                let dimmed = isPlaying && !isCurrent
                VStack(alignment: .leading, spacing: 4) {
                    Text(seg.tStart.timeString)
                        .font(.caption.monospacedDigit().weight(isPlaying && isCurrent ? .semibold : .regular))
                        .foregroundStyle(.white.opacity(dimmed ? 0.45 : 0.65))
                    ChipText(showOriginal ? (seg.origText ?? seg.text) : seg.text,
                             corrSpans: showOriginal ? nil : seg.corrSpans,
                             spanColor: dimmed ? Color(.systemBlue).opacity(0.4) : Color(.systemBlue))
                        .font(.system(size: 20, weight: isPlaying && isCurrent ? .bold : .regular))
                        .lineSpacing(6)
                        .foregroundStyle(.white.opacity(dimmed ? 0.5 : 1))
                        .textSelection(.enabled)
                        .shimmering(correcting && correctingIndex == memo.segments.firstIndex(of: seg))
                }
                // 재생 중인 문단은 살짝 커지고(1.04) 나머지는 블러 — Apple Music 가사와 같은 문법.
                // 숫자·본문·블러·스케일이 전부 하나의 스프링으로 함께 움직인다
                .scaleEffect(isPlaying && isCurrent ? 1.04 : 1, anchor: .leading)
                .blur(radius: dimmed ? 2.2 : 0)
                .animation(rowAnim, value: isCurrent)
                .animation(rowAnim, value: isPlaying)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .onTapGesture {
                    // 타임스탬프뿐 아니라 전사문 아무 곳이나 탭해도 그 지점부터 재생
                    guard memo.audioURL != nil else { return }
                    player.seek(to: seg.tStart)
                    revealControls()
                }
                .id(seg.id)
            }
        }
    }

    // MARK: 재생 컨트롤

    @State private var scrubbing = false
    @State private var scrubPosition: Double = 0

    private var playerBar: some View {
        VStack(spacing: 14) {
            // Apple Music 스타일 스크러버 — 핸들 없이 터치하면 바가 굵어지고 끌어서 이동
            VStack(spacing: 5) {
                GeometryReader { geo in
                    let progress = max(0, min(1, (scrubbing ? scrubPosition : player.position) / max(1, player.duration)))
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(.white.opacity(0.25))
                        Capsule()
                            .fill(.white.opacity(scrubbing ? 0.95 : 0.7))
                            .frame(width: max(0, geo.size.width * progress))
                    }
                    .frame(height: scrubbing ? 14 : 7)
                    .frame(maxHeight: .infinity, alignment: .center)
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { value in
                                withAnimation(.smooth(duration: 0.18)) { scrubbing = true }
                                let ratio = max(0, min(1, value.location.x / geo.size.width))
                                scrubPosition = ratio * player.duration
                            }
                            .onEnded { _ in
                                player.seek(to: scrubPosition, autoplay: false)
                                withAnimation(.smooth(duration: 0.18)) { scrubbing = false }
                                revealControls()
                            }
                    )
                }
                .frame(height: 20)
                HStack {
                    Text((scrubbing ? scrubPosition : player.position).timeString)
                    Spacer()
                    Text("-" + max(0, player.duration - (scrubbing ? scrubPosition : player.position)).timeString)
                }
                .font(.caption.monospacedDigit())
                .foregroundStyle(.white.opacity(0.6))
            }
            .padding(.horizontal, 20)

            // 재생 컨트롤 — 큼직한 재생 버튼 (Apple Music 비율)
            HStack(spacing: 64) {
                Button { player.skip(-15); revealControls() } label: {
                    Image(systemName: "gobackward.15").font(.title2)
                }
                Button { player.toggle(); revealControls() } label: {
                    Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 46, weight: .semibold))
                        .frame(width: 60, height: 60)
                        .contentTransition(.symbolEffect(.replace))
                }
                Button { player.skip(15); revealControls() } label: {
                    Image(systemName: "goforward.15").font(.title2)
                }
            }
            .tint(.white)

            // 볼륨 — 스크러버와 같은 문법의 가는 바
            HStack(spacing: 10) {
                Image(systemName: "speaker.fill").font(.caption)
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(.white.opacity(0.25))
                        Capsule().fill(.white.opacity(0.75))
                            .frame(width: max(0, geo.size.width * player.volume))
                    }
                    .frame(height: 6)
                    .frame(maxHeight: .infinity, alignment: .center)
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { value in
                                player.volume = max(0, min(1, value.location.x / geo.size.width))
                            }
                            .onEnded { _ in revealControls() }
                    )
                }
                .frame(height: 18)
                Image(systemName: "speaker.wave.3.fill").font(.caption)
            }
            .foregroundStyle(.white.opacity(0.65))
            .padding(.horizontal, 26)

            // 액션 3종 — 내보내기 · 전체 교정 · 스튜디오
            HStack(spacing: 10) {
                ShareLink(item: exportMarkdown(), preview: SharePreview(memo.title)) {
                    actionPill("내보내기", icon: "square.and.arrow.up")
                }
                Button {
                    Task { await correctAll() }
                } label: {
                    if correcting {
                        actionPill("교정 \(Int(correctProgress * 100))%", icon: "wand.and.stars")
                    } else {
                        actionPill("전체 교정", icon: "wand.and.stars")
                    }
                }
                .disabled(correcting)
                Button {
                    appState.openStudio(memoUUID: memo.uuid)
                } label: {
                    actionPill("스튜디오", icon: "sparkles")
                }
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 20)
            .padding(.bottom, 8)
        }
        // 구분선·바 머티리얼 대신 배경색으로 녹아드는 그라데이션 — 경계가 보이지 않는다
        .padding(.top, 36)
        .background {
            LinearGradient(
                stops: [
                    .init(color: bgBottom.opacity(0), location: 0),
                    .init(color: bgBottom.opacity(0.92), location: 0.28),
                    .init(color: bgBottom, location: 0.55)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea(edges: .bottom)
        }
    }

    private func actionPill(_ title: String, icon: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.footnote.weight(.semibold))
            Text(title).font(.footnote.weight(.semibold))
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 11)
        .background(.white.opacity(0.14), in: Capsule())
    }

    // MARK: batch correction (desktop 전체 교정 — per-chunk loop to keep timestamps aligned)

    private func correctAll() async {
        // 엔진 미설정이면 조용히 실패하는 대신 이유를 바로 알려준다
        guard ai.engineReady(settings.correctionEngine) else {
            errorMessage = "교정 엔진이 준비되지 않았습니다. 설정에서 교정 엔진과 API 키를 확인해 주세요."
            return
        }
        guard !correcting else { return }
        correcting = true
        correctProgress = 0
        defer { correcting = false; correctingIndex = nil }
        let total = memo.segments.count
        for idx in memo.segments.indices {
            let seg = memo.segments[idx]
            withAnimation(.easeInOut(duration: 0.2)) { correctingIndex = idx }
            // 실시간 교정을 거친 문단(origText 있음)도 다시 교정한다 — 원문은 최초 것을 보존
            guard !seg.text.isEmpty else {
                correctProgress = Double(idx + 1) / Double(total)
                continue
            }
            let context = memo.segments[max(0, idx - 6)..<idx].map(\.text).joined(separator: "\n")
            let follow = memo.segments[(idx + 1)..<min(memo.segments.count, idx + 3)].map(\.text).joined(separator: "\n")
            do {
                let result = try await ai.correctChunk(context: context, follow: follow, chunk: seg.text)
                if result.text != seg.text, !result.text.isEmpty {
                    if memo.segments[idx].origText == nil {
                        memo.segments[idx].origText = seg.text
                    }
                    memo.segments[idx].text = result.text
                    memo.segments[idx].corrSpans = result.spans.isEmpty ? nil : result.spans
                }
            } catch {
                errorMessage = error.localizedDescription
                return
            }
            correctProgress = Double(idx + 1) / Double(total)
        }
        try? context.save()
    }

    private func exportMarkdown() -> String {
        var md = "# \(memo.title)\n\n- 날짜: \(memo.createdAt.shortString)\n- 길이: \(memo.durationSec.timeString)\n\n"
        for seg in memo.segments {
            md += "**[\(seg.tStart.timeString)]** \(seg.text)\n\n"
        }
        return md
    }
}

// MARK: - 내비게이션·툴바·알럿 크롬 (본문 3탭 분리로 body 가 길어져 모디파이어로 묶음)

private struct MemoDetailChrome: ViewModifier {
    @Bindable var memo: Memo
    let player: PlayerController
    @Binding var tab: Int
    @Binding var showOriginal: Bool
    @Binding var showRename: Bool
    @Binding var renameText: String
    let correcting: Bool
    @Binding var errorMessage: String?
    let correctAll: () -> Void
    let exportMarkdown: () -> String
    let revealControls: () -> Void

    func body(content: Content) -> some View {
        content
            // 회색/검정 배경 위에서는 항상 흰 글자 체계 — 콘텐츠·컨트롤 전체에 다크 스킴 강제
            .environment(\.colorScheme, .dark)
            .navigationTitle(memo.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarColorScheme(.dark, for: .navigationBar)
            // 전사문에 들어오면 하단 탭바를 감춘다 — 재생 컨트롤이 그 자리를 쓴다
            .toolbar(.hidden, for: .tabBar)
            .environment(\.openURL, OpenURLAction { url in
                if url.scheme == "dictly", url.host == "seek" || url.pathComponents.count > 1 {
                    let sec = Double(url.lastPathComponent) ?? 0
                    player.seek(to: sec)
                    revealControls()
                    return .handled
                }
                return .systemAction
            })
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        if memo.hasCorrections {
                            Button {
                                showOriginal.toggle()
                            } label: {
                                Label(showOriginal ? "교정본 보기" : "원문 보기",
                                      systemImage: "arrow.2.squarepath")
                            }
                        }
                        Button {
                            renameText = memo.title
                            showRename = true
                        } label: {
                            Label("제목 변경", systemImage: "pencil")
                        }
                        Button {
                            memo.favorite.toggle()
                        } label: {
                            Label(memo.favorite ? "즐겨찾기 해제" : "즐겨찾기",
                                  systemImage: memo.favorite ? "star.slash" : "star")
                        }
                        if !correcting {
                            Button {
                                correctAll()
                            } label: {
                                Label("전체 AI 교정", systemImage: "wand.and.stars")
                            }
                        }
                        ShareLink(item: exportMarkdown(), preview: SharePreview(memo.title)) {
                            Label("내보내기", systemImage: "square.and.arrow.up")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .alert("제목 변경", isPresented: $showRename) {
                TextField("제목", text: $renameText)
                Button("변경") {
                    let t = renameText.trimmingCharacters(in: .whitespaces)
                    if !t.isEmpty { memo.title = t }
                }
                Button("취소", role: .cancel) {}
            }
            .alert("오류", isPresented: .init(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("확인") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
    }
}
