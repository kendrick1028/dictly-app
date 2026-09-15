import Foundation
import MLX
import MLXFast

/// whisper large-v3-turbo 텍스트 디코더(4층·1280d·20헤드)의 클린룸 MLX 구현.
/// 가중치는 mlx-community safetensors 의 decoder.* 키를 그대로 수동 매핑한다.
/// AlignAtt 게이팅을 위해 지정 층의 크로스어텐션 가중치를 밖으로 노출한다.
final class WhisperMLXDecoder {
    struct Layer {
        // self-attention (key 는 bias 없음 — whisper 구조 그대로)
        var attnQw, attnQb, attnKw, attnVw, attnVb, attnOw, attnOb: MLXArray
        var attnLnW, attnLnB: MLXArray
        // cross-attention
        var crossQw, crossQb, crossKw, crossVw, crossVb, crossOw, crossOb: MLXArray
        var crossLnW, crossLnB: MLXArray
        // mlp
        var mlp1w, mlp1b, mlp2w, mlp2b: MLXArray
        var mlpLnW, mlpLnB: MLXArray
    }

    /// 층별 셀프어텐션 KV 캐시 (k,v: [1, heads, T, headDim])
    final class KVCache {
        var k: MLXArray?
        var v: MLXArray?
        func append(_ newK: MLXArray, _ newV: MLXArray) {
            k = k.map { MLX.concatenated([$0, newK], axis: 2) } ?? newK
            v = v.map { MLX.concatenated([$0, newV], axis: 2) } ?? newV
        }
    }

    let tokenEmbedding: MLXArray   // [V, D]
    let posEmbedding: MLXArray     // [448, D]
    let layers: [Layer]
    let lnW: MLXArray
    let lnB: MLXArray

    let nHeads = 20
    let headDim = 64
    let dModel = 1280

    /// openai/whisper(MIT) 공개 상수에서 온 large-v3-turbo 정렬 헤드 (layer, head)
    static let alignmentHeads: [(layer: Int, head: Int)] = [(2, 4), (2, 11), (3, 3), (3, 6), (3, 11), (3, 14)]

    init(url: URL) throws {
        let weights = try MLX.loadArrays(url: url)
        func get(_ key: String) throws -> MLXArray {
            guard let arr = weights[key] else { throw AIError.http(0, "가중치 누락: \(key)") }
            return arr
        }
        tokenEmbedding = try get("decoder.token_embedding.weight")
        posEmbedding = try get("decoder.positional_embedding")
        lnW = try get("decoder.ln.weight")
        lnB = try get("decoder.ln.bias")
        var built: [Layer] = []
        for i in 0..<4 {
            let p = "decoder.blocks.\(i)."
            built.append(Layer(
                attnQw: try get(p + "attn.query.weight"), attnQb: try get(p + "attn.query.bias"),
                attnKw: try get(p + "attn.key.weight"),
                attnVw: try get(p + "attn.value.weight"), attnVb: try get(p + "attn.value.bias"),
                attnOw: try get(p + "attn.out.weight"), attnOb: try get(p + "attn.out.bias"),
                attnLnW: try get(p + "attn_ln.weight"), attnLnB: try get(p + "attn_ln.bias"),
                crossQw: try get(p + "cross_attn.query.weight"), crossQb: try get(p + "cross_attn.query.bias"),
                crossKw: try get(p + "cross_attn.key.weight"),
                crossVw: try get(p + "cross_attn.value.weight"), crossVb: try get(p + "cross_attn.value.bias"),
                crossOw: try get(p + "cross_attn.out.weight"), crossOb: try get(p + "cross_attn.out.bias"),
                crossLnW: try get(p + "cross_attn_ln.weight"), crossLnB: try get(p + "cross_attn_ln.bias"),
                mlp1w: try get(p + "mlp1.weight"), mlp1b: try get(p + "mlp1.bias"),
                mlp2w: try get(p + "mlp2.weight"), mlp2b: try get(p + "mlp2.bias"),
                mlpLnW: try get(p + "mlp_ln.weight"), mlpLnB: try get(p + "mlp_ln.bias")
            ))
        }
        layers = built
        MLX.eval([tokenEmbedding, posEmbedding, lnW, lnB])
    }

    // MARK: 기본 연산

    private func linear(_ x: MLXArray, _ w: MLXArray, _ b: MLXArray?) -> MLXArray {
        let y = MLX.matmul(x, w.T)
        return b.map { y + $0 } ?? y
    }

    private func layerNorm(_ x: MLXArray, _ w: MLXArray, _ b: MLXArray) -> MLXArray {
        MLXFast.layerNorm(x, weight: w, bias: b, eps: 1e-5)
    }

    /// [B, T, D] → [B, heads, T, headDim]
    private func splitHeads(_ x: MLXArray) -> MLXArray {
        let shape = x.shape
        return x.reshaped([shape[0], shape[1], nHeads, headDim]).transposed(0, 2, 1, 3)
    }

    /// [B, heads, T, headDim] → [B, T, D]
    private func mergeHeads(_ x: MLXArray) -> MLXArray {
        let shape = x.shape
        return x.transposed(0, 2, 1, 3).reshaped([shape[0], shape[2], dModel])
    }

    // MARK: 크로스어텐션 K/V 사전계산 (인코더 상태는 스텝 동안 불변)

    /// encoder [1, 1500, D] → 층별 (k, v) [1, heads, 1500, headDim]
    func crossKV(encoder: MLXArray) -> [(k: MLXArray, v: MLXArray)] {
        let result = layers.map { layer in
            (k: splitHeads(linear(encoder, layer.crossKw, nil)),
             v: splitHeads(linear(encoder, layer.crossVw, layer.crossVb)))
        }
        MLX.eval(result.flatMap { [$0.k, $0.v] })
        return result
    }

    // MARK: forward

    /// 토큰 시퀀스 전체를 한 번에 전개 (프리픽스). KV 캐시를 채우고 전 위치 로짓을 돌려준다.
    func forwardPrefix(tokens: [Int], encKV: [(k: MLXArray, v: MLXArray)], caches: [KVCache]) -> MLXArray {
        let t = tokens.count
        var x = tokenEmbedding[MLXArray(tokens.map { Int32($0) })] + posEmbedding[0..<t]
        x = x.expandedDimensions(axis: 0) // [1, T, D]

        // causal additive mask [T, T] — 대각 위(미래)만 -1e9
        let mask = MLX.triu(MLXArray.full([t, t], values: MLXArray(Float(-1e9))), k: 1).asType(x.dtype)

        for (i, layer) in layers.enumerated() {
            // self-attention
            let normed = layerNorm(x, layer.attnLnW, layer.attnLnB)
            let q = splitHeads(linear(normed, layer.attnQw, layer.attnQb))
            let k = splitHeads(linear(normed, layer.attnKw, nil))
            let v = splitHeads(linear(normed, layer.attnVw, layer.attnVb))
            caches[i].append(k, v)
            let attnOut = MLXFast.scaledDotProductAttention(
                queries: q, keys: caches[i].k!, values: caches[i].v!,
                scale: 1 / Float(headDim).squareRoot(), mask: mask)
            x = x + linear(mergeHeads(attnOut), layer.attnOw, layer.attnOb)

            // cross-attention
            let crossNormed = layerNorm(x, layer.crossLnW, layer.crossLnB)
            let cq = splitHeads(linear(crossNormed, layer.crossQw, layer.crossQb))
            let crossOut = MLXFast.scaledDotProductAttention(
                queries: cq, keys: encKV[i].k, values: encKV[i].v,
                scale: 1 / Float(headDim).squareRoot(), mask: nil)
            x = x + linear(mergeHeads(crossOut), layer.crossOw, layer.crossOb)

            // mlp
            let mlpNormed = layerNorm(x, layer.mlpLnW, layer.mlpLnB)
            x = x + linear(MLXNNGelu(linear(mlpNormed, layer.mlp1w, layer.mlp1b)), layer.mlp2w, layer.mlp2b)
        }
        x = layerNorm(x, lnW, lnB)
        let logits = MLX.matmul(x, tokenEmbedding.T) // [1, T, V]
        MLX.eval(logits)
        MLX.eval(caches.flatMap { [$0.k!, $0.v!] })
        return logits
    }

    /// 단일 토큰 스텝. 로짓과 (요청 시) 정렬 헤드 평균 크로스어텐션 [1500]을 돌려준다.
    func step(token: Int, position: Int, encKV: [(k: MLXArray, v: MLXArray)],
              caches: [KVCache], captureAlignment: Bool) -> (logits: MLXArray, alignment: MLXArray?) {
        var x = tokenEmbedding[MLXArray([Int32(token)])] + posEmbedding[position..<(position + 1)]
        x = x.expandedDimensions(axis: 0) // [1, 1, D]

        var alignmentRows: [MLXArray] = []
        let wantedByLayer = Dictionary(grouping: Self.alignmentHeads, by: \.layer)

        for (i, layer) in layers.enumerated() {
            let normed = layerNorm(x, layer.attnLnW, layer.attnLnB)
            let q = splitHeads(linear(normed, layer.attnQw, layer.attnQb))
            let k = splitHeads(linear(normed, layer.attnKw, nil))
            let v = splitHeads(linear(normed, layer.attnVw, layer.attnVb))
            caches[i].append(k, v)
            let attnOut = MLXFast.scaledDotProductAttention(
                queries: q, keys: caches[i].k!, values: caches[i].v!,
                scale: 1 / Float(headDim).squareRoot(), mask: nil)
            x = x + linear(mergeHeads(attnOut), layer.attnOw, layer.attnOb)

            let crossNormed = layerNorm(x, layer.crossLnW, layer.crossLnB)
            let cq = splitHeads(linear(crossNormed, layer.crossQw, layer.crossQb))
            let crossOut = MLXFast.scaledDotProductAttention(
                queries: cq, keys: encKV[i].k, values: encKV[i].v,
                scale: 1 / Float(headDim).squareRoot(), mask: nil)
            x = x + linear(mergeHeads(crossOut), layer.crossOw, layer.crossOb)

            // 정렬 헤드가 있는 층만 크로스어텐션 가중치를 명시 계산 (1×heads×1×1500 한 번)
            if captureAlignment, let heads = wantedByLayer[i] {
                let scores = MLX.matmul(cq * MLXArray(Float(1) / Float(headDim).squareRoot()),
                                        encKV[i].k.transposed(0, 1, 3, 2)) // [1, heads, 1, 1500]
                let probs = MLX.softmax(scores, axis: -1)
                for (_, head) in heads {
                    alignmentRows.append(probs[0, head, 0])
                }
            }

            let mlpNormed = layerNorm(x, layer.mlpLnW, layer.mlpLnB)
            x = x + linear(MLXNNGelu(linear(mlpNormed, layer.mlp1w, layer.mlp1b)), layer.mlp2w, layer.mlp2b)
        }
        x = layerNorm(x, lnW, lnB)
        let logits = MLX.matmul(x, tokenEmbedding.T)[0, 0] // [V]

        var alignment: MLXArray?
        if captureAlignment, !alignmentRows.isEmpty {
            alignment = MLX.stacked(alignmentRows, axis: 0).mean(axis: 0) // [1500]
        }
        return (logits, alignment)
    }

    // MARK: 그리디 디코드 (M2 오프라인 대조·M3 스트리밍 공용)

    struct DecodeResult {
        var tokens: [Int]
        /// 각 생성 토큰의 정렬 argmax 프레임 (20ms×2 = 프레임당 20ms, 1500프레임/30초)
        var alignFrames: [Int]
        var noSpeechProb: Float
    }

    // MARK: AlignAtt 게이트 디코드 (M3 스트리밍)

    struct GatedResult {
        var tokens: [Int]          // 확정 토큰 (보류 후보는 미포함)
        var alignFrames: [Int]     // 확정 토큰별 정렬 argmax (유효 프레임 내)
        var held: Bool             // 마지막 후보가 게이트에 걸려 보류됐는가
        var hitEOT: Bool
        var noSpeechProb: Float
    }

    /// 스트리밍 스텝용 게이트 디코드: 새 토큰의 정렬 argmax([0, validFrames) 로 제한)가
    /// 마지막 holdFrames 안이면 그 토큰을 버리고 멈춘다 — 아직 오디오 증거가 부족하다는 뜻.
    /// 어텐션 K/V 는 전체 1500프레임 유지(패딩 잘라내기는 학습 분포 밖 — M2에서 실측 확인),
    /// 게이트의 argmax "범위"만 유효 프레임으로 제한한다.
    func gatedDecode(encKV: [(k: MLXArray, v: MLXArray)],
                     prompt: [Int],
                     suppressMask: MLXArray,
                     firstTokenExtraSuppress: MLXArray?,
                     noSpeechToken: Int,
                     eotToken: Int,
                     validFrames: Int,
                     holdFrames: Int,
                     maxNewTokens: Int,
                     sotIndex: Int = 0) -> GatedResult {
        let caches = layers.map { _ in KVCache() }
        let prefixLogits = forwardPrefix(tokens: prompt, encKV: encKV, caches: caches)
        let sotProbs = MLX.softmax(prefixLogits[0, sotIndex].asType(.float32), axis: -1)
        let noSpeechProb = sotProbs[noSpeechToken].item(Float.self)

        var tokens: [Int] = []
        var alignFrames: [Int] = []
        var held = false, hitEOT = false
        var lastLogits = prefixLogits[0, prompt.count - 1].asType(.float32)
        let bound = max(1, validFrames - holdFrames)

        for stepIndex in 0..<maxNewTokens {
            var masked = lastLogits + suppressMask
            if stepIndex == 0, let extra = firstTokenExtraSuppress { masked = masked + extra }
            let next = MLX.argMax(masked).item(Int.self)
            if next == eotToken { hitEOT = true; break }

            let out = step(token: next, position: prompt.count + stepIndex,
                           encKV: encKV, caches: caches, captureAlignment: true)
            if let alignment = out.alignment {
                let frame = MLX.argMax(alignment[0..<validFrames]).item(Int.self)
                if frame >= bound { held = true; break }   // 후보 보류 — tokens 에 미포함
                alignFrames.append(frame)
            }
            tokens.append(next)
            lastLogits = out.logits.asType(.float32)
        }
        return GatedResult(tokens: tokens, alignFrames: alignFrames,
                           held: held, hitEOT: hitEOT, noSpeechProb: noSpeechProb)
    }

    /// prompt 이후를 그리디로 디코드한다. suppressMask 는 로짓에 더해지는 [V] 벡터(-1e9 = 금지).
    func greedyDecode(encKV: [(k: MLXArray, v: MLXArray)],
                      prompt: [Int],
                      suppressMask: MLXArray,
                      firstTokenExtraSuppress: MLXArray?,
                      noSpeechToken: Int,
                      eotToken: Int,
                      maxNewTokens: Int,
                      captureAlignment: Bool,
                      sotIndex: Int = 0,
                      temperature: Float = 0) -> DecodeResult {
        let caches = layers.map { _ in KVCache() }
        let prefixLogits = forwardPrefix(tokens: prompt, encKV: encKV, caches: caches)

        // 무음 게이트용: sot 위치 로짓에서 <|nospeech|> 확률 (컨텍스트 조건화 시 sot 는 0 이 아님)
        let sotProbs = MLX.softmax(prefixLogits[0, sotIndex].asType(.float32), axis: -1)
        let noSpeechProb = sotProbs[noSpeechToken].item(Float.self)

        var tokens: [Int] = []
        var alignFrames: [Int] = []
        var lastLogits = prefixLogits[0, prompt.count - 1].asType(.float32)

        for stepIndex in 0..<maxNewTokens {
            var masked = lastLogits + suppressMask
            if stepIndex == 0, let extra = firstTokenExtraSuppress { masked = masked + extra }
            let next: Int
            if temperature > 0 {
                // 온도 폴백용 멀티노미얼 샘플링 — 반복 붕괴 탈출 (whisper 표준)
                let probs: [Float] = MLX.softmax(masked / temperature, axis: -1).asArray(Float.self)
                let r = Float.random(in: 0..<1)
                var acc: Float = 0
                var pick = probs.count - 1
                for (i, v) in probs.enumerated() {
                    acc += v
                    if acc >= r { pick = i; break }
                }
                next = pick
            } else {
                next = MLX.argMax(masked).item(Int.self)
            }
            if next == eotToken { break }
            tokens.append(next)

            let out = step(token: next, position: prompt.count + stepIndex,
                           encKV: encKV, caches: caches, captureAlignment: captureAlignment)
            if captureAlignment, let alignment = out.alignment {
                alignFrames.append(MLX.argMax(alignment).item(Int.self))
            }
            lastLogits = out.logits.asType(.float32)
            MLX.eval(lastLogits)
        }
        return DecodeResult(tokens: tokens, alignFrames: alignFrames, noSpeechProb: noSpeechProb)
    }
}

/// GELU (mlx-swift 의 nn 게이트 없이 직접) — whisper 는 tanh 근사가 아닌 정확 GELU 를 쓴다
@inline(__always)
func MLXNNGelu(_ x: MLXArray) -> MLXArray {
    // 0.5x(1+erf(x/√2))
    x * 0.5 * (1 + MLX.erf(x / Float(2).squareRoot()))
}
