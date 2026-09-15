import Foundation

/// Dictly 앱의 AIError 최소 쉼 — 프로브에서 필요한 케이스만
enum AIError: LocalizedError {
    case http(Int, String)
    var errorDescription: String? {
        if case let .http(code, msg) = self { return "[\(code)] \(msg)" }
        return nil
    }
}
