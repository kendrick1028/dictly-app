# Guideline 2.1 회신 문안 (4,000자 이내)

App Store Connect → **App Review Information → Notes** 에 아래 영문 전체를 붙여넣으세요.
**Resolution Center** 회신에도 같은 내용을 넣고, 화면 녹화 영상을 첨부합니다.

---

## 붙여넣을 영문 (전체 복사)

```
1. SCREEN RECORDING
Attached: recording from a physical iPhone 17 Pro on iOS 27.0, starting at app
launch. Covers first-launch model setup, recording with live transcription,
transcript playback, AI study-material generation, timetable setup, widget and
Live Activity. Microphone, Speech Recognition and Notification prompts shown.
Not applicable and therefore absent: account registration/login/deletion; paid
content, IAP or subscriptions; shared or published user content (so no
reporting/blocking).

2. DEVICES AND OS TESTED
- iPhone 17 Pro (iPhone18,1), iOS 27.0 - physical, primary test device
- Simulators on iOS 26.3: iPhone 17 Pro, 17, 17 Pro Max, Air, 16e
iPhone only; requires iOS 26.0+ because it uses FoundationModels (Apple
Intelligence) and SpeechAnalyzer, both introduced in iOS 26.

3. FUNCTION, AUDIENCE, PROBLEM, VALUE
Audience: university and high school students attending lectures.
Problem: a lecture happens once. Students cannot write fast enough, and a plain
audio file is hard to review because a specific moment cannot be found later.
Function:
- Records and transcribes in real time, so the transcript is ready when the
  lecture ends. Optional live correction re-checks each sentence against
  surrounding context to fix misheard technical terms.
- Every sentence has a timestamp; tapping one plays audio from that moment.
- Generates study materials from the transcript: summary, quiz, flashcards,
  mind map, memorization notes, tables, a Feynman-style self-explanation
  review, and a 1:1 AI tutor chat, with citations back to the audio.
- A weekly timetable fires a local notification before each class; tapping it
  starts recording into that subject's folder.
- Home screen widget (weekly timetable) and a Live Activity while recording.
Value: a searchable, reviewable, quizzable lecture without manual note-taking.

4. SETUP AND ACCESS
No account, credentials or sample files needed; everything works right after
installation.
IMPORTANT - first launch: the app downloads on-device speech models (Whisper)
and optimizes them for the Neural Engine. This full-screen step must finish
before use and takes several minutes on Wi-Fi. It is intentional, so recording
never stalls waiting for a model. Please let it complete.
- Record: Notes tab, tap the record button.
- Transcript/playback: Notes tab, tap any note.
- Study materials: Studio tab, pick a folder, select sources, tap a card.
- Timetable: Timetable tab, "+" to add a class, gear icon for semester dates
  and notification timing.
- Widget: add from the home screen after adding classes.
- Live Activity: start recording, then leave the app.
To test notifications fast: add a class starting a few minutes from now, set
timing to on-time, then lock the device.

5. EXTERNAL SERVICES
No developer backend. No analytics, advertising or tracking SDKs.
Default, all on device: Apple Speech framework / SpeechAnalyzer; WhisperKit
(MIT) running OpenAI Whisper models converted to Core ML; Apple Intelligence
(FoundationModels) for text generation. The Whisper model files download once
from Hugging Face at first launch and then run on device - this is the only
network request the app makes by default.
Optional, off unless the user enables it: OpenAI, Anthropic and Google Gemini
APIs, used only if the user enters their own API key in Settings. The key is
stored in the device Keychain and requests go directly from the device to that
provider. The developer never receives, proxies or stores this data. The app
ships with no keys.

6. REGIONAL DIFFERENCES
Features and content are identical in every region. No region gating, no
region-specific content or pricing. Free, with no in-app purchases.
Two platform-level notes: Apple Intelligence availability depends on device,
system language and Apple's rollout - where unavailable the app detects it and
the user picks another engine, with transcription and playback unaffected.
Speech recognition accuracy varies by spoken language; the default is Korean
and other locales can be selected in Settings.

7. REGULATED INDUSTRY AND THIRD-PARTY MATERIAL
Not a regulated industry: no medical, financial, legal or gambling services and
nothing requiring a license.
No protected third-party material. Users record their own audio and the app
ships with no copyrighted content. Recordings, transcripts and generated
materials stay on the device and are never uploaded to the developer, published
or shared. There are no social, sharing or publishing features.
Components: WhisperKit (MIT), OpenAI Whisper models (MIT), swift-transformers
and swift-crypto (Apache 2.0).

REVIEW TEST KEYS (optional cloud path only - not needed to review the app)
OpenAI: <PASTE KEY>   Anthropic: <PASTE KEY>
Settings tab, select the engine, paste the key.

The build also contains a widget extension and a Live Activity, both bundled in
the app with no separate setup.
```

---

## 화면 녹화 촬영 가이드

**필수 조건**: 실기기(iPhone 17 Pro, iOS 27.0), **홈 화면에서 앱 아이콘을 탭하는 장면부터** 시작.

권장 순서 (3~5분):

1. 홈 화면에서 **Dictly 아이콘 탭**
2. 첫 실행 모델 준비 화면 (시작 장면만 담고 편집으로 잘라도 됨)
3. 노트 탭 → 녹음 시작 → **마이크·음성인식 권한 팝업 수락**
4. 몇 문장 말하며 실시간 전사가 흐르는 것 보여주기
5. 홈으로 나가서 **다이나믹 아일랜드 / 잠금화면 Live Activity**
6. 앱 복귀 → 녹음 종료 → 저장
7. 저장된 노트 열기 → 문장 탭 → **그 시점부터 재생되는 것**
8. 스튜디오 탭 → 폴더 → 소스 선택 → **요약** 또는 **퀴즈** 생성 → 결과
9. 시간표 탭 → 수업 추가 → 설정에서 학기 기간·알림 시점 → **알림 권한 팝업**
10. 홈 화면 위젯

**주의**: 권한 팝업 3종(마이크·음성인식·알림)이 반드시 영상에 나와야 합니다. 이미 수락한 상태라면 앱 삭제 후 재설치하고 촬영하세요.

**녹화 방법**: 설정 → 제어 센터 → 화면 기록 추가 → 제어 센터에서 녹화. 사진 앱에서 파일로 저장해 Resolution Center에 첨부합니다.
