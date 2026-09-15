// What's-new pages shown once after an update (WhatsNewModal). One feature per page, written for
// someone who has never seen the feature: what it does, where to find it, one concrete example.
// Add a new entry at the TOP when releasing; the modal shows the entry matching app.getVersion().
import type { LucideIcon } from 'lucide-react'
import { BookOpenCheck, Coffee, GraduationCap, ArrowDownToLine, Sparkles, Send, UserRoundCheck, ShieldCheck, Mic, SlidersHorizontal, AudioWaveform, Type, Wrench, Orbit, Zap } from 'lucide-react'

export type Illustration =
  | 'autoPage'
  | 'breakDetect'
  | 'liveTutor'
  | 'hallucination'
  | 'scrollFollow'
  | 'notion'
  | 'account'
  | 'fallback'
  | 'hero'
  | 'live'
  | 'antigravity'
  | 'pill'
  | 'options'
  | 'pulse'
  | 'pdfText'
  | 'misc'

export interface WhatsNewPage {
  id: string
  /** small label above the title */
  /** 'hero' = the opening page: full-bleed image, no badge chip */
  badge: '신기능' | '개선' | 'hero'
  title: string
  /** one sentence: what it does for you */
  lead: string
  /** 2–3 short points: how to use / where it lives */
  bullets: string[]
  Icon: LucideIcon
  /** pastel tile classes for the visual header */
  tile: string
  tint: string
  illustration: Illustration
}

export interface ReleaseNotes {
  version: string
  headline: string
  pages: WhatsNewPage[]
}

/** 0.6.1 pages (the misc round-up is appended last, after the 0.6.0 pages) */
const PAGES_061: WhatsNewPage[] = [
      {
        id: 'live',
        badge: '신기능',
        title: 'Live 전사: 말하는 도중 글자가 흐르는 자체 엔진',
        lead: 'Whisper를 바탕으로 Dictly가 직접 만든 스트리밍 엔진이에요. 문장이 끝나기를 기다리지 않고 말하는 동안 글자가 바로 따라와요.',
        bullets: [
          '실시간성: 말한 지 2초 안팎이면 회색 글자로 먼저 보이고, 문장이 끝나면 확정돼요.',
          '정확도: Whisper large-v3-turbo와 같은 결과를 내도록 맞췄고, 반복·환각·무음 구간 오류를 걸러요.',
          '전부 Mac 안에서 처리해 인터넷·비용이 없어요. 녹음 옵션(⚙) → 전사 모델 → Live.'
        ],
        Icon: Zap,
        tile: 'from-lime-50 to-emerald-100',
        tint: 'text-emerald-700',
        illustration: 'live'
      },
      {
        id: 'antigravity',
        badge: '신기능',
        title: 'Antigravity CLI 지원',
        lead: 'Google Antigravity CLI(agy)에 로그인돼 있으면 Gemini·Claude·GPT-OSS 모델로 정리·요약·퀴즈·채팅을 돌릴 수 있어요.',
        bullets: [
          '상단 플러그 → AI 연결 → CLI 연결에 Antigravity 카드가 생겼어요. 로그인된 Google 계정이 표시돼요.',
          '카드 안에서 기본 모델을 고르고, 채팅창 모델 메뉴에서도 그때그때 바꿀 수 있어요.',
          '한도 초과 시 자동 전환에도 함께 들어가요. 이미지 PDF 분석은 다른 연결로 넘겨 처리해요.'
        ],
        Icon: Orbit,
        tile: 'from-sky-50 to-indigo-100',
        tint: 'text-indigo-700',
        illustration: 'antigravity'
      },
      {
        id: 'pill',
        badge: '개선',
        title: '새 녹음 알약',
        lead: '알약 안에 둥근 버튼이 겹쳐 있던 모습을 정리했어요. 녹음 중에는 두 줄 카드로 바뀌어요.',
        bullets: [
          '대기 중: 마이크·모델·에이전트 선택이 테두리 없는 글자로 나란히, 둥근 건 알약 하나뿐이에요.',
          '녹음 중: 노트 제목 아래에 시간·입력·모델이 한 줄로 붙고, 종료 버튼만 빨간 원으로 남아요.',
          '알약이 창 아래 가운데에 떠 있어서 전사문 패널 크기와 상관없이 같은 자리예요.'
        ],
        Icon: Mic,
        tile: 'from-emerald-50 to-teal-100',
        tint: 'text-emerald-700',
        illustration: 'pill'
      },
      {
        id: 'options',
        badge: '개선',
        title: '녹음 옵션 창이 절반으로',
        lead: '⚙ 옵션 창에서 고르는 항목은 전부 드롭다운이 됐고, 설명 문장은 메뉴 안으로 들어갔어요.',
        bullets: [
          '전사 모델·언어·교정 시점·종료 감지 동작은 오른쪽 "값 ⌄"을 눌러 고르세요.',
          '각 모델의 설명은 메뉴 항목 아래 작은 글씨로, 참고 메모는 메뉴 맨 아래 한 줄로 옮겼어요.',
          '켜고 끄는 항목은 체크박스 그대로예요.'
        ],
        Icon: SlidersHorizontal,
        tile: 'from-violet-50 to-indigo-100',
        tint: 'text-violet-700',
        illustration: 'options'
      },
      {
        id: 'pulse',
        badge: '개선',
        title: '새 음성 펄스',
        lead: '녹음 중 소리를 보여 주던 막대 12개가 가운데가 높은 7개 막대로 바뀌었어요.',
        bullets: ['가운데 막대가 가장 크게, 양끝은 옅게 움직여서 소리 크기가 한눈에 보여요.', '조용할 때는 작은 점 일곱 개로 보이다가 말이 시작되면 가운데부터 올라와요.'],
        Icon: AudioWaveform,
        tile: 'from-amber-50 to-orange-100',
        tint: 'text-amber-700',
        illustration: 'pulse'
      },
      {
        id: 'pdfText',
        badge: '신기능',
        title: 'PDF에 글자 쓰기와 한 장씩 보기',
        lead: '펜 툴바에 텍스트 도구가 생겼고, 교안을 한 장씩 넘겨 보는 모드가 추가됐어요.',
        bullets: [
          'T 도구를 고르고 페이지를 클릭하면 그 자리에 입력해요. Aa로 기본 크기, −/+로 개별 크기를 바꿔요.',
          '툴바 끝 버튼으로 툴바를 왼쪽 세로로 옮길 수 있고, 위치는 기억돼요.',
          'PDF 상단 버튼으로 이어 보기 ↔ 한 장씩 보기를 전환해요. 전사문의 p.N 태그는 ⌄로 다른 페이지로 바꿀 수 있어요.'
        ],
        Icon: Type,
        tile: 'from-rose-50 to-pink-100',
        tint: 'text-rose-700',
        illustration: 'pdfText'
      },
      {
        id: 'misc',
        badge: '개선',
        title: '그 밖의 다듬기',
        lead: '자잘하게 거슬리던 것들을 한 번에 손봤어요.',
        bullets: [
          '실시간 튜터: 설명이 나오는 동안 자동으로 따라 내려가고, 생성 중엔 회색 뼈대가 먼저 보여요. 문단이 나뉘고 설명이 더 쉬워졌어요.',
          '번역·튜터의 수식이 깨지지 않고 렌더링돼요. 스크롤바는 스크롤할 때만 보여요.',
          'PDF 이어 보기에서 마지막 페이지까지 제대로 잡히고, 패널 크기를 바꿔도 페이지가 튀지 않아요. 좁은 창에서 옵션 창이 잘리지 않아요.'
        ],
        Icon: Wrench,
        tile: 'from-slate-50 to-zinc-200',
        tint: 'text-zinc-700',
        illustration: 'misc'
      }
    ]

/** 0.6.0 pages — still shown inside the 0.6.1 popup (users who skipped 0.6.0 see everything) */
const PAGES_060: WhatsNewPage[] = [
      {
        id: 'autoPage',
        badge: '신기능',
        title: '교안 자동 넘김',
        lead: '강사가 말하는 내용을 듣고 열려 있는 교안(PDF)의 페이지를 알아서 넘겨 줘요.',
        bullets: [
          '녹음 옵션(⚙) → 교안 자동 넘김을 켜고, PDF를 열어 두면 시작돼요.',
          '슬라이드 문장을 그대로 읽으면 즉시, 풀어서 설명하면 AI가 판단해서 넘겨요.',
          '직접 페이지를 넘기면 20초 동안 그대로 두고, PDF 위의 "자동" 버튼으로 잠시 멈출 수 있어요.'
        ],
        Icon: BookOpenCheck,
        tile: 'from-emerald-50 to-teal-100',
        tint: 'text-emerald-700',
        illustration: 'autoPage'
      },
      {
        id: 'breakDetect',
        badge: '신기능',
        title: '쉬는 시간 · 수업 종료 감지',
        lead: '"10분 쉬었다 하죠", "오늘은 여기까지" 같은 말을 알아듣고 녹음을 알아서 멈춰요.',
        bullets: [
          '쉬는 시간은 5초, 수업 종료는 10초 카운트다운 후에 실행돼요. 아니면 취소를 누르세요.',
          '"10분 쉬고"라고 하면 11분 뒤에 녹음을 자동으로 다시 시작해요.',
          '녹음 옵션(⚙)에서 켜고, 종료는 "제안만"으로 바꿀 수도 있어요.'
        ],
        Icon: Coffee,
        tile: 'from-amber-50 to-orange-100',
        tint: 'text-amber-700',
        illustration: 'breakDetect'
      },
      {
        id: 'liveTutor',
        badge: '신기능',
        title: '실시간 AI 튜터',
        lead: '수업을 들으면서 방금 나온 내용을 아주 쉬운 말로 바로바로 풀어 줘요.',
        bullets: [
          '노트 제목 옆 학사모 버튼을 누르면 스튜디오 자리에 튜터 패널이 열려요.',
          '20~30초마다 카드 한 장. 시간 배지를 누르면 그 부분 전사문으로 이동해요.',
          '"더 쉽게"로 다시 설명받고, 녹음이 끝나면 스튜디오 메모로 저장돼요.'
        ],
        Icon: GraduationCap,
        tile: 'from-orange-50 to-rose-100',
        tint: 'text-orange-700',
        illustration: 'liveTutor'
      },
      {
        id: 'notion',
        badge: '신기능',
        title: 'Notion으로 내보내기',
        lead: '요약·퀴즈·표 같은 스튜디오 메모를 Notion 페이지로 바로 보내요.',
        bullets: [
          '설정 → Notion 연결에서 통합 토큰을 넣고, 내보낼 페이지를 고르세요.',
          '스튜디오 메모의 ⋮ 메뉴 → Notion으로 내보내기.',
          '수식은 Notion 수식 블록으로, 표는 표 블록으로 옮겨져요.'
        ],
        Icon: Send,
        tile: 'from-slate-50 to-zinc-200',
        tint: 'text-zinc-800',
        illustration: 'notion'
      },
      {
        id: 'hallucination',
        badge: '개선',
        title: '무음 구간 "감사합니다" 등 전사 할루시네이션 제거',
        lead: '강사가 말을 멈춘 구간에서 전사 모델이 지어내던 "감사합니다", "시청해 주셔서 감사합니다"가 사라져요.',
        bullets: ['실시간 전사·파일 전사 모두에 적용돼요.', '이미 저장된 노트도 다시 열면 한 번 정리돼요.'],
        Icon: ShieldCheck,
        tile: 'from-sky-50 to-blue-100',
        tint: 'text-sky-700',
        illustration: 'hallucination'
      },
      {
        id: 'scrollFollow',
        badge: '개선',
        title: '전사 중 위로 스크롤',
        lead: '녹음 중에 앞부분을 다시 읽으려고 올리면 더 이상 아래로 끌려 내려가지 않아요.',
        bullets: ['위로 올리면 자동 따라가기가 멈추고, 아래쪽 둥근 ↓ 버튼이 나타나요.', '버튼을 누르거나 맨 아래까지 내리면 다시 따라가요.'],
        Icon: ArrowDownToLine,
        tile: 'from-violet-50 to-indigo-100',
        tint: 'text-violet-700',
        illustration: 'scrollFollow'
      },
      {
        id: 'account',
        badge: '개선',
        title: '연결된 계정을 한눈에',
        lead: 'AI 연결 화면에서 Claude Code·Codex에 어떤 계정으로 로그인돼 있는지 바로 보여요.',
        bullets: ['이메일과 요금제(Max·Pro·Plus)가 카드 아래에 표시돼요.', '상단 플러그 아이콘에 마우스를 올리면 지금 연결된 계정이 떠요.'],
        Icon: UserRoundCheck,
        tile: 'from-lime-50 to-green-100',
        tint: 'text-lime-700',
        illustration: 'account'
      },
      {
        id: 'fallback',
        badge: '개선',
        title: '한도 초과 시 조용히 전환',
        lead: 'AI 사용량 한도에 걸리면 다른 프로바이더로 넘어가서 계속 쓰고, 알림은 한 번만 떠요.',
        bullets: ['전환된 뒤에는 청크마다 다시 시도하지 않아 알림이 반복되지 않아요.', 'AI 연결 화면의 "다시 시도"로 원래 프로바이더로 돌아갈 수 있어요.'],
        Icon: Sparkles,
        tile: 'from-yellow-50 to-amber-100',
        tint: 'text-yellow-700',
        illustration: 'fallback'
      }
    ]

const HERO_PAGE: WhatsNewPage = {
  id: 'hero',
  badge: 'hero',
  title: '더 강력하고 새로워진 Dictly를 만나보세요',
  lead: '다른 전사 앱 어디에도 없는 강의 보조 기능이 대폭 추가됐어요. 강의를 듣는 동안 교안이 알아서 넘어가고, 쉬는 시간을 알아채고, 어려운 내용은 옆에서 바로 풀어 줘요.',
  bullets: [
    '말하는 도중 글자가 흐르는 자체 Live 전사 엔진',
    '교안 자동 넘김 · 쉬는 시간 감지 · 실시간 AI 튜터 · Notion 내보내기',
    'Antigravity 연결, 새 녹음 알약, PDF 글자 쓰기까지. 다음을 눌러 하나씩 살펴보세요.'
  ],
  Icon: Sparkles,
  tile: 'from-sky-50 to-blue-100',
  tint: 'text-sky-700',
  illustration: 'hero'
}

const pick = (pages: WhatsNewPage[], ...ids: string[]): WhatsNewPage[] => ids.map((id) => pages.find((p) => p.id === id)!)
const byBadge = (pages: WhatsNewPage[], badge: WhatsNewPage['badge']): WhatsNewPage[] => pages.filter((p) => p.badge === badge)
const misc = PAGES_061.find((p) => p.id === 'misc')!
const own061 = PAGES_061.filter((p) => p.id !== 'misc')

export const RELEASE_NOTES: ReleaseNotes[] = [
  {
    version: '0.6.1',
    headline: '녹음 알약이 정리되고, Antigravity로도 연결돼요',
    // big things first: new features (0.6.1 then 0.6.0), then improvements, small fixes bundled last
    pages: [
      HERO_PAGE,
      ...pick(PAGES_061, 'live'),
      ...pick(PAGES_060, 'autoPage', 'breakDetect'),
      ...byBadge(own061, '신기능').filter((p) => p.id !== 'live'),
      ...byBadge(PAGES_060, '신기능').filter((p) => p.id !== 'autoPage' && p.id !== 'breakDetect'),
      ...byBadge(own061, '개선'),
      ...byBadge(PAGES_060, '개선'),
      misc
    ]
  },
  {
    version: '0.6.0',
    headline: '강의를 듣는 동안 Dictly가 옆에서 같이 따라가요',
    pages: PAGES_060
  }
]

export function notesForVersion(version: string): ReleaseNotes | null {
  return RELEASE_NOTES.find((r) => r.version === version) ?? null
}
