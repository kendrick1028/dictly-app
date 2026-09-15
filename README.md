# Dictly

> **다운로드**: [최신 릴리스](https://github.com/kendrick1028/dictly-app/releases/latest) — macOS(Apple Silicon) `.dmg` · Windows x64 `Setup.exe`. 앱 소개는 https://dictly-six.vercel.app

로컬 Whisper 모델로 동작하는 한국어 음성인식 기록 앱. 강의·회의 녹음을 텍스트로
전사하고, **말로 표현된 수식을 실제 수식(아래/위첨자·시그마·분수)으로 렌더링**합니다.
재무관리·회계 등 과목별 강의에 특화되어 있습니다.

## 주요 기능

- **폴더–메모 구조**: 폴더 안에 음성인식 메모 저장. 메모는 `음성인식(원문)` / `요약` / `채팅` 탭으로 구성.
- **로컬 STT**: Python 사이드카. **MLX(Apple GPU)** 우선 / faster-whisper(CPU) 폴백. `large-v3-turbo` 실시간 / `large-v3` 정밀. 완전 오프라인.
- **실시간 파형**: 녹음 중 하단 가운데 입력 음성 파형 표시.
- **실시간 + 정밀 재전사**: 녹음 중 문장 단위 실시간 표시, 종료 후 옵션으로 고정밀 재전사.
- **수식 변환**: 한국어 수식 발화 → KaTeX (`케이 이`→`K_e`, `베타 유`→`β_u`, 분수·루트·시그마 등). 복잡한 경우 AI 교정으로 보강.
- **시스템 오디오 모드**: 화면 녹화 권한으로 컴퓨터 내부 소리만 캡처(ScreenCaptureKit loopback).
- **에이전트/키워드**: 과목별 에이전트(키워드·수식규칙·프롬프트)로 인식률 향상.
- **Claude CLI 연동**: 문맥 기반 교정, AI 요약, 메모 기반 채팅.
- **내보내기**: Markdown / TXT / HTML / PDF + 클립보드 복사. 녹음 파일 저장·다운로드.

## 요구 사항

- macOS (Apple Silicon), Node 18+, Python 3.10+ (3.11 권장)
- AI 기능 사용 시: `claude` CLI 설치 + 로그인

## 설치 & 실행

```bash
# 1) Node 의존성
npm install

# 2) STT 환경 (venv + faster-whisper + 모델 프리페치 ~1.6GB)
bash python/setup_env.sh

# 3) 개발 실행
npm run dev
```

### macOS 권한
- **마이크**: 첫 녹음 시 권한 요청.
- **시스템 오디오**: 시스템 설정 → 개인정보 보호 및 보안 → **화면 기록** 에서 앱(개발 중에는 `Electron`)을 허용한 뒤 재시작.

## 아키텍처

```
Electron(main) ── IPC ── Renderer(React/Tailwind)
   │  better-sqlite3 (folders/memos/segments/agents/chat)
   │  claude -p (요약·교정·채팅)
   │  setDisplayMediaRequestHandler → audio:'loopback'
   └─ spawn ─▶ python/stt_server.py  ◀── localhost WebSocket(PCM 16k) ── Renderer
                faster-whisper + 에너지 VAD (실시간) / 전체파일 정밀패스
```

- 데이터: `~/Library/Application Support/dictly/Dictly/` (DB, 녹음, 모델)

## 알려진 제약 / 다음 단계

- **STT 속도**: MLX(Apple GPU)로 거의 실시간(~11s 오디오 → 5.3s). MLX 미가용 시 faster-whisper(CPU)로 자동 폴백(느림).
- **배포(.app)**: Python 사이드카 PyInstaller 번들 + 코드사이닝은 추후 단계. 현재는 dev 실행 + 로컬 venv 기준.
- 실시간 VAD는 에너지 기반(MVP). silero VAD로 고도화 가능.
- HF 모델 다운로드는 `HF_HUB_DISABLE_XET=1`로 강제 HTTPS (xet 프로토콜 hang 회피).
