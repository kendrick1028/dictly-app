import Foundation
import MLX

/// mlx-community/whisper-large-v3-turbo 의 weights.safetensors(1.6GB)에서
/// decoder.* 텐서(~328MB)만 HTTP Range 로 잘라 받아, 독립적으로 유효한
/// safetensors 파일로 재조립한다.
enum SafetensorsFetch {
    static let remoteURL = URL(string: "https://huggingface.co/mlx-community/whisper-large-v3-turbo/resolve/main/weights.safetensors")!
    static let doneKey = "lightningDL.decoder.v1"

    static var localURL: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = docs.appendingPathComponent("huggingface/models/mlx-community/whisper-large-v3-turbo", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("decoder.safetensors")
    }

    static var isDownloaded: Bool {
        UserDefaults.standard.bool(forKey: doneKey)
            && FileManager.default.fileExists(atPath: localURL.path)
    }

    struct TensorInfo {
        var key: String
        var dtype: String
        var shape: [Int]
        var start: Int64
        var end: Int64
        var byteCount: Int64 { end - start }
    }

    /// 디코더 가중치를 내려받아 로컬 safetensors 로 조립한다. 이미 있으면 즉시 반환.
    static func fetchDecoder(progress: @escaping @MainActor @Sendable (Double, String) -> Void) async throws -> URL {
        if isDownloaded { return localURL }

        await progress(0, "가중치 목록 확인 중…")
        let tensors = try await decoderTensors()
        let totalBytes = tensors.reduce(Int64(0)) { $0 + $1.byteCount }

        // 새 헤더: 키·dtype·shape 는 그대로, offsets 만 순차 재배치
        var newHeader: [String: Any] = [:]
        var cursor: Int64 = 0
        for tensor in tensors {
            newHeader[tensor.key] = [
                "dtype": tensor.dtype,
                "shape": tensor.shape,
                "data_offsets": [cursor, cursor + tensor.byteCount]
            ]
            cursor += tensor.byteCount
        }
        let headerData = try JSONSerialization.data(withJSONObject: newHeader)
        var headerLen = UInt64(headerData.count).littleEndian

        // MLX 로더는 확장자로 포맷을 판별한다 — 임시 파일도 .safetensors 로 끝나야 검증 로드가 된다
        let tmpURL = localURL.deletingLastPathComponent().appendingPathComponent("decoder-tmp.safetensors")
        try? FileManager.default.removeItem(at: tmpURL)
        FileManager.default.createFile(atPath: tmpURL.path, contents: nil)
        let handle = try FileHandle(forWritingTo: tmpURL)
        defer { try? handle.close() }
        try handle.write(contentsOf: Data(bytes: &headerLen, count: 8))
        try handle.write(contentsOf: headerData)

        // 파일 내 위치순으로 정렬 후, 간격 4MB 이하는 한 요청으로 병합
        let sorted = tensors.sorted { $0.start < $1.start }
        var spans: [(from: Int64, to: Int64)] = []
        for tensor in sorted {
            if var last = spans.last, tensor.start - last.to <= 4_194_304 {
                last.to = max(last.to, tensor.end)
                spans[spans.count - 1] = last
            } else {
                spans.append((tensor.start, tensor.end))
            }
        }

        // 스팬을 받아 메모리에 모은 뒤, "텐서 정의 순서"대로 잘라 파일에 쓴다
        var spanData: [Int: Data] = [:]
        var downloaded: Int64 = 0
        for (index, span) in spans.enumerated() {
            await progress(Double(downloaded) / Double(totalBytes),
                           "디코더 가중치 다운로드 \(Int(Double(downloaded) / Double(totalBytes) * 100))%")
            let data = try await ranged(remoteURL, from: span.from, to: span.to - 1)
            guard Int64(data.count) == span.to - span.from else {
                throw AIError.http(0, "다운로드 크기 불일치 (스팬 \(index))")
            }
            spanData[index] = data
            downloaded += Int64(data.count)
        }

        func spanIndex(containing offset: Int64) -> Int? {
            spans.firstIndex { offset >= $0.from && offset < $0.to }
        }

        for tensor in tensors {
            guard let si = spanIndex(containing: tensor.start), let data = spanData[si] else {
                throw AIError.http(0, "스팬 매핑 실패: \(tensor.key)")
            }
            let lo = Int(tensor.start - spans[si].from)
            let hi = lo + Int(tensor.byteCount)
            try handle.write(contentsOf: data.subdata(in: lo..<hi))
            // 크기 검증: fp16 = 요소수 × 2바이트
            let expected = tensor.shape.reduce(1, *) * 2
            guard expected == Int(tensor.byteCount) else {
                throw AIError.http(0, "텐서 크기 이상: \(tensor.key)")
            }
        }
        try handle.close()

        // MLX 라운드트립 검증 후 확정
        await progress(0.98, "가중치 검증 중…")
        let arrays = try MLX.loadArrays(url: tmpURL)
        guard arrays.count == tensors.count,
              arrays["decoder.token_embedding.weight"] != nil else {
            throw AIError.http(0, "재조립 파일 검증 실패")
        }
        try? FileManager.default.removeItem(at: localURL)
        try FileManager.default.moveItem(at: tmpURL, to: localURL)
        UserDefaults.standard.set(true, forKey: doneKey)
        await progress(1, "완료")
        return localURL
    }

    /// 원격 헤더에서 decoder.* 텐서 목록을 읽는다
    static func decoderTensors() async throws -> [TensorInfo] {
        let lenData = try await ranged(remoteURL, from: 0, to: 7)
        let headerLen = lenData.withUnsafeBytes { $0.load(as: UInt64.self) }.littleEndian
        guard headerLen > 0, headerLen < 50_000_000 else { throw AIError.http(0, "헤더 길이 이상") }
        let headerData = try await ranged(remoteURL, from: 8, to: 8 + Int64(headerLen) - 1)
        guard let json = try JSONSerialization.jsonObject(with: headerData) as? [String: Any] else {
            throw AIError.http(0, "헤더 JSON 파싱 실패")
        }
        let dataStart = Int64(8) + Int64(headerLen)
        var result: [TensorInfo] = []
        for (key, value) in json where key.hasPrefix("decoder.") {
            guard let dict = value as? [String: Any],
                  let dtype = dict["dtype"] as? String,
                  let shape = dict["shape"] as? [Int],
                  let offsets = dict["data_offsets"] as? [NSNumber], offsets.count == 2 else { continue }
            result.append(TensorInfo(key: key, dtype: dtype, shape: shape,
                                     start: dataStart + offsets[0].int64Value,
                                     end: dataStart + offsets[1].int64Value))
        }
        guard result.count >= 90 else { throw AIError.http(0, "decoder 텐서가 부족함(\(result.count))") }
        return result
    }

    private static func ranged(_ url: URL, from: Int64, to: Int64) async throws -> Data {
        var req = URLRequest(url: url)
        req.setValue("bytes=\(from)-\(to)", forHTTPHeaderField: "Range")
        req.timeoutInterval = 300
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard code == 206 else { throw AIError.http(code, "Range 요청 실패") }
        return data
    }
}
