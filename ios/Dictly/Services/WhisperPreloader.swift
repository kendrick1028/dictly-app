import Foundation
import Observation
import os
import WhisperKit

/// Keeps one WhisperKit instance downloaded, optimized and resident in memory so
/// recording can start instantly. Preloading kicks off at app launch (and whenever
/// the selected model changes); the expensive Neural Engine specialization then
/// happens once in the background instead of at record time.
///
/// 콜드 런치 규칙: 한 번이라도 완전 로드에 성공한 변형(마커 기록)은 네트워크를 전혀 타지
/// 않고 로컬 폴더에서 바로 로드한다. ANE 특수화 캐시는 OS 가 관리하고 mlmodelc 의 절대
/// 경로에 키가 묶여 있어, 재설치/OS 업데이트 뒤 첫 로드만 다시 느려진다 — 그 구분을
/// phase(.loading vs .optimizing)로 드러낸다.
@MainActor
@Observable
final class WhisperPreloader {
    static let shared = WhisperPreloader()

    enum Phase: Equatable {
        case idle
        case downloading(Int)   // percent
        case loading            // 검증된 로컬 사본의 워밍 로드 — 수 초
        case optimizing         // 다운로드 직후 최초 로드 — ANE 특수화로 몇 분 걸릴 수 있음
        case ready
        case failed(String)
    }

    private(set) var phase: Phase = .idle
    private(set) var variant: String?
    private var kit: WhisperKit?
    private var loadTask: Task<WhisperKit, Error>?

    private nonisolated static let log = Logger(subsystem: "com.leehyunwoo.dictly", category: "WhisperPreload")

    /// 최초 실행 일괄 준비 진행 상황
    private(set) var setupTotal = 0
    private(set) var setupDone = 0
    private(set) var setupCurrentModel = ""

    /// 모든 모델의 다운로드+최적화가 끝났는지 (최초 온보딩 완료 플래그)
    /// 온보딩 완료 여부. 마커만 믿으면 안 된다 — 앱 재설치·모델 정리로 파일이 사라져도
    /// UserDefaults 는 남아 있을 수 있어(iCloud 복원 등) 실제 폴더 존재까지 확인한다.
    nonisolated static var allModelsReady: Bool {
        guard UserDefaults.standard.bool(forKey: "whisperSetupAllDone") else { return false }
        let downloaded = Set(WhisperEngine.downloadedModels())
        guard WhisperEngine.curatedModels.allSatisfy({ downloaded.contains($0) }) else {
            // 파일이 사라졌으면 마커를 지워 온보딩이 다시 뜨게 한다 (자가 치유)
            UserDefaults.standard.set(false, forKey: "whisperSetupAllDone")
            return false
        }
        return true
    }

    /// 모델이 메모리에 올라와 있어 즉시 녹음할 수 있는 상태.
    /// 상주 인스턴스는 프로세스가 죽으면 사라지므로 콜드 런치 직후에는 false 다.
    var isResident: Bool { kit != nil }

    /// 녹음 시작 버튼을 막아야 하는지.
    /// 모델이 메모리에 없으면 막는다 — 안 막으면 녹음 화면에 들어간 뒤 로딩을 기다리게 된다.
    /// 실패 상태는 막지 않는다 (녹음 화면에서 에러를 보여줘야 하므로).
    var shouldBlockRecording: Bool {
        if case .failed = phase { return false }
        return !isResident
    }

    /// 엔진 전환 시 메모리 해제 (Lightning 과 상호 배타)
    func release() {
        loadTask?.cancel()
        loadTask = nil
        kit = nil
        if phase == .ready { phase = .idle }
    }

    func resolvedVariant(_ model: String) -> String {
        model.isEmpty ? WhisperEngine.defaultModel : model
    }

    /// fire-and-forget background preparation (app launch / model change)
    func preload(model: String) {
        Task { _ = try? await self.ensureLoaded(model: model) }
    }

    /// 최초 실행 온보딩 — 제공되는 모든 모델을 순서대로 받아 ANE 특수화까지 끝낸다.
    /// 여기서 다 끝내야 녹음 시작이 최적화를 기다리는 일이 없다.
    func prepareAll(models: [String], selected: String) async {
        let targets = models.isEmpty ? [resolvedVariant(selected)] : models
        let selectedVariant = resolvedVariant(selected)
        setupTotal = targets.count
        setupDone = 0

        // 실패를 phase 로 판단하면 안 된다 — 뒤 모델이 성공하며 phase 를 덮어써
        // 실패가 묻히거나, 반대로 실패가 남아 완료 플래그가 영영 안 써진다
        var anyFailed = false

        for (index, target) in targets.enumerated() {
            setupDone = index
            setupCurrentModel = target
            if target == selectedVariant {
                // 선택 모델은 메모리에 상주시켜 첫 녹음이 즉시 시작되게 한다
                if (try? await ensureLoaded(model: target, prewarm: true)) == nil { anyFailed = true }
            } else {
                do { try await warmUp(target) } catch { anyFailed = true }
            }
        }

        setupDone = targets.count
        // 선택 모델이 목록에 없었다면 마지막에 상주 로드
        if !targets.contains(selectedVariant) {
            setupCurrentModel = selectedVariant
            if (try? await ensureLoaded(model: selectedVariant, prewarm: true)) == nil { anyFailed = true }
        }

        guard !anyFailed else {
            phase = .failed("일부 모델을 준비하지 못했습니다 — 다시 시도해 주세요")
            return
        }
        phase = .ready
        UserDefaults.standard.set(true, forKey: "whisperSetupAllDone")
    }

    /// 모델 하나를 받아 특수화만 시켜두고 즉시 해제한다.
    /// 특수화 결과는 OS 캐시에 남으므로 나중에 이 모델을 골라도 다시 기다리지 않는다.
    /// 재시도 시 이미 완료된 모델은 loadInstance 의 패스트패스로 네트워크 없이 통과한다.
    private func warmUp(_ target: String) async throws {
        _ = try await loadInstance(target, prewarm: true)
    }

    /// returns a loaded instance, reusing the resident one when the variant matches.
    /// `prewarm` 은 ANE 워밍업 추론까지 돌리는 비싼 단계라 **최초 온보딩에서만** 켠다.
    func ensureLoaded(model: String, prewarm: Bool = false) async throws -> WhisperKit {
        let target = resolvedVariant(model)
        if let kit, variant == target {
            phase = .ready
            return kit
        }
        if let loadTask, variant == target {
            return try await loadTask.value
        }

        // 다른 모델 로드가 진행 중이면 끝날 때까지 기다렸다가 전환한다 —
        // CoreML 로드를 중간에 취소하면 앱이 멈출 수 있다
        if let inflight = loadTask {
            _ = try? await inflight.value
            // 기다리는 동안 같은 변형이 준비됐으면 그대로 사용
            if let kit, variant == target {
                phase = .ready
                return kit
            }
        }
        Self.noteContainerPath()
        kit = nil
        variant = target

        let task = Task<WhisperKit, Error>(priority: .utility) {
            let instance = try await self.loadInstance(target, prewarm: prewarm)
            self.kit = instance
            self.phase = .ready
            return instance
        }
        loadTask = task
        do {
            return try await task.value
        } catch {
            // 실패한 시도를 캐시로 남기면 다음 호출이 영영 재시도하지 못한다 — 버린다
            if loadTask == task { loadTask = nil }
            throw error
        }
    }

    // MARK: - load pipeline

    /// 전체 파이프라인: 로컬 패스트패스 → (미스/실패 시) 다운로드 경로.
    /// 마커는 WhisperKit init 완전 성공(토크나이저 포함) 후에만 기록하므로,
    /// 마커가 있으면 이후 콜드 런치는 완전 오프라인으로 로드할 수 있다.
    private func loadInstance(_ target: String, prewarm: Bool) async throws -> WhisperKit {
        // 1) 패스트패스 — 이 설치에서 완전 로드에 성공한 적 있는 변형은 네트워크 0
        if Self.isDownloaded(target) {
            phase = .loading
            // 워밍 로드는 수 초면 끝난다. 10초를 넘기면 ANE 캐시 미스(재설치·OS 업데이트)로
            // 재특수화가 도는 것 — 문구를 정직하게 "최적화 중"으로 바꾼다
            let flip = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(10))
                if self?.phase == .loading { self?.phase = .optimizing }
            }
            defer { flip.cancel() }
            let folder = Self.modelFolderURL(for: target)
            do {
                let instance = try await Self.makeKit(target, folder: folder, prewarm: prewarm)
                Self.setDownloadMarker(target)   // 레거시(온보딩 플래그만 있는) 사용자를 마커로 이관
                return instance
            } catch {
                // 로컬 사본 손상 — 자가 치유: 마커·폴더를 버리고 재다운로드로 폴백
                Self.log.error("fast-path load failed for \(target, privacy: .public): \(error.localizedDescription, privacy: .public) — redownloading")
                Self.clearDownloadMarker(target)
                try? FileManager.default.removeItem(at: folder)
            }
        }

        // 2) 다운로드 경로
        phase = .downloading(0)
        let folder: URL
        do {
            folder = try await WhisperKit.download(variant: target, progressCallback: { p in
                let pct = Int(p.fractionCompleted * 100)
                Task { @MainActor [weak self] in
                    if case .downloading = self?.phase { self?.phase = .downloading(pct) }
                }
            })
        } catch {
            phase = .failed("다운로드 실패")
            throw TranscribeError.engineFailed("Whisper 모델 다운로드 실패 — \(error.localizedDescription)")
        }
        phase = .optimizing
        do {
            let instance = try await Self.makeKit(target, folder: folder, prewarm: prewarm)
            Self.setDownloadMarker(target)
            return instance
        } catch {
            phase = .failed("모델 로드 실패")
            throw TranscribeError.engineFailed("Whisper 모델 로드 실패 — \(error.localizedDescription)")
        }
    }

    /// WhisperKit init + 소요 시간 계측. nonisolated 라 메인 액터 밖에서 돈다.
    private nonisolated static func makeKit(_ target: String, folder: URL, prewarm: Bool) async throws -> WhisperKit {
        let start = CFAbsoluteTimeGetCurrent()
        let config = WhisperKitConfig(
            model: target,
            modelFolder: folder.path,
            verbose: false,
            prewarm: prewarm,
            load: true,
            download: false
        )
        let instance = try await WhisperKit(config)
        logTimings(instance, variant: target, wall: CFAbsoluteTimeGetCurrent() - start)
        return instance
    }

    /// encSpec/decSpec 은 prewarm 로드에서만 채워진다 — 일반 워밍 로드에서 특수화 캐시
    /// 미스는 비정상적으로 큰 encLoad/decLoad 로 나타난다
    private nonisolated static func logTimings(_ instance: WhisperKit, variant: String, wall: Double) {
        let t = instance.currentTimings
        log.info("whisper load \(variant, privacy: .public): wall=\(wall, format: .fixed(precision: 2))s total=\(t.modelLoading, format: .fixed(precision: 2))s prewarm=\(t.prewarmLoadTime, format: .fixed(precision: 2))s encLoad=\(t.encoderLoadTime, format: .fixed(precision: 2))s decLoad=\(t.decoderLoadTime, format: .fixed(precision: 2))s encSpec=\(t.encoderSpecializationTime, format: .fixed(precision: 2))s decSpec=\(t.decoderSpecializationTime, format: .fixed(precision: 2))s tok=\(t.tokenizerLoadTime, format: .fixed(precision: 2))s")
    }

    /// ANE 특수화 캐시는 mlmodelc 절대 경로에 키가 묶인다 — 재설치/복원으로 컨테이너
    /// 경로가 바뀌면 캐시가 통째로 무효화되므로, 바뀐 시점을 로그로 남겨 원인을 진단한다
    private nonisolated static func noteContainerPath() {
        let current = NSHomeDirectory()
        let key = "whisperLastContainerPath"
        let previous = UserDefaults.standard.string(forKey: key)
        if let previous, previous != current {
            log.notice("app container path changed (reinstall/restore) — ANE cache invalidated, next load will re-specialize")
        }
        UserDefaults.standard.set(current, forKey: key)
    }

    // MARK: - local model bookkeeping

    /// 변형별 "완전 로드 성공" 마커 — 이게 있어야만 네트워크 검증 없이 로컬 로드한다
    private nonisolated static func markerKey(_ variant: String) -> String { "whisperDL.\(variant)" }

    nonisolated static func hasDownloadMarker(_ variant: String) -> Bool {
        UserDefaults.standard.bool(forKey: markerKey(variant))
    }

    private nonisolated static func setDownloadMarker(_ variant: String) {
        UserDefaults.standard.set(true, forKey: markerKey(variant))
    }

    private nonisolated static func clearDownloadMarker(_ variant: String) {
        UserDefaults.standard.removeObject(forKey: markerKey(variant))
    }

    /// WhisperKit(HubApi 기본값)의 저장 위치를 그대로 미러링한다 —
    /// Documents/huggingface/models/argmaxinc/whisperkit-coreml/<variant>
    nonisolated static func modelFolderURL(for variant: String) -> URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appending(components: "huggingface", "models", "argmaxinc", "whisperkit-coreml", variant)
    }

    /// WhisperKit.loadModels 가 실제로 요구하는 3개 파일 (prefill/config.json 은 선택)
    private nonisolated static func folderIsComplete(_ folder: URL) -> Bool {
        ["MelSpectrogram.mlmodelc", "AudioEncoder.mlmodelc", "TextDecoder.mlmodelc"]
            .allSatisfy { FileManager.default.fileExists(atPath: folder.appending(component: $0).path) }
    }

    /// 파일이 디스크에 있고 (마커 ∨ 레거시 온보딩 완료) — 마커 없이 온보딩 플래그만 있는
    /// 기존 사용자도 패스트패스를 타고, 성공 시 마커가 기록되며 자가 마이그레이션된다
    nonisolated static func isDownloaded(_ variant: String) -> Bool {
        guard folderIsComplete(modelFolderURL(for: variant)) else { return false }
        return hasDownloadMarker(variant) || allModelsReady
    }

    /// 지금 선택에 필요한 다운로드 목록 — 최초 설정이면 큐레이션 전체(+선택 모델),
    /// 이미 설정을 마쳤으면 선택 모델 하나만. 아직 안 받은 것만 남긴다 (크기 고지 시트의 근거)
    nonisolated static func missingModels(for selected: String) -> [String] {
        let target = selected.isEmpty ? WhisperEngine.defaultModel : selected
        var list = allModelsReady ? [target] : WhisperEngine.curatedModels
        if !list.contains(target) { list.append(target) }
        return list.filter { !isDownloaded($0) }
    }

    var statusLabel: String {
        switch phase {
        case .idle: "대기"
        case .downloading(let p): "다운로드 중 \(p)%"
        case .loading: "모델 불러오는 중…"
        case .optimizing: "뉴럴엔진 최적화 중…"
        case .ready: "준비됨"
        case .failed(let m): m
        }
    }
}
