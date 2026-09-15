import Foundation
import CoreML
import AVFoundation
import MLX

/// WhisperKit 이 다운로드해 둔 turbo 변환본(626MB 변형)의 MelSpectrogram/AudioEncoder
/// .mlmodelc 를 직접 로드해 실행한다 — 인코더는 재사용, 디코더만 MLX 로 대체하는 구조.
final class CoreMLFrontend {
    let mel: MLModel
    let encoder: MLModel

    /// 실제 OpenAI turbo 체크포인트에서 변환된 변형 (앱 기본 Whisper 모델 = 이미 다운로드됨)
    static let preferredVariant = "openai_whisper-large-v3-v20240930_626MB"

    private init(mel: MLModel, encoder: MLModel) {
        self.mel = mel
        self.encoder = encoder
    }

    /// WhisperKit 모델 저장소 로컬 폴더에서 변형 폴더를 찾는다
    static func modelFolder() -> URL? {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let repo = docs.appendingPathComponent("huggingface/models/argmaxinc/whisperkit-coreml", isDirectory: true)
        let preferred = repo.appendingPathComponent(preferredVariant, isDirectory: true)
        let fm = FileManager.default
        func complete(_ folder: URL) -> Bool {
            fm.fileExists(atPath: folder.appendingPathComponent("MelSpectrogram.mlmodelc").path)
                && fm.fileExists(atPath: folder.appendingPathComponent("AudioEncoder.mlmodelc").path)
        }
        if complete(preferred) { return preferred }
        // 폴백: 저장소 안의 아무 turbo 계열(1280d) 변형
        if let subdirs = try? fm.contentsOfDirectory(at: repo, includingPropertiesForKeys: nil) {
            for dir in subdirs where complete(dir) && dir.lastPathComponent.contains("v20240930") {
                return dir
            }
        }
        return nil
    }

    /// mel 은 ANE 금지가 핵심 — FFT 가 ANE fp16 에서 조용한 오디오에 침묵처럼 뭉개진 mel 을 만든다
    /// (기기에서 재현·확인, 2026-08-22). WhisperKit 기본값(melCompute: .cpuAndGPU)과 같은 이유.
    static func load(melUnits: MLComputeUnits = .cpuAndGPU,
                     encUnits: MLComputeUnits = .all) async throws -> CoreMLFrontend {
        guard let folder = modelFolder() else {
            throw AIError.http(0, "Whisper turbo 모델이 아직 없습니다 — 설정에서 전사 모델을 Whisper 로 바꿔 온보딩을 먼저 완료하세요.")
        }
        let melConfig = MLModelConfiguration()
        melConfig.computeUnits = melUnits
        let encConfig = MLModelConfiguration()
        encConfig.computeUnits = encUnits
        let mel = try MLModel(contentsOf: folder.appendingPathComponent("MelSpectrogram.mlmodelc"), configuration: melConfig)
        let encoder = try MLModel(contentsOf: folder.appendingPathComponent("AudioEncoder.mlmodelc"), configuration: encConfig)
        return CoreMLFrontend(mel: mel, encoder: encoder)
    }

    /// 인코더 출력 진단 통계 — 스케일·레이아웃·발화/패딩 대비를 한 번에 본다
    struct EncodeStats {
        var melShape: [Int] = []
        var melAbs: Float = 0
        var encShape: [Int] = []
        var encDType: String = ""
        var infCount: Int = 0
        var encAbs: Float = 0
        var encMax: Float = 0
        var speechAbs: Float = 0
        var padAbs: Float = 0
        var topFrame: Int = 0
        /// 반출용 원본 텐서 — CoreML 이 준 스칼라 순서 그대로의 [1280,1500]
        var raw: MLXArray? = nil
        /// 시간축이 살아있는지 보는 구조 지표 (LayerNorm 때문에 크기 통계로는 판별 불가)
        var adjSim: Float = 0     // 이웃 프레임 코사인 — 음성은 20ms 간격이라 높아야 정상
        var padSim: Float = 0     // 침묵 구간 두 프레임 — 거의 1.0 이어야 정상
        var crossSim: Float = 0   // 발화 vs 침묵 — padSim 보다 뚜렷이 낮아야 정상

        var line: String {
            let mel = melShape.map(String.init).joined(separator: "×")
            let enc = encShape.map(String.init).joined(separator: "×")
            return String(format: "mel %@ |mel|=%.3f · enc %@ %@ inf=%d |enc|=%.3f max=%.1f · 발화%.3f/패딩%.3f · 최대프레임 %d\n구조 이웃=%.3f 침묵쌍=%.3f 발화vs침묵=%.3f",
                          mel, melAbs, enc, encDType, infCount, encAbs, encMax, speechAbs, padAbs, topFrame,
                          adjSim, padSim, crossSim)
        }
    }

    /// 16k 모노 샘플(≤30초, 부족분 제로패딩) → (인코더 상태 [1, 1500, 1280], 진단 통계)
    func encode(samples16k: [Float]) async throws -> (states: MLXArray, stats: EncodeStats) {
        var stats = EncodeStats()

        // 1) 30초(480000 샘플)로 패딩
        let audioArray = try MLMultiArray(shape: [480000], dataType: .float32)
        let count = min(samples16k.count, 480_000)
        samples16k.withUnsafeBufferPointer { src in
            audioArray.dataPointer.withMemoryRebound(to: Float.self, capacity: 480_000) { dst in
                dst.update(from: src.baseAddress!, count: count)
                if count < 480_000 { (dst + count).update(repeating: 0, count: 480_000 - count) }
            }
        }

        // 2) 멜 스펙트로그램 (입력 "audio" → 출력 "melspectrogram_features")
        let melInput = try MLDictionaryFeatureProvider(dictionary: ["audio": MLFeatureValue(multiArray: audioArray)])
        let melOut = try await mel.prediction(from: melInput, options: MLPredictionOptions())
        guard let melFeatures = melOut.featureValue(for: "melspectrogram_features")?.multiArrayValue else {
            throw AIError.http(0, "멜 출력 없음")
        }
        stats.melShape = melFeatures.shape.map(\.intValue)
        let melScalars = Self.floats(melFeatures)
        stats.melAbs = melScalars.reduce(Float(0)) { $0 + abs($1) } / Float(max(1, melScalars.count))

        // 3) 인코더 (입력 "melspectrogram_features" → 출력 "encoder_output_embeds")
        let encInput = try MLDictionaryFeatureProvider(dictionary: ["melspectrogram_features": MLFeatureValue(multiArray: melFeatures)])
        let encOut = try await encoder.prediction(from: encInput, options: MLPredictionOptions())
        guard let embeds = encOut.featureValue(for: "encoder_output_embeds")?.multiArrayValue else {
            throw AIError.http(0, "인코더 출력 없음")
        }
        stats.encShape = embeds.shape.map(\.intValue)
        switch embeds.dataType {
        case .float16: stats.encDType = "fp16"
        case .float32: stats.encDType = "fp32"
        default: stats.encDType = "dt\(embeds.dataType.rawValue)"
        }
        guard embeds.count == 1280 * 1500 else {
            throw AIError.http(0, "인코더 출력 shape 이상: \(stats.encShape)")
        }

        // 4) [1,1280,1,1500] → MLXArray [1,1500,1280]. fp32 로 받아 통계를 정확히 낸다
        let scalars = Self.floats(embeds)
        guard !scalars.isEmpty else { throw AIError.http(0, "인코더 출력 dtype 미지원: \(stats.encDType)") }
        let raw = scalars.withUnsafeBufferPointer { MLXArray($0, [1280, 1500]) }
        stats.raw = raw.asType(.float16)
        let states = raw.transposed(1, 0).expandedDimensions(axis: 0)

        // 5) 통계는 전부 fp32 — fp16 누산은 190만 원소에서 곧바로 inf 가 되어 측정 자체가 망가진다
        let mag = MLX.abs(states)
        let perFrame = mag.mean(axis: -1)[0] // [1500]
        MLX.eval(perFrame)
        stats.infCount = MLX.isInf(raw).sum().item(Int.self)
        stats.encAbs = perFrame.mean().item(Float.self)
        stats.encMax = mag.max().item(Float.self)
        let speechFrames = max(1, min(1500, Int(Double(count) / 16000.0 * 50)))
        stats.speechAbs = perFrame[0 ..< speechFrames].mean().item(Float.self)
        stats.padAbs = speechFrames < 1500 ? perFrame[speechFrames ..< 1500].mean().item(Float.self) : 0
        stats.topFrame = MLX.argMax(perFrame).item(Int.self)

        // 6) 구조 지표 — 프레임 벡터를 단위화해 코사인 유사도를 본다.
        //    레이아웃이 맞으면 이웃 프레임은 닮고(음성은 연속), 침묵 구간 두 프레임은 거의 같다.
        //    축이 뒤섞이면 셋 다 0 근처로 무너진다.
        let frames = states[0] // [1500, 1280]
        let norms = MLX.sqrt((frames * frames).sum(axis: -1, keepDims: true))
        let unit = frames / MLX.maximum(norms, MLXArray(Float(1e-6)))
        MLX.eval(unit)
        let adjacent = (unit[0 ..< 1499] * unit[1 ..< 1500]).sum(axis: -1)
        let adjEnd = max(2, min(1499, speechFrames - 1))
        stats.adjSim = adjacent[0 ..< adjEnd].mean().item(Float.self)
        func cos(_ i: Int, _ j: Int) -> Float { (unit[i] * unit[j]).sum().item(Float.self) }
        let padA = min(1499, max(speechFrames + 20, 1200)), padB = 1450
        stats.padSim = padA < padB ? cos(padA, padB) : 0
        stats.crossSim = cos(min(speechFrames / 2, 1499), padB)

        return (states.asType(.float16), stats)
    }

    /// MLMultiArray → [Float] — 반드시 실제 dtype 으로 읽는다(재해석하면 값이 오염된다)
    private static func floats(_ m: MLMultiArray) -> [Float] {
        switch m.dataType {
        case .float16: return MLShapedArray<Float16>(m).scalars.map(Float.init)
        case .float32: return MLShapedArray<Float>(m).scalars
        case .double: return MLShapedArray<Double>(m).scalars.map(Float.init)
        default: return []
        }
    }
}

/// 저장된 녹음 파일(m4a 등)을 16k 모노 Float 샘플로 읽는다 — M2 대조 전사용
enum AudioFileLoader {
    static func loadSamples16k(url: URL, maxSec: Double) throws -> [Float] {
        let file = try AVAudioFile(forReading: url)
        let inFormat = file.processingFormat
        let totalFrames = AVAudioFrameCount(min(Double(file.length), inFormat.sampleRate * maxSec))
        guard totalFrames > 0 else { throw AIError.http(0, "오디오 길이 0 (\(file.length)프레임)") }
        guard let inBuf = AVAudioPCMBuffer(pcmFormat: inFormat, frameCapacity: totalFrames) else {
            throw AIError.http(0, "버퍼 생성 실패")
        }
        try file.read(into: inBuf, frameCount: totalFrames)
        guard inBuf.frameLength > 0 else { throw AIError.http(0, "파일 읽기 0프레임") }

        let outFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!
        guard let converter = AVAudioConverter(from: inFormat, to: outFormat) else {
            throw AIError.http(0, "컨버터 생성 실패")
        }

        // 표준 변환 루프 — 출력 버퍼를 청크 단위로 반복해 채운다
        var samples: [Float] = []
        samples.reserveCapacity(Int(Double(inBuf.frameLength) / inFormat.sampleRate * 16000) + 1600)
        var consumed = false
        while true {
            guard let chunk = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: 16384) else { break }
            var convError: NSError?
            let status = converter.convert(to: chunk, error: &convError) { _, inputStatus in
                if consumed {
                    inputStatus.pointee = .endOfStream
                    return nil
                }
                consumed = true
                inputStatus.pointee = .haveData
                return inBuf
            }
            if let convError { throw convError }
            if chunk.frameLength > 0, let channel = chunk.floatChannelData {
                samples.append(contentsOf: UnsafeBufferPointer(start: channel[0], count: Int(chunk.frameLength)))
            }
            if status == .endOfStream || status == .error { break }
            if chunk.frameLength == 0 { break }
        }
        guard !samples.isEmpty else { throw AIError.http(0, "변환 결과 0샘플") }
        return samples
    }

    /// 녹음 전체(최대 scanSec)에서 에너지가 가장 높은 windowSec 창을 골라 돌려준다 —
    /// 강의 녹음은 첫 부분이 침묵인 경우가 많아, 대조 전사는 실제 발화 구간으로 해야 한다
    static func loadBestWindow16k(url: URL, windowSec: Double, scanSec: Double) throws -> (samples: [Float], startSec: Int) {
        let all = try loadSamples16k(url: url, maxSec: scanSec)
        let window = Int(windowSec * 16000)
        guard all.count > window else { return (all, 0) }

        // 1초 단위 에너지 → 슬라이딩 합으로 최대 창 탐색
        let hop = 16000
        var energies: [Float] = []
        var i = 0
        while i + hop <= all.count {
            var energy: Float = 0
            for j in i..<(i + hop) { energy += all[j] * all[j] }
            energies.append(energy)
            i += hop
        }
        let winSecs = Int(windowSec)
        var bestStart = 0
        if energies.count > winSecs {
            var current = energies[0..<winSecs].reduce(0, +)
            var best = current
            for s in 1...(energies.count - winSecs) {
                current += energies[s + winSecs - 1] - energies[s - 1]
                if current > best {
                    best = current
                    bestStart = s
                }
            }
        }
        let start = bestStart * hop
        return (Array(all[start..<min(all.count, start + window)]), bestStart)
    }
}
