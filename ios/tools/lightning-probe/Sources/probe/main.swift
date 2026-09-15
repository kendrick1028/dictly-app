import Foundation
import MLX
import MLXFast
import CoreML

// 프로브: 앱과 동일한 Lightning 소스(WhisperMLXDecoder/CoreMLFrontend/SafetensorsFetch 원본 복사)를
// macOS 에서 레퍼런스(mlx_whisper) 덤프와 대조한다.
// 모드: diff(기본) — 층별 수치 대조 · coreml — 폰 파이프라인 재현 · reassemble — 가중치 재조립 검증
struct Config: Codable {
    let prompt: [Int]; let eot: Int; let nospeech: Int
    let special_begin: Int; let ws: Int; let ref_tokens: [Int]; let vocab: Int
}

let dir = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ".")
let mode = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "diff"
let cfg = try JSONDecoder().decode(Config.self, from: Data(contentsOf: dir.appendingPathComponent("config.json")))
let dumps = try MLX.loadArrays(url: dir.appendingPathComponent("ref_dumps.safetensors"))

func diff(_ a: MLXArray, _ b: MLXArray, _ label: String) {
    let x = a.asType(.float32), y = b.asType(.float32)
    let d = MLX.abs(x - y)
    print(String(format: "%-16@ maxAbs=%.5f meanAbs=%.6f (ref|x|=%.4f)",
                 label as NSString, d.max().item(Float.self), d.mean().item(Float.self),
                 MLX.abs(y).mean().item(Float.self)))
}

func greedy(_ decoder: WhisperMLXDecoder, _ states: MLXArray, tag: String) {
    let encKV = decoder.crossKV(encoder: states)
    var suppress = [Float](repeating: 0, count: cfg.vocab)
    for id in cfg.special_begin..<cfg.vocab where id != cfg.eot { suppress[id] = -1e9 }
    var first = [Float](repeating: 0, count: cfg.vocab)
    first[cfg.ws] = -1e9; first[cfg.eot] = -1e9
    let result = decoder.greedyDecode(
        encKV: encKV, prompt: cfg.prompt,
        suppressMask: MLXArray(suppress), firstTokenExtraSuppress: MLXArray(first),
        noSpeechToken: cfg.nospeech, eotToken: cfg.eot,
        maxNewTokens: 120, captureAlignment: true)
    let matched = zip(result.tokens, cfg.ref_tokens).prefix(while: ==).count
    print("[\(tag)] tokens=\(result.tokens.count) ref일치=\(matched)/\(cfg.ref_tokens.count) nospeech=\(String(format: "%.2e", result.noSpeechProb))")
    print("[\(tag)] ids: \(Array(result.tokens.prefix(24)))")
    print("[\(tag)] align: \(Array(result.alignFrames.prefix(15)))")
}

switch mode {
case "coreml":
    // 폰 파이프라인 재현: CoreML mel+encoder → MLX 디코더 (클린 가중치)
    let decoder = try WhisperMLXDecoder(url: dir.appendingPathComponent("decoder_ref.safetensors"))
    let frontend = try await CoreMLFrontend.load()
    let samples = try AudioFileLoader.loadSamples16k(url: dir.appendingPathComponent("test.wav"), maxSec: 30)
    print("samples:", samples.count)
    let (encoded, stats) = try await frontend.encode(samples16k: samples)
    print("stats:", stats.line)
    diff(encoded, dumps["encoder_states"]!, "coremlEnc vs mlxEnc")
    greedy(decoder, encoded, tag: "CoreML enc")
    greedy(decoder, dumps["encoder_states"]!, tag: "MLX enc")

case "phone":
    // 폰 반출 텐서 검증: ① 폰 enc_final 을 클린 가중치로 디코드 ② 같은 오디오를 Mac CoreML 로 재인코딩해 대조
    let decoder = try WhisperMLXDecoder(url: dir.appendingPathComponent("decoder_ref.safetensors"))
    let phoneDir = dir.appendingPathComponent("phone-dump")
    func readF16(_ name: String, _ shape: [Int]) throws -> MLXArray {
        let data = try Data(contentsOf: phoneDir.appendingPathComponent(name))
        let vals = data.withUnsafeBytes { Array($0.bindMemory(to: Float16.self)) }
        precondition(vals.count == shape.reduce(1, *), "\(name) 크기 불일치: \(vals.count)")
        return vals.withUnsafeBufferPointer { MLXArray($0, shape) }
    }
    let phoneEnc = try readF16("enc_final.bin", [1, 1500, 1280])
    let phoneRaw = try readF16("raw.bin", [1280, 1500])
    let sData = try Data(contentsOf: phoneDir.appendingPathComponent("samples.bin"))
    let samples = sData.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
    print("samples:", samples.count, "enc |x|=", MLX.abs(phoneEnc.asType(.float32)).mean().item(Float.self))
    // raw 재구성 일관성: transpose(raw) == enc_final 이어야 함
    let rebuilt = phoneRaw.transposed(1, 0).expandedDimensions(axis: 0)
    diff(rebuilt, phoneEnc, "raw→enc 재구성")
    greedy(decoder, phoneEnc, tag: "폰 인코더 상태")
    // 같은 오디오를 Mac CoreML 로 인코딩해 폰 상태와 대조
    let frontend = try await CoreMLFrontend.load()
    let (macEnc, macStats) = try await frontend.encode(samples16k: samples)
    print("Mac 재인코딩:", macStats.line)
    diff(macEnc, phoneEnc, "MacEnc vs 폰Enc")
    greedy(decoder, macEnc, tag: "Mac 재인코딩")

case "melane":
    // 기제 재현: 같은 폰 샘플을 mel=ANE 로 인코딩하면 mel 이 뭉개지는가
    let decoder = try WhisperMLXDecoder(url: dir.appendingPathComponent("decoder_ref.safetensors"))
    let sData = try Data(contentsOf: dir.appendingPathComponent("phone-dump/samples.bin"))
    let samples = sData.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
    for (tag, units) in [("GPU", MLComputeUnits.cpuAndGPU), ("ANE", MLComputeUnits.cpuAndNeuralEngine)] {
        let fe = try await CoreMLFrontend.load(melUnits: units, encUnits: .cpuAndGPU)
        let (enc, st) = try await fe.encode(samples16k: samples)
        print("[mel=\(tag)] \(st.line)")
        greedy(decoder, enc, tag: "mel=\(tag)")
    }

case "reassemble":
    // 앱과 동일 코드로 328MB 부분 다운로드+재조립 → 텐서 바이트 대조 → 디코드
    UserDefaults.standard.removeObject(forKey: SafetensorsFetch.doneKey)
    try? FileManager.default.removeItem(at: SafetensorsFetch.localURL)
    let url = try await SafetensorsFetch.fetchDecoder { frac, label in
        if Int(frac * 20) != Int((frac - 0.01) * 20) { print("  \(label)") }
    }
    print("reassembled:", url.path)
    let clean = try MLX.loadArrays(url: dir.appendingPathComponent("decoder_ref.safetensors"))
    let rebuilt = try MLX.loadArrays(url: url)
    var bad = 0
    for (key, cleanArr) in clean {
        guard let r = rebuilt[key] else { print("누락:", key); bad += 1; continue }
        let d = MLX.abs(cleanArr.asType(.float32) - r.asType(.float32)).max().item(Float.self)
        if d != 0 { print("불일치:", key, "maxAbs=", d); bad += 1 }
    }
    print(bad == 0 ? "재조립 100개 텐서 전부 바이트 일치 ✅" : "불일치 텐서 \(bad)개 ❌")
    let decoder = try WhisperMLXDecoder(url: url)
    greedy(decoder, dumps["encoder_states"]!, tag: "재조립 가중치")

case "synthetic":
    // 결정적 합성 인코더 상태(임베딩 행 재활용)로 디코더+커널만 순수 검증 — 기기와 결과 비교용
    let decoder = try WhisperMLXDecoder(url: dir.appendingPathComponent("decoder_ref.safetensors"))
    let synth = (decoder.tokenEmbedding[0 ..< 1500] * 30).asType(.float16).expandedDimensions(axis: 0)
    MLX.eval(synth)
    print("synth |x|=", MLX.abs(synth.asType(.float32)).mean().item(Float.self))
    let encKV = decoder.crossKV(encoder: synth)
    var suppress = [Float](repeating: 0, count: cfg.vocab)
    for id in cfg.special_begin..<cfg.vocab { suppress[id] = -1e9 }   // EOT 포함 전부 금지 → 24토큰 강제
    let r = decoder.greedyDecode(
        encKV: encKV, prompt: cfg.prompt,
        suppressMask: MLXArray(suppress), firstTokenExtraSuppress: nil,
        noSpeechToken: cfg.nospeech, eotToken: -1,
        maxNewTokens: 24, captureAlignment: true)
    print("[합성] ids:", r.tokens)
    print("[합성] align:", r.alignFrames)
    print("[합성] nospeech:", String(format: "%.3e", r.noSpeechProb))

default:
    let decoder = try WhisperMLXDecoder(url: dir.appendingPathComponent("decoder_ref.safetensors"))
    greedy(decoder, dumps["encoder_states"]!, tag: "클린")
    let caches2 = decoder.layers.map { _ in WhisperMLXDecoder.KVCache() }
    let encKV = decoder.crossKV(encoder: dumps["encoder_states"]!)
    let pl = decoder.forwardPrefix(tokens: cfg.prompt, encKV: encKV, caches: caches2)
    diff(pl[0], dumps["prefix_logits"]!, "prefix_logits")
}
