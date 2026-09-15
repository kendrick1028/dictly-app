import SwiftUI
import SwiftData

/// Full-screen recording session (presented from the 노트 tab's record panel).
/// Layout follows the reference design: header (title + date·duration), paragraph-style
/// transcript with timestamp chips, an in-progress highlight block, and round
/// pause/stop controls flanking a glass timer capsule.
struct RecordingSessionView: View {
    @Environment(RecorderViewModel.self) private var vm
    @Environment(AppState.self) private var appState
    @Environment(\.modelContext) private var context

    var body: some View {
        @Bindable var vm = vm
        VStack(spacing: 0) {
            header
            Divider().opacity(0.4)
            switch vm.phase {
            case .idle:
                Spacer()
                ProgressView()
                Spacer()
            case .preparing(let status), .stopping(let status):
                preparingView(status)
            case .recording, .paused:
                transcriptList
                levelStrip
                controlBar
            case .error(let message):
                errorView(message)
            }
        }
        .background(Color(.systemBackground))
        .onChange(of: vm.draft?.id) { _, _ in
            // 자동 저장 — 저장 시트 없이 바로 노트로 기록된다
            if let draft = vm.draft {
                autoSave(draft)
            }
        }
        .onChange(of: vm.phase) { _, newPhase in
            // recording ended with nothing to save (or error dismissed) → close the cover
            if newPhase == .idle && vm.draft == nil {
                appState.isRecordingPresented = false
            }
        }
    }

    private func autoSave(_ draft: RecordingDraft) {
        let memo = Memo(
            title: draft.suggestedTitle,
            durationSec: draft.durationSec,
            audioFileName: draft.audioFileName.isEmpty ? nil : draft.audioFileName,
            language: draft.language,
            segments: draft.segments
        )
        memo.folder = appState.recordFolder
        context.insert(memo)
        try? context.save()
        vm.draft = nil
        appState.isRecordingPresented = false
    }

    // MARK: header

    private var dateLabel: String {
        let df = DateFormatter()
        df.dateFormat = "yyyy.MM.dd"
        return df.string(from: .now)
    }

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "waveform")
                .font(.title3.weight(.semibold))
                .foregroundStyle(Color.primary)
            VStack(alignment: .leading, spacing: 2) {
                // 5청크 시점에 생성된 제목이 있으면 그걸 쓴다 (없을 때만 폴더명/기본값)
                Text(vm.liveTitle.isEmpty ? (appState.recordFolder?.name ?? "새 녹음") : vm.liveTitle)
                    .font(.title3.bold())
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Text("\(dateLabel) · \(vm.elapsed.timeString)")
                        .monospacedDigit()
                    if !vm.engineLabel.isEmpty {
                        Text("· \(vm.engineLabel)")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                if !vm.engineNote.isEmpty {
                    Text(vm.engineNote)
                        .font(.caption2)
                        .foregroundStyle(.orange)
                        .lineLimit(2)
                }
            }
            Spacer()
            if vm.phase == .recording {
                HStack(spacing: 5) {
                    Circle().fill(.red).frame(width: 8, height: 8)
                    Text("REC")
                        .font(.caption2.bold())
                        .foregroundStyle(.red)
                }
            } else if vm.phase == .paused {
                Text("일시정지")
                    .font(.caption.bold())
                    .foregroundStyle(.orange)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 12)
    }

    // MARK: transcript (paragraph style)

    private var transcriptList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 22) {
                    if vm.segments.isEmpty && vm.volatileText.isEmpty {
                        Text("말씀을 시작하면 여기에 실시간으로 전사됩니다.")
                            .font(.callout)
                            .foregroundStyle(.tertiary)
                            .padding(.top, 30)
                            .frame(maxWidth: .infinity, alignment: .center)
                    }
                    ForEach(vm.segments) { seg in
                        ParagraphRow(segment: seg)
                    }
                    if !vm.volatileText.isEmpty {
                        volatileBlock
                    }
                    Color.clear.frame(height: 8).id("tail")
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
            }
            .onChange(of: vm.segments.count) {
                withAnimation { proxy.scrollTo("tail", anchor: .bottom) }
            }
            .onChange(of: vm.volatileText) {
                proxy.scrollTo("tail", anchor: .bottom)
            }
        }
    }

    /// in-progress block — 엔진과 무관하게 동일한 하이라이트 블록 스타일:
    /// GPT는 실시간 미리보기 텍스트, Whisper는 듣는 중/전사 중(shimmer) 상태를 담는다
    @ViewBuilder
    private var volatileBlock: some View {
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 2)
                .fill(Color.primary.opacity(0.25))
                .frame(width: 3)
            switch vm.volatileText {
            case UtteranceVADEngine.transcribingMarker:
                Text("전사 중 …")
                    .font(.system(size: 19))
                    .lineSpacing(6)
                    .shimmering(true)
            case UtteranceVADEngine.listeningMarker:
                HStack(spacing: 8) {
                    Image(systemName: "waveform")
                        .symbolEffect(.variableColor.iterative, options: .repeating)
                    Text("듣는 중…")
                }
                .font(.system(size: 19))
                .foregroundStyle(.secondary)
            default:
                VStack(alignment: .leading, spacing: 6) {
                    Text("문단이 완성되면 실시간 교정과 함께 반영돼요")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                    Text(vm.volatileText)
                        .font(.system(size: 19))
                        .lineSpacing(6)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    // MARK: bottom controls

    private var levelStrip: some View {
        LevelMeter(level: vm.level)
            .frame(maxWidth: .infinity)
            .padding(.top, 4)
            .opacity(vm.phase == .paused ? 0.25 : 0.8)
    }

    private var controlBar: some View {
        HStack {
            // pause / resume
            Button {
                vm.phase == .paused ? vm.resume() : vm.pause()
            } label: {
                Image(systemName: vm.phase == .paused ? "play.fill" : "pause.fill")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Color.primary)
                    .frame(width: 62, height: 62)
                    .background(Color(.systemGray5), in: Circle())
            }
            .buttonStyle(.plain)

            Spacer()

            // glass timer capsule
            HStack(spacing: 8) {
                Circle()
                    .fill(vm.phase == .paused ? Color.orange : Color.red)
                    .frame(width: 8, height: 8)
                Text(vm.elapsed.timeString)
                    .font(.title3.monospacedDigit().weight(.semibold))
            }
            .padding(.horizontal, 22)
            .padding(.vertical, 13)
            .glassEffect(.regular, in: .capsule)

            Spacer()

            // stop
            Button {
                Task { await vm.stop() }
            } label: {
                Image(systemName: "stop.fill")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(Color(.systemBackground))
                    .frame(width: 62, height: 62)
                    .background(Color.primary, in: Circle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 26)
        .padding(.top, 10)
        .padding(.bottom, 14)
    }

    // MARK: preparing / stopping

    private func preparingView(_ status: String) -> some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "waveform")
                .font(.system(size: 40))
                .foregroundStyle(Color.primary.opacity(0.35))
            if let p = vm.downloadProgress {
                ProgressView(value: p)
                    .padding(.horizontal, 60)
                Text("\(Int(p * 100))%")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            } else {
                ProgressView()
            }
            Text(status)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            Spacer()
        }
    }

    // MARK: error

    private func errorView(_ message: String) -> some View {
        VStack(spacing: 18) {
            Spacer()
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.largeTitle)
                .foregroundStyle(.orange)
            Text(message)
                .multilineTextAlignment(.center)
                .font(.callout)
                .padding(.horizontal, 30)
            Button("확인") { vm.dismissError() }
                .buttonStyle(.borderedProminent)
                .tint(.primary)
            Spacer()
        }
    }
}

/// one finalized paragraph: timestamp chip row + body text
private struct ParagraphRow: View {
    let segment: LiveSegment

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(segment.tStart.timeString)
                .font(.caption.monospacedDigit().weight(.semibold))
                .foregroundStyle(.secondary)
            ChipText(segment.text, corrSpans: segment.corrSpans)
                .font(.system(size: 19))
                .lineSpacing(6)
                .textSelection(.enabled)
                .shimmering(segment.correcting)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
