import {
  Mic,
  Sigma,
  Network,
  Layers,
  FileStack,
  ShieldCheck,
  GraduationCap,
  type LucideIcon,
} from 'lucide-react'
import type { OrbitItem } from '@/components/ui/radial-orbital-timeline'

/** 7 features orbiting the hub (radial orbital timeline = 기능 명세) */
export const orbitItems: OrbitItem[] = [
  {
    id: 1,
    title: '녹음 · 로컬 전사',
    short: '녹음·전사',
    tag: 'Capture',
    Icon: Mic,
    related: [2, 6],
    desc: '시스템 오디오(인강·줌)와 마이크(현장 강의)를 동시에 잡아내고, 로컬 faster-whisper가 28초 청크 단위로 실시간 전사합니다. 완전 오프라인 · 비용 0.',
  },
  {
    id: 2,
    title: '실시간 교정 · 수식',
    short: '교정·수식',
    tag: 'Accuracy',
    Icon: Sigma,
    related: [1, 3],
    desc: '청크마다 AI가 문맥으로 오인식을 고치고(대각선 스윕 애니메이션), "베타 유"를 βᵤ로, 분수·시그마·첨자까지 KaTeX 수식으로 렌더링합니다.',
  },
  {
    id: 3,
    title: '과목별 AI 에이전트',
    short: '에이전트',
    tag: 'Adaptive',
    Icon: GraduationCap,
    related: [2],
    desc: '과목마다 전용 에이전트가 전문 용어 사전 · 구어체 수식 규칙 · 자주 틀리는 표현 교정 사전을 적용해, 들을수록 그 과목에 맞게 정확해집니다.',
  },
  {
    id: 4,
    title: 'PDF 싱크 · 필기',
    short: 'PDF 필기',
    tag: 'Materials',
    Icon: FileStack,
    related: [1, 5],
    desc: '강의 PDF를 전사문과 페이지 단위로 자동 싱크. 펜·형광펜·도형·올가미로 바로 필기하고, 주석을 누르면 그 시각의 녹음으로 점프합니다.',
  },
  {
    id: 5,
    title: 'AI 학습 스튜디오',
    short: '스튜디오',
    tag: 'Study',
    Icon: Layers,
    related: [4, 7],
    desc: '녹음 하나로 요약 · 마인드맵 · 플래시카드 · 표 · 암기법 · 퀴즈를 자동 생성. 모든 문장에 시각·페이지 출처 칩이 달립니다.',
  },
  {
    id: 6,
    title: '파인만 복습',
    short: '파인만',
    tag: 'Mastery',
    Icon: Network,
    related: [5],
    desc: 'AI가 노트 기반 질문을 한 문제씩 묻고, 내 말로 답하면 실시간 채점. 가중평균 점수·진행률이 누적되고 약한 부분만 회차별로 다시 복습합니다.',
  },
  {
    id: 7,
    title: '완전 로컬 · 무료',
    short: '로컬·무료',
    tag: 'Privacy',
    Icon: ShieldCheck,
    related: [1, 5],
    desc: '녹음·전사는 당신의 macOS 안에서만 처리되고 SQLite에 저장됩니다. AI 기능은 내 Claude·GPT 한도 안에서 — 비싼 월 구독이 필요 없습니다.',
  },
]

export interface Showcase {
  tag: string
  title: string
  highlight: string
  body: string
  ticks: string[]
  media: { type: 'video' | 'image'; src: string; poster?: string }
  reverse?: boolean
}

export const showcases: Showcase[] = [
  {
    tag: '녹음 · 전사',
    title: '말하는 즉시, ',
    highlight: '정확한 전사',
    body: '시스템 오디오와 마이크를 함께 캡처하고 로컬 Whisper가 실시간으로 받아씁니다. VAD(침묵·청크 길이)를 직접 조절해 끊김 없이, 데이터는 기기를 벗어나지 않습니다.',
    ticks: ['시스템 오디오 + 마이크 동시', '무료 로컬 전사 · 완전 오프라인', '청크 단위 실시간 자동 교정'],
    media: { type: 'video', src: '/media/live-correction.mp4', poster: '/media/live-correction.jpg' },
  },
  {
    tag: '교정 · 수식',
    title: '수식까지 알아듣는 ',
    highlight: '실시간 교정',
    body: '경제·수리통계·재무관리처럼 식이 많은 과목도 또렷하게. 말로 한 수식을 KaTeX로 렌더링하고, 문맥 기반으로 문장을 다듬습니다.',
    ticks: ['“베타 유”, “브이 엘” → βᵤ, V_L 자동 변환', '분수·루트·시그마·위·아래첨자', '대각선 스윕으로 교정 과정 시각화'],
    media: { type: 'image', src: '/media/latex.png' },
    reverse: true,
  },
  {
    tag: '자료 · 필기',
    title: '자료와 나란히, ',
    highlight: '바로 필기',
    body: '강의 PDF를 붙이면 전사문과 페이지가 자동으로 묶입니다. 한 화면에서 듣고 읽고, 펜·형광펜으로 강조하세요. 인용을 누르면 그 시각·페이지로 이동합니다.',
    ticks: ['전사문 ↔ PDF 페이지 자동 싱크', '펜·형광펜·도형·올가미 필기', '주석 클릭 → 해당 녹음 시점으로 점프'],
    media: { type: 'video', src: '/media/highlighting.mp4', poster: '/media/highlighting.jpg' },
  },
  {
    tag: '맞춤 정확도',
    title: '과목을 아는 ',
    highlight: 'AI 에이전트',
    body: '과목마다 전용 에이전트를 두어 전공 용어, 구어체 수식 규칙, 오인식 교정 사전을 적용합니다. 쓸수록 내 강의에 맞게 똑똑해집니다.',
    ticks: ['과목별 전문 용어로 인식률 향상', '구어체 → LaTeX 변환 규칙', '오인식 단어 자동 교정 사전'],
    media: { type: 'image', src: '/media/agent.png' },
    reverse: true,
  },
]

export interface StudioCard {
  name: string
  desc: string
  accent: string
  media: { type: 'video' | 'image'; src: string; poster?: string }
  wide?: boolean
}

export const studioCards: StudioCard[] = [
  {
    name: '파인만 복습',
    desc: 'AI가 한 문제씩 묻고 내 말로 답하면 실시간 채점. 가중평균 점수·진행률이 쌓이고, 약한 부분만 회차별 리포트로 다시 복습.',
    accent: '#7c6cff',
    media: { type: 'video', src: '/media/studio-feynman.mp4', poster: '/media/studio-feynman.jpg' },
    wide: true,
  },
  {
    name: '요약',
    desc: '핵심 주제별 정리·시험 대비 가이드. 정의·공식은 인용 블록으로 강조.',
    accent: '#38bdf8',
    media: { type: 'image', src: '/media/studio-summary.png' },
  },
  {
    name: '마인드맵',
    desc: '강의를 목차 트리로 재구성. 말단 노드엔 정의·공식·수치가 담깁니다.',
    accent: '#22d3ee',
    media: { type: 'image', src: '/media/studio-mindmap.png' },
  },
  {
    name: '플래시카드',
    desc: '개념·공식 암기 카드. 뒤집어 학습하고 인쇄용 2열로 내보내기.',
    accent: '#a78bfa',
    media: { type: 'video', src: '/media/studio-flashcard.mp4', poster: '/media/studio-flashcard.jpg' },
  },
  {
    name: '비교 표',
    desc: '관련 내용을 주제별 비교·정리표로. 셀 안에 수식도 그대로.',
    accent: '#34d399',
    media: { type: 'image', src: '/media/studio-table.png' },
  },
  {
    name: '회차 리포트',
    desc: '파인만 복습 결과를 회차별로 저장 — 질문·답안·피드백·점수 추적.',
    accent: '#fbbf24',
    media: { type: 'image', src: '/media/studio-feynman-report.png' },
  },
]

export interface Diff {
  num: string
  title: string
  body: string
  Icon: LucideIcon
}

export const diffs: Diff[] = [
  {
    num: '01',
    title: '비용 0원',
    body: '전사는 로컬 모델로 무료, AI 기능은 내 Claude·GPT 구독 한도 안에서. 시중 앱의 비싼 월 구독이 필요 없습니다.',
    Icon: ShieldCheck,
  },
  {
    num: '02',
    title: '높은 정확도',
    body: '실시간 교정 + 수식 인식으로 경제·수리통계·재무관리처럼 식이 많은 과목도 또렷하게 기록합니다.',
    Icon: Sigma,
  },
  {
    num: '03',
    title: '완전 로컬',
    body: '녹음과 전사는 기기 안에서 처리됩니다. 강의 내용이 클라우드로 새어 나가지 않아요.',
    Icon: Mic,
  },
]
