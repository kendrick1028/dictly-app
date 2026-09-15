import Foundation
import Observation
import MLX
import WhisperKit

/// Lightning(실시간 로컬) 엔진의 상주 프리로더 — WhisperPreloader 패턴 미러.
/// CoreML 인코더 2종 + MLX 디코더 가중치 + 토크나이저만 올린다.
/// WhisperKit 인스턴스는 만들지 않는다(TextDecoder 미로드) — 메모리 상호 배타는
/// 엔진 전환 시 상대 프리로더의 release() 호출로 지킨다.
@MainActor
@Observable
final class LightningPreloader {
    static let shared = LightningPreloader()

    enum Phase: Equatable {
        case idle
        case downloading(Int)   // 디코더 가중치 부분 다운로드 percent
        case loading            // 모델 로드 + 인코더 워밍업
        case ready
        case failed(String)
    }

    struct Assets {
        let frontend: CoreMLFrontend
        let decoder: WhisperMLXDecoder
        let tokenizer: any WhisperTokenizer
    }

    private(set) var phase: Phase = .idle
    private var assets: Assets?
    private var loadTask: Task<Assets, Error>?

    var isResident: Bool { assets != nil }

    /// 추가 다운로드 없이 바로 쓸 수 있는 상태인지 (디코더 가중치 + CoreML 인코더 모두 로컬)
    nonisolated static var isDownloaded: Bool {
        SafetensorsFetch.isDownloaded && CoreMLFrontend.modelFolder() != nil
    }

    /// 지금 받아야 하는 항목과 크기(MB) — App Review 4.2.3(ii) 고지용
    nonisolated static var missingDownloads: [(name: String, mb: Int)] {
        var list: [(String, Int)] = []
        if !SafetensorsFetch.isDownloaded { list.append(("실시간 디코더 가중치", 328)) }
        if CoreMLFrontend.modelFolder() == nil {
            list.append(("음성 인코더 모델", WhisperEngine.downloadSizeMB(CoreMLFrontend.preferredVariant)))
        }
        return list
    }

    /// 녹음 시작을 막아야 하는지 (WhisperPreloader 와 동일 규칙)
    var shouldBlockRecording: Bool {
        if case .failed = phase { return false }
        return !isResident
    }

    var statusLabel: String {
        switch phase {
        case .idle: "대기"
        case .downloading(let pct): "가중치 다운로드 \(pct)%"
        case .loading: "로드 중…"
        case .ready: "준비됨"
        case .failed(let msg): "실패: \(msg)"
        }
    }

    /// fire-and-forget (앱 런치 / 엔진 전환)
    func preload() {
        Task { _ = try? await self.ensureLoaded() }
    }

    func ensureLoaded() async throws -> Assets {
        if let assets { return assets }
        if let loadTask { return try await loadTask.value }
        let task = Task<Assets, Error> {
            do {
                phase = .loading
                let tokenizer = try await ModelUtilities.loadTokenizer(for: .largev3)
                let weightsURL = try await SafetensorsFetch.fetchDecoder { [weak self] frac, _ in
                    self?.phase = .downloading(Int(frac * 100))
                }
                phase = .loading
                let decoder = try WhisperMLXDecoder(url: weightsURL)
                // 신규 설치: Whisper 온보딩 없이 실시간 로컬을 먼저 고른 경우 인코더 mlmodelc 를 직접 받는다
                if CoreMLFrontend.modelFolder() == nil {
                    phase = .downloading(0)
                    _ = try await WhisperKit.download(variant: CoreMLFrontend.preferredVariant) { [weak self] prog in
                        Task { @MainActor in self?.phase = .downloading(Int(prog.fractionCompleted * 100)) }
                    }
                    phase = .loading
                }
                let frontend = try await CoreMLFrontend.load()
                // 워밍업 — 첫 녹음 스텝이 ANE 특수화/캐시 로드를 뒤집어쓰지 않게 미리 지불
                _ = try await frontend.encode(samples16k: [Float](repeating: 0, count: 16000))
                let built = Assets(frontend: frontend, decoder: decoder, tokenizer: tokenizer)
                assets = built
                phase = .ready
                return built
            } catch {
                phase = .failed(error.localizedDescription)
                loadTask = nil
                throw error
            }
        }
        loadTask = task
        return try await task.value
    }

    /// 엔진 전환 시 메모리 해제 (Whisper 와 상호 배타)
    func release() {
        loadTask?.cancel()
        loadTask = nil
        assets = nil
        if phase != .idle, case .failed = phase {} else { phase = .idle }
    }
}
