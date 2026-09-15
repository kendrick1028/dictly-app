/** fallback shown before the GitHub API answers — see lib/release.ts (useLatestRelease) */
export const APP_VERSION = 'v0.6.1'
export const DMG_URL =
  'https://github.com/kendrick1028/dictly-app/releases/download/v0.6.1/Dictly-0.6.1-arm64.dmg'
export const EXE_URL: string | null =
  'https://github.com/kendrick1028/dictly-app/releases/download/v0.6.1/Dictly-0.6.1-Setup.exe'

export const RELEASE_NOTES_URL = 'https://relieved-plate-a85.notion.site/Dictly-38743693c97e81e2949fe9f23539f200'

export interface Stat {
  value: string
  label: string
}
export const stats: Stat[] = [
  { value: '₩0', label: '전사 비용 — 로컬 Whisper' },
  { value: '100%', label: '온디바이스 처리' },
  { value: '7', label: 'AI 학습 도구' },
]

export interface Step {
  no: string
  title: string
  body: string
}
export const steps: Step[] = [
  { no: '01', title: '녹음', body: '시스템 오디오(인강·줌)와 마이크를 동시에. 버튼 하나로 바로 시작합니다.' },
  { no: '02', title: '교정 · 정리', body: '로컬 Whisper가 실시간 전사하고, AI가 문장과 수식을 즉시 다듬습니다.' },
  { no: '03', title: '학습 · 복습', body: '요약·마인드맵·퀴즈·파인만 복습까지, 녹음 하나로 학습 자료가 완성됩니다.' },
]

export interface Showcase {
  tag: string
  title: string
  body: string
  points: string[]
  video: string
  reverse?: boolean
}

export const showcases: Showcase[] = [
  {
    tag: '녹음 · 전사',
    title: '녹음하면 바로, 정확한 전사',
    body: '시스템 오디오와 마이크를 함께 캡처하고 로컬 Whisper가 말하는 즉시 받아씁니다. 완전 오프라인, 비용 0. 데이터는 기기를 떠나지 않습니다.',
    points: ['시스템 오디오 + 마이크 동시', '무료 로컬 전사 · 오프라인', '청크 단위 실시간 자동 교정'],
    video: 'overview',
  },
  {
    tag: '자료 · 필기',
    title: '강의 자료와 나란히, 페이지까지 싱크',
    body: '강의 PDF를 붙이면 전사문과 페이지가 자동으로 묶입니다. 한 화면에서 듣고 읽고, 인용을 누르면 그 시각·그 페이지로 바로 이동합니다.',
    points: ['PDF 첨부 후 자동 페이지 싱크', '전사문 ↔ 자료 양방향 점프', '펜·형광펜으로 바로 필기'],
    video: 'pdf-sync',
    reverse: true,
  },
  {
    tag: '맞춤 정확도',
    title: '과목을 아는 AI 에이전트',
    body: '과목마다 전용 에이전트를 두어 전공 용어 사전, 구어체 수식 규칙, 자주 틀리는 표현 교정을 적용합니다. 쓸수록 내 강의에 맞게 똑똑해집니다.',
    points: ['과목별 전문 용어로 인식률↑', '구어체 → LaTeX 수식 규칙', '오인식 단어 자동 교정 사전'],
    video: 'agent',
  },
  {
    tag: '내 모델',
    title: '원하는 AI 모델을 그대로',
    body: '교정·요약·채팅에 내 Claude CLI 또는 GPT를 연결해 모델을 직접 고릅니다. 별도 구독 없이 이미 쓰는 AI 한도 안에서 동작합니다.',
    points: ['Claude · GPT 선택 연결', '모델·추론 강도 직접 선택', '비싼 월 구독 불필요'],
    video: 'model-select',
    reverse: true,
  },
  {
    tag: '튜닝',
    title: '정확도를 직접 조율',
    body: '침묵 감지 시간과 청크 길이를 슬라이더로 조절해, 빠른 반응과 높은 정확도 사이를 강의 환경에 맞게 맞춥니다.',
    points: ['VAD 침묵·청크 길이 조절', '안전 범위 시각화 + 경고', 'Turbo / Large-v3 모델 선택'],
    video: 'chunk-setting',
  },
  {
    tag: '프라이버시',
    title: '저장 위치까지 내 손에',
    body: '녹음·전사·자료가 모두 내 기기에 저장됩니다. 저장 폴더도 직접 지정해, 강의 내용이 클라우드로 새어 나가지 않습니다.',
    points: ['로컬 SQLite + 파일 저장', '저장 위치 직접 지정', '음성은 외부 전송 없음'],
    video: 'save-location',
    reverse: true,
  },
]

export interface StudioItem {
  name: string
  desc: string
  video: string
}
export const studio: StudioItem[] = [
  { name: '요약', desc: '핵심 주제별 정리·시험 대비 가이드. 정의·공식은 인용 블록으로 강조.', video: 'studio-summary' },
  { name: '파인만 복습', desc: 'AI가 묻고 내 말로 답하면 실시간 채점. 약한 부분만 회차별로 다시 복습.', video: 'studio-feynman' },
  { name: '퀴즈', desc: '난이도·문제 수·유형 선택. 자동 채점과 해설까지.', video: 'studio-quiz' },
  { name: '마인드맵', desc: '강의를 목차 트리로 재구성. 말단 노드엔 정의·공식·수치.', video: 'studio-mindmap' },
  { name: '플래시카드', desc: '개념·공식 암기 카드. 뒤집어 학습하고 인쇄용으로 내보내기.', video: 'studio-flashcard' },
  { name: '비교 표', desc: '관련 내용을 주제별 비교·정리표로. 셀 안에 수식도 그대로.', video: 'studio-table' },
  { name: '암기노트', desc: '앞글자·스토리·연상·리듬 — 암기가 필요한 개념을 기법으로.', video: 'studio-mnemonic' },
]

export interface Diff {
  title: string
  body: string
}
export const diffs: Diff[] = [
  { title: '비용 0원', body: '전사는 로컬 모델로 무료, AI는 내 구독 한도 안에서. 시중 앱의 비싼 월 구독이 필요 없습니다.' },
  { title: '수식까지 정확', body: '실시간 교정 + 수식 인식으로 경제·수리통계·재무관리처럼 식이 많은 과목도 또렷하게.' },
  { title: '완전 로컬', body: '녹음·전사는 기기 안에서 처리되어, 강의 내용이 클라우드로 새어 나가지 않습니다.' },
]

export interface Faq {
  q: string
  a: string
}
export const faqs: Faq[] = [
  { q: '정말 무료인가요?', a: '전사는 기기에서 도는 로컬 Whisper로 완전 무료입니다. 요약·교정 같은 AI 기능은 이미 쓰고 계신 Claude·GPT 구독 한도 안에서 동작해, Dictly 자체에 별도 결제가 없습니다.' },
  { q: '인터넷이 없어도 되나요?', a: '녹음과 전사는 100% 오프라인으로 동작합니다. AI 학습 기능을 쓸 때만 선택한 AI 제공자에 연결됩니다.' },
  { q: '어떤 기기에서 쓸 수 있나요?', a: 'macOS(Apple Silicon, macOS 14+)와 Windows 10/11(64비트)에서 쓸 수 있습니다. Mac에서는 Apple GPU(MLX)로 전사해 가장 빠르고, 말하는 도중 글자가 흐르는 Live 전사도 Mac 전용입니다. Windows는 CPU(faster-whisper)로 전사해 문장 단위로 조금 늦게 나옵니다.' },
  { q: '수식이 많은 과목도 되나요?', a: '“베타 유”를 βᵤ로 바꾸는 한국어 구어체 수식 변환과 실시간 교정을 갖춰, 경제·수리통계·재무관리 같은 과목에 특히 강합니다.' },
  { q: '내 강의 음성은 안전한가요?', a: '음성·전사·자료는 모두 내 Mac에 저장되며 저장 위치도 직접 지정합니다. 음성 데이터는 외부로 전송되지 않습니다.' },
]
