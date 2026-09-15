import Foundation
import Observation

/// which model backend performs a task
enum EngineChoice: String, CaseIterable, Identifiable {
    // 표시 순서 = 이 순서 (Apple 은 온디바이스라 맨 앞)
    case apple, openai, anthropic, gemini, grok
    var id: String { rawValue }
    var label: String {
        switch self {
        case .apple: "Apple Intelligence"
        case .openai: "GPT"
        case .anthropic: "Claude"
        case .gemini: "Gemini"
        case .grok: "Grok"
        }
    }
    var short: String { label == "Apple Intelligence" ? "Apple" : label }
    /// 키체인 계정명 (apple 은 키가 없다)
    var account: String? {
        switch self {
        case .apple: nil
        case .openai: "openai"
        case .anthropic: "anthropic"
        case .gemini: "gemini"
        case .grok: "grok"
        }
    }
}

/// which engine performs speech-to-text
enum SttEngineChoice: String, CaseIterable, Identifiable {
    case whisper, gptAPI
    var id: String { rawValue }
    var label: String {
        switch self {
        case .whisper: "Whisper 로컬"
        case .gptAPI: "GPT 실시간 전사"
        }
    }
}

@MainActor
@Observable
final class AppSettings {
    private let d = UserDefaults.standard

    /// local STT engine (Apple SpeechAnalyzer vs WhisperKit)
    var sttEngine: SttEngineChoice { didSet { d.set(sttEngine.rawValue, forKey: "sttEngine") } }
    /// WhisperKit model variant — 항상 명시적 변형명 (옛 "" 자동값은 init 에서 마이그레이션)
    var whisperModel: String { didSet { d.set(whisperModel, forKey: "whisperModel") } }
    /// BCP-47 id of the transcription locale
    var transcribeLocaleID: String { didSet { d.set(transcribeLocaleID, forKey: "transcribeLocaleID") } }
    /// VAD: seconds of silence that closes an utterance (Whisper/GPT engines)
    var vadSilenceSec: Double { didSet { d.set(vadSilenceSec, forKey: "vadSilenceSec") } }
    /// VAD: max utterance length in seconds
    var vadMaxSec: Double { didSet { d.set(vadMaxSec, forKey: "vadMaxSec") } }
    /// live per-chunk correction while recording (desktop default: on)
    var liveCorrect: Bool { didSet { d.set(liveCorrect, forKey: "liveCorrect") } }
    /// engine for realtime + batch correction
    var correctionEngine: EngineChoice { didSet { d.set(correctionEngine.rawValue, forKey: "correctionEngine") } }
    /// engine for studio generation / tutor / chat
    var studioEngine: EngineChoice { didSet { d.set(studioEngine.rawValue, forKey: "studioEngine") } }
    /// per-provider API model ids (free text, like the desktop API cards)
    var anthropicModel: String { didSet { d.set(anthropicModel, forKey: "anthropicModel") } }
    var openaiModel: String { didSet { d.set(openaiModel, forKey: "openaiModel") } }
    var geminiModel: String { didSet { d.set(geminiModel, forKey: "geminiModel") } }
    var grokModel: String { didSet { d.set(grokModel, forKey: "grokModel") } }
    /// domain terms appended to the correction prompt (desktop agent correctionKeywords)
    var correctionKeywords: String { didSet { d.set(correctionKeywords, forKey: "correctionKeywords") } }
    /// generate a title with AI when saving a recording
    var autoTitle: Bool { didSet { d.set(autoTitle, forKey: "autoTitle") } }
    /// 시간표 위젯 배경: "system" | "white" | "black" | "clear"
    var widgetBackground: String { didSet { d.set(widgetBackground, forKey: "widgetBackground") } }
    /// 시간표 위젯 구분선 색 (팔레트 인덱스, -1 = 기본)
    var widgetDividerIndex: Int { didSet { d.set(widgetDividerIndex, forKey: "widgetDividerIndex") } }
    /// 시간표 수업 블록 글자색 (-1 = 흰색(기본), -2 = 검은색, 0 이상 = 팔레트 인덱스)
    var timetableTextIndex: Int { didSet { d.set(timetableTextIndex, forKey: "timetableTextIndex") } }
    /// 현재 보고 있는 학기 시간표 UUID ("" = 첫 번째)
    var activeTimetableUUID: String { didSet { d.set(activeTimetableUUID, forKey: "activeTimetableUUID") } }
    /// 수업 시작 전 알림 사용 여부
    var classAlarmEnabled: Bool { didSet { d.set(classAlarmEnabled, forKey: "classAlarmEnabled") } }
    /// 수업 시작 몇 분 전에 알릴지
    var classAlarmLeadMinutes: Int { didSet { d.set(classAlarmLeadMinutes, forKey: "classAlarmLeadMinutes") } }
    /// 위젯 글자 크기 배율 (1.0 = 기본)
    var widgetFontScale: Double { didSet { d.set(widgetFontScale, forKey: "widgetFontScale") } }
    /// 채팅 탭 엔진 (입력창의 모델 칩)
    var chatEngine: EngineChoice { didSet { d.set(chatEngine.rawValue, forKey: "chatEngine") } }
    /// 채팅 탭 모델 id ("" = 프로바이더 기본 모델)
    var chatModel: String { didSet { d.set(chatModel, forKey: "chatModel") } }

    // active agent snapshot (mirrors the selected SwiftData Agent; "" = no agent)
    var activeAgentUUID: String { didSet { d.set(activeAgentUUID, forKey: "activeAgentUUID") } }
    var agentCorrectionTerms: String { didSet { d.set(agentCorrectionTerms, forKey: "agentCorrectionTerms") } }
    var agentSystemPrompt: String { didSet { d.set(agentSystemPrompt, forKey: "agentSystemPrompt") } }
    var agentReplacementsText: String { didSet { d.set(agentReplacementsText, forKey: "agentReplacementsText") } }
    var agentPresetID: String { didSet { d.set(agentPresetID, forKey: "agentPresetID") } }
    /// 화면 모드: "system" | "light" | "dark"
    var appearance: String { didSet { d.set(appearance, forKey: "appearance") } }

    /// sync the snapshot used by correction/STT from the selected agent (nil = 없음)
    func applyActiveAgent(_ agent: Agent?) {
        activeAgentUUID = agent?.uuid.uuidString ?? ""
        agentPresetID = agent?.presetID ?? ""
        agentSystemPrompt = agent?.systemPrompt ?? ""
        agentReplacementsText = agent?.replacementsText ?? ""
        var terms = agent?.correctionKeywords ?? ""
        if let agent {
            let mathPairs = Agent.parsePairs(agent.mathRulesText)
            if !mathPairs.isEmpty {
                let rules = mathPairs.map { "\($0.0)→\($0.1)" }.joined(separator: ", ")
                terms += (terms.isEmpty ? "" : " / ") + "수식 표기: " + rules
            }
        }
        agentCorrectionTerms = terms
    }

    /// terms fed to the correction prompt: active agent first, else legacy free-text field
    var effectiveCorrectionTerms: String {
        agentCorrectionTerms.isEmpty ? correctionKeywords : agentCorrectionTerms
    }

    init() {
        // 엔진 통폐합 마이그레이션 — 옛 apple → whisper, 옛 lightning → Whisper Live 모델 항목
        let storedEngine = d.string(forKey: "sttEngine") ?? ""
        sttEngine = storedEngine == "gptAPI" ? .gptAPI : .whisper
        // "" 는 옛 "자동 (권장)" 센티널 — WhisperKit 의 낡은 기기표가 iPhone 17 세대를
        // base 로 강등시키는 문제가 있어 명시적 turbo 기본값으로 마이그레이션 (init 이라 멱등)
        let storedWhisperModel = d.string(forKey: "whisperModel") ?? ""
        if storedEngine == "lightning" {
            whisperModel = WhisperEngine.liveModel
        } else {
            whisperModel = storedWhisperModel.isEmpty ? WhisperEngine.defaultModel : storedWhisperModel
        }
        transcribeLocaleID = d.string(forKey: "transcribeLocaleID") ?? "ko-KR"
        vadSilenceSec = d.object(forKey: "vadSilenceSec") as? Double ?? 2.0
        vadMaxSec = d.object(forKey: "vadMaxSec") as? Double ?? 25
        liveCorrect = d.object(forKey: "liveCorrect") as? Bool ?? true
        correctionEngine = EngineChoice(rawValue: d.string(forKey: "correctionEngine") ?? "") ?? .apple
        studioEngine = EngineChoice(rawValue: d.string(forKey: "studioEngine") ?? "") ?? .apple
        anthropicModel = d.string(forKey: "anthropicModel") ?? "claude-sonnet-4-5"
        // default gpt-5.6-luna (one-time migration from the old default)
        let storedOpenAI = d.string(forKey: "openaiModel")
        openaiModel = (storedOpenAI == nil || storedOpenAI == "gpt-5.1") ? "gpt-5.6-luna" : storedOpenAI!
        geminiModel = d.string(forKey: "geminiModel") ?? "gemini-2.5-flash"
        grokModel = d.string(forKey: "grokModel") ?? "grok-4"
        correctionKeywords = d.string(forKey: "correctionKeywords") ?? ""
        autoTitle = d.object(forKey: "autoTitle") as? Bool ?? true
        widgetBackground = d.string(forKey: "widgetBackground") ?? "system"
        widgetDividerIndex = d.object(forKey: "widgetDividerIndex") as? Int ?? -1
        timetableTextIndex = d.object(forKey: "timetableTextIndex") as? Int ?? -1
        activeTimetableUUID = d.string(forKey: "activeTimetableUUID") ?? ""
        classAlarmEnabled = d.object(forKey: "classAlarmEnabled") as? Bool ?? true
        classAlarmLeadMinutes = d.object(forKey: "classAlarmLeadMinutes") as? Int ?? 10
        widgetFontScale = d.object(forKey: "widgetFontScale") as? Double ?? 1.0
        chatEngine = EngineChoice(rawValue: d.string(forKey: "chatEngine") ?? "") ?? .apple
        chatModel = d.string(forKey: "chatModel") ?? ""
        activeAgentUUID = d.string(forKey: "activeAgentUUID") ?? ""
        agentCorrectionTerms = d.string(forKey: "agentCorrectionTerms") ?? ""
        agentSystemPrompt = d.string(forKey: "agentSystemPrompt") ?? ""
        agentReplacementsText = d.string(forKey: "agentReplacementsText") ?? ""
        agentPresetID = d.string(forKey: "agentPresetID") ?? ""
        appearance = d.string(forKey: "appearance") ?? "system"
    }

    var transcribeLocale: Locale { Locale(identifier: transcribeLocaleID) }
}

/// cross-tab UI state (tab switching, recording session, "이 메모로 스튜디오 열기")
@MainActor
@Observable
final class AppState {
    enum Tab: Hashable { case library, chat, timetable, settings }
    var selectedTab: Tab = .library
    /// memo the 노트 탭 폴더 뷰(스튜디오 통합)가 포커스할 노트 (노트 상세 → 스튜디오 버튼)
    var studioMemoUUID: UUID?
    /// 폴더 스튜디오 진입 시 미리 선택할 소스 노트
    var studioPreselect: UUID?
    /// full-screen recording session visibility
    var isRecordingPresented = false
    /// 최초 실행 Whisper 모델 설정(다운로드+최적화) 시트
    var showWhisperSetup = false
    /// folder chosen in the record panel — recordings save here
    var recordFolder: Folder?
    /// 수업 알림을 눌러 들어왔을 때 녹음을 시작할 과목(폴더) 이름
    var pendingClassFolder: String?

    func openStudio(memoUUID: UUID) {
        studioMemoUUID = memoUUID
        selectedTab = .library
    }
}
