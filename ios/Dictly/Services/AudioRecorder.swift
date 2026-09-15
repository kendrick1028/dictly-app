import Foundation
import AVFoundation

/// Microphone capture via AVAudioEngine. Buffers are simultaneously
/// (1) appended to an .m4a take file and (2) forwarded to the transcription engine.
/// Callbacks fire on the audio tap thread — hop to the main actor yourself.
final class AudioRecorder: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private var file: AVAudioFile?
    private var fileConverter: AVAudioConverter?
    private var paused = false
    private var framesWritten: Double = 0
    private var sampleRate: Double = 48000

    /// forwarded mic buffer (tap thread; not called while paused)
    var onBuffer: (@Sendable (AVAudioPCMBuffer) -> Void)?
    /// 0…1 smoothed input level (tap thread)
    var onLevel: (@Sendable (Float) -> Void)?

    /// seconds of audio actually written (pause-aware)
    var elapsed: Double { framesWritten / max(1, sampleRate) }

    static func requestMicPermission() async -> Bool {
        await AVAudioApplication.requestRecordPermission()
    }

    /// activate the record session early (before model prep) so CoreAudio is warm
    /// by the time the engine's input node is first touched
    static func activateSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.defaultToSpeaker, .allowBluetoothHFP])
        try session.setActive(true, options: [])
        guard session.isInputAvailable else {
            throw NSError(domain: "Dictly", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "마이크 입력을 사용할 수 없습니다. (시뮬레이터라면 I/O → Audio Input 설정을 확인하세요)"
            ])
        }
    }

    func start(writingTo url: URL) throws {
        try Self.activateSession()

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        sampleRate = format.sampleRate
        framesWritten = 0
        paused = false

        file = try AVAudioFile(forWriting: url, settings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: format.sampleRate,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ])

        input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
            guard let self, !self.paused else { return }
            self.write(buffer)
            self.onBuffer?(buffer)
            self.onLevel?(Self.rmsLevel(buffer))
        }

        engine.prepare()
        try engine.start()
    }

    private func write(_ buffer: AVAudioPCMBuffer) {
        guard let file else { return }
        do {
            if buffer.format == file.processingFormat {
                try file.write(from: buffer)
                framesWritten += Double(buffer.frameLength)
            } else {
                // e.g. stereo/interleaved input → convert to the file's mono processing format
                if fileConverter == nil || fileConverter?.inputFormat != buffer.format {
                    fileConverter = AVAudioConverter(from: buffer.format, to: file.processingFormat)
                }
                guard let conv = fileConverter else { return }
                let ratio = file.processingFormat.sampleRate / buffer.format.sampleRate
                let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 64
                guard let out = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: capacity) else { return }
                var fed = false
                var err: NSError?
                conv.convert(to: out, error: &err) { _, status in
                    if fed { status.pointee = .noDataNow; return nil }
                    fed = true
                    status.pointee = .haveData
                    return buffer
                }
                if err == nil, out.frameLength > 0 {
                    try file.write(from: out)
                    framesWritten += Double(buffer.frameLength) // count source frames for wall-clock accuracy
                }
            }
        } catch {
            // a dropped buffer is preferable to crashing the tap thread
        }
    }

    func pause() { paused = true }
    func resume() { paused = false }

    /// returns the recorded duration in seconds
    @discardableResult
    func stop() -> Double {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        let duration = elapsed
        file = nil // closes the take file
        fileConverter = nil
        return duration
    }

    private static func rmsLevel(_ buffer: AVAudioPCMBuffer) -> Float {
        guard let data = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }
        var sum: Float = 0
        let n = Int(buffer.frameLength)
        for i in 0..<n { sum += data[i] * data[i] }
        let rms = sqrtf(sum / Float(n))
        let db = 20 * log10f(max(rms, 1e-7))
        // map −55 dB…0 dB → 0…1
        return max(0, min(1, (db + 55) / 55))
    }
}
