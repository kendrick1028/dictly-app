import SwiftUI

/// 모델 다운로드 랜딩 — App Review 4.2.3(ii) 대응:
/// 쓸 모델을 직접 골라(체크) 항목별 용량·설명과 총 용량을 보고 내려받는다.
/// Whisper Live (beta)도 같은 화면에서 함께 받을 수 있다.
/// "나중에"를 고르면 아무것도 받지 않으며, 녹음 버튼/설정에서 언제든 다시 열린다.
struct ModelSetupSheet: View {
    @Environment(AppSettings.self) private var settings
    @Environment(\.dismiss) private var dismiss

    private var preloader = WhisperPreloader.shared
    private var lightning = LightningPreloader.shared

    @State private var started = false
    @State private var showLaterNotice = false
    /// 다운로드 진행 단계가 Whisper Live(Lightning) 쪽인지
    @State private var liveStage = false
    @State private var finishedOK = false
    @State private var runFailed = false
    /// 사용자가 고른 모델 id (Whisper 변형명 또는 liveModel 센티널)
    @State private var chosen: Set<String> = []
    /// 최적화는 실제 진행률이 없어서 서서히 차오르는 바로 표시
    @State private var optProgress: Double = 0
    /// 이번 실행에서 받기로 한 전체 개수 — Whisper Live 는 별도 프리로더라
    /// preloader.setupTotal 에 안 잡혀서 따로 센다
    @State private var runTotal = 0
    @State private var runWhisperCount = 0

    struct ModelRow: Identifiable {
        let id: String
        let name: String
        let desc: String
        let mb: Int
        let installed: Bool
    }

    private var rows: [ModelRow] {
        var out: [ModelRow] = []
        if LightningSupport.isSupported {
            out.append(ModelRow(
                id: WhisperEngine.liveModel,
                name: "Whisper Live (beta)",
                desc: WhisperEngine.modelDescription(WhisperEngine.liveModel),
                mb: LightningPreloader.missingDownloads.reduce(0) { $0 + $1.mb },
                installed: LightningPreloader.isDownloaded))
        }
        for m in WhisperEngine.sortedForDisplay(WhisperEngine.curatedModels) {
            out.append(ModelRow(
                id: m,
                name: "Whisper \(WhisperEngine.displayName(m))",
                desc: WhisperEngine.modelDescription(m),
                mb: WhisperEngine.downloadSizeMB(m),
                installed: WhisperPreloader.isDownloaded(m)))
        }
        return out
    }

    /// 이번에 실제로 받을 것들(선택 ∧ 미설치)의 총 용량
    private var selectedMB: Int {
        rows.filter { chosen.contains($0.id) && !$0.installed }.reduce(0) { $0 + $1.mb }
    }

    private var allDone: Bool { finishedOK }
    private var isFailed: Bool { runFailed }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("음성 인식 모델 다운로드")
                        .font(.title2.bold())
                        .padding(.top, 22)

                    VStack(alignment: .leading, spacing: 10) {
                        Text("로컬 전사는 무료·무제한이에요. 쓸 모델을 골라 내려받으세요.")
                            .foregroundStyle(.secondary)
                        Label("다운로드 후에는 인터넷 없이 동작 — 전사 무제한", systemImage: "checkmark")
                            .foregroundStyle(.green)
                        Label("오디오가 기기 밖으로 나가지 않아요", systemImage: "checkmark")
                            .foregroundStyle(.green)
                    }
                    .font(.callout)

                    // ── 모델 선택 (설명·용량·설치 상태 포함)
                    VStack(spacing: 0) {
                        ForEach(Array(rows.enumerated()), id: \.element.id) { idx, row in
                            if idx > 0 { Divider().padding(.leading, 52) }
                            Button {
                                guard !row.installed else { return }
                                if chosen.contains(row.id) {
                                    chosen.remove(row.id)
                                } else {
                                    chosen.insert(row.id)
                                }
                            } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: row.installed || chosen.contains(row.id)
                                          ? "checkmark.circle.fill" : "circle")
                                        .font(.title3)
                                        .foregroundStyle(row.installed ? AnyShapeStyle(.green)
                                                         : chosen.contains(row.id) ? AnyShapeStyle(.primary)
                                                         : AnyShapeStyle(.quaternary))
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(row.name)
                                            .font(.subheadline.weight(.semibold))
                                        Text(row.desc)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer(minLength: 8)
                                    // 지금 받고 있는 모델은 용량 자리에 진행 상태를 보여준다
                                    if isInstalling(row) {
                                        Text("설치중")
                                            .font(.caption.monospacedDigit().weight(.semibold))
                                            .foregroundStyle(.primary)
                                            .shimmering(true)
                                    } else if row.installed {
                                        Text("설치됨")
                                            .font(.caption.monospacedDigit())
                                            .foregroundStyle(.green)
                                    } else {
                                        Text(WhisperEngine.sizeLabel(row.mb))
                                            .font(.caption.monospacedDigit())
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                .padding(.horizontal, 14)
                                .padding(.vertical, 11)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            // .disabled 는 라벨 전체를 흐리게 만들어 "설치됨" 초록색이 탁해진다.
                            // 색은 그대로 두고 탭만 막는다
                            .allowsHitTesting(!(started && !isFailed))
                        }
                        Divider().padding(.leading, 14)
                        HStack {
                            Text(started && !isFailed ? "남은 다운로드" : "총 다운로드")
                                .font(.subheadline.weight(.semibold))
                            Spacer()
                            Text(WhisperEngine.sizeLabel(selectedMB))
                                .font(.subheadline.weight(.semibold).monospacedDigit())
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                    }
                    .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 14))

                    Text("Wi-Fi 연결 상태에서 진행하세요. 받은 모델은 기기에 저장되며, 설정이나 녹음 패널에서 언제든 바꾸거나 추가로 받을 수 있어요.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    if started {
                        VStack(spacing: 0) {
                            stepRow(icon: "arrow.down.circle", title: "모델 다운로드",
                                    done: stageDone(download: true), progress: downloadProgress)
                            Divider().padding(.leading, 44)
                            stepRow(icon: "cpu", title: "Neural Engine 최적화",
                                    done: stageDone(download: false), progress: optimizeProgress)
                        }
                        .padding(.vertical, 6)
                        .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 14))

                        if !allDone, !isFailed {
                            if let progressLabel {
                                Text(progressLabel)
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.secondary)
                            }
                            Text("최초 1회는 몇 분 걸릴 수 있어요 — 화면을 켜둔 채 기다려 주세요")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        if isFailed {
                            Label(liveStage ? lightning.statusLabel : preloader.statusLabel,
                                  systemImage: "exclamationmark.triangle.fill")
                                .font(.callout)
                                .foregroundStyle(.orange)
                        }
                    }
                }
                .padding(.horizontal, 22)
                .padding(.bottom, 12)
            }

            bottomButtons
                .padding(.horizontal, 22)
                .padding(.bottom, 16)
        }
        // 받는 도중에만 스와이프 닫기를 막는다 — 시작 전·실패 후에는 언제든 빠져나갈 수 있다
        .interactiveDismissDisabled(started && !allDone && !isFailed)
        .onAppear(perform: seedSelection)
        // "나중에" — 미다운로드 상태로 남는다는 걸 알리고 닫는다. 녹음 버튼/설정에서 재진입
        .alert("나중에 받기", isPresented: $showLaterNotice) {
            Button("확인") { dismiss() }
        } message: {
            Text("모델을 다운로드하지 않으면 정확한 로컬 무료 전사가 어려워요.\n녹음 버튼을 누르거나 설정 → 전사에서 언제든 다시 받을 수 있어요.")
        }
        .task(id: started) {
            // 최적화 단계 동안 바가 서서히 차오른다 (실제 진행률이 없는 구간)
            var lastModel = preloader.setupCurrentModel
            while started, !Task.isCancelled {
                if preloader.setupCurrentModel != lastModel {
                    lastModel = preloader.setupCurrentModel
                    optProgress = 0
                }
                if allDone {
                    withAnimation { optProgress = 1.0 }
                    break
                }
                if isOptimizing {
                    withAnimation(.linear(duration: 0.5)) {
                        optProgress += (0.95 - optProgress) * 0.025
                    }
                }
                try? await Task.sleep(for: .milliseconds(500))
            }
        }
    }

    /// 처음 열리면 현재 선택된 모델을 기본 체크해 둔다
    private func seedSelection() {
        guard chosen.isEmpty else { return }
        let cur = settings.whisperModel.isEmpty ? WhisperEngine.defaultModel : settings.whisperModel
        if rows.contains(where: { $0.id == cur && !$0.installed }) {
            chosen.insert(cur)
        } else if let first = rows.first(where: { !$0.installed }) {
            chosen.insert(first.id)
        }
    }

    // MARK: buttons

    @ViewBuilder
    private var bottomButtons: some View {
        if allDone {
            Button {
                dismiss()
            } label: {
                Label("준비 완료 — 시작하기", systemImage: "checkmark.circle.fill")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 15)
                    .background(Color.green, in: RoundedRectangle(cornerRadius: 16))
            }
            .buttonStyle(.plain)
        } else if started, !isFailed {
            EmptyView() // 진행 중 — 행의 프로그레스 바가 상태를 보여준다
        } else {
            VStack(spacing: 10) {
                Button {
                    start()
                } label: {
                    Text(isFailed ? "다시 시도" : "다운로드 (\(WhisperEngine.sizeLabel(selectedMB)))")
                        .font(.headline)
                        .foregroundStyle(Color(.systemBackground))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 15)
                        .background(selectedMB > 0 ? Color.primary : Color.secondary.opacity(0.4),
                                    in: RoundedRectangle(cornerRadius: 16))
                }
                .buttonStyle(.plain)
                .disabled(selectedMB == 0)

                Button { showLaterNotice = true } label: {
                    Text("나중에")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func start() {
        let picks = rows.filter { chosen.contains($0.id) && !$0.installed }
        guard !picks.isEmpty else { return }
        started = true
        runFailed = false
        finishedOK = false
        optProgress = 0
        let whisperPicks = picks.map(\.id).filter { !WhisperEngine.isLive($0) }
        let wantsLive = picks.contains { WhisperEngine.isLive($0.id) }
        runWhisperCount = whisperPicks.count
        runTotal = picks.count
        Task {
            var ok = true
            // 목록 맨 위 항목부터 받는다 — Whisper Live 가 먼저
            if wantsLive {
                liveStage = true
                _ = try? await lightning.ensureLoaded()
                if case .failed = lightning.phase { ok = false }
            }
            if ok, !whisperPicks.isEmpty {
                liveStage = false
                let cur = settings.whisperModel
                let sel = whisperPicks.contains(cur) ? cur : whisperPicks[0]
                await preloader.prepareAll(models: whisperPicks, selected: sel)
                if case .failed = preloader.phase { ok = false }
            }
            finalizeSelection(whisperPicks: whisperPicks, wantsLive: wantsLive)
            if ok { finishedOK = true } else { runFailed = true }
        }
    }

    /// 완료 후 활성 모델 정리 — 지금 선택된 모델이 설치돼 있지 않으면 이번에 받은 것으로 바꾼다
    private func finalizeSelection(whisperPicks: [String], wantsLive: Bool) {
        let cur = settings.whisperModel.isEmpty ? WhisperEngine.defaultModel : settings.whisperModel
        let curInstalled = WhisperEngine.isLive(cur)
            ? LightningPreloader.isDownloaded
            : WhisperPreloader.isDownloaded(cur)
        guard !curInstalled else { return }
        if let w = whisperPicks.first(where: { WhisperPreloader.isDownloaded($0) }) {
            settings.whisperModel = w
        } else if wantsLive, LightningPreloader.isDownloaded {
            settings.whisperModel = WhisperEngine.liveModel
        }
    }

    // MARK: stage states

    /// 지금 이 행을 받고 있는가 — Whisper Live 는 전용 프리로더라 단계로 판별한다
    private func isInstalling(_ row: ModelRow) -> Bool {
        guard started, !allDone, !isFailed else { return false }
        if WhisperEngine.isLive(row.id) { return liveStage }
        return !liveStage && preloader.setupCurrentModel == row.id
    }

    /// "모델 2/4 — Turbo+" — Whisper Live 를 마지막 한 칸으로 포함한다
    private var progressLabel: String? {
        guard runTotal > 0 else { return nil }
        if liveStage {
            return "모델 1/\(runTotal) — Whisper Live"
        }
        // Whisper Live 를 먼저 받았으면 그만큼 뒤로 민다
        let offset = runTotal - runWhisperCount
        let index = offset + min(preloader.setupDone + 1, max(runWhisperCount, 1))
        let name = preloader.setupCurrentModel.isEmpty
            ? "준비 중"
            : WhisperEngine.displayName(preloader.setupCurrentModel)
        return "모델 \(index)/\(runTotal) — \(name)"
    }

    private var isOptimizing: Bool {
        if liveStage { return lightning.phase == .loading }
        return preloader.phase == .optimizing || preloader.phase == .loading
    }

    private func stageDone(download: Bool) -> Bool {
        if allDone { return true }
        if isOptimizing { return download }
        return false
    }

    /// nil = 진행 표시 없음, 값 = 두꺼운 바 표시
    private var downloadProgress: Double? {
        if liveStage {
            if case .downloading(let pct) = lightning.phase { return Double(pct) / 100 }
            return nil
        }
        if case .downloading(let pct) = preloader.phase { return Double(pct) / 100 }
        return nil
    }

    private var optimizeProgress: Double? {
        isOptimizing ? optProgress : nil
    }

    // MARK: rows

    private func stepRow(icon: String, title: String, done: Bool, progress: Double?) -> some View {
        VStack(spacing: 8) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.title3)
                    .frame(width: 30)
                Text(title)
                    .font(.subheadline.weight(.medium))
                Spacer()
                if done {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                } else if let progress {
                    Text("\(Int(progress * 100))%")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
            if let progress, !done {
                thickBar(progress)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
    }

    private func thickBar(_ value: Double) -> some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(.quaternary)
                Capsule()
                    .fill(Color.primary)
                    .frame(width: max(10, geo.size.width * min(1, value)))
            }
        }
        .frame(height: 10)
        .animation(.linear(duration: 0.3), value: value)
    }
}
