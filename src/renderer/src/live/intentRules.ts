// Rule gate for lecture announcements — pure, unit-testable. Cheap first pass over EVERY final
// chunk; only a hit goes on to the AI classifier (or, without AI, a *strong* hit acts alone).
//
// Two error modes matter: a quoted/explanatory mention ("시험에 '오늘은 여기까지'라는 표현이…",
// "쉬는 시간에 질문하세요") must NOT fire, and the real announcement usually sits at the END of a
// chunk ("…자 그러면 10분 쉬었다 하겠습니다"). So: negative-context patterns veto, and the match
// must land in the trailing part of the chunk.

export type IntentKind = 'break' | 'end' | 'none'

export interface RuleHit {
  kind: IntentKind
  /** 'strong' = may act without AI confirmation; 'weak' = needs the AI classifier */
  strength: 'strong' | 'weak'
  /** announced break length in minutes, when spoken ("10분 쉬고") */
  minutes: number | null
  /** the matched phrase (for the toast) */
  phrase: string
}

const BREAK_STRONG: RegExp[] = [
  /쉬는\s*시간\s*(을|을\s*)?(가지|갖|하|드리|주|갖겠|시작)/,
  /(잠깐|잠시|좀|조금|십|오|\d+\s*분(?:\s*정도|\s*만|\s*간)?)\s*(쉬(었다|고|자|죠|시|겠|었|고\s*하)|휴식)/,
  /쉬었다(가)?\s*(하|시작|합|계속|다시|오)/,
  /쉬고\s*(하|오|합|다시|계속|시작)/,
  /휴식\s*(시간|하겠|하고|할게|합시다|하죠)/,
  /(잠깐|잠시)\s*(쉬|끊|멈추)/
]
const BREAK_WEAK: RegExp[] = [/쉬는\s*시간/, /쉬(자|죠|시죠|어요|겠습니다)/, /휴식(을|\s*(하|할|합|해|시간))/]

const END_STRONG: RegExp[] = [
  /오늘(은|\s*수업은|\s*강의는|\s*여기)?\s*여기(까지|서\s*(마치|끝))/,
  /여기까지\s*(하(고|겠|죠|시죠|겠습니다)|만\s*하|하고\s*(끝|마치))/,
  /(수업|강의)(은|는|을|를)?\s*(여기서\s*)?(마치|마무리|끝내|끝낼|끝나|종료)/,
  /마무리\s*하(겠|도록|고|죠|시죠)/,
  /다음\s*(시간|주|수업|강의)에\s*(뵙|봅|만나|계속|이어|다시|하)/,
  /수고\s*(하셨|많으셨|했)/,
  /(끝내|마치)겠습니다/
]
const END_WEAK: RegExp[] = [/여기까지/, /다음\s*(시간|주)에/, /마무리\s*(하|할|짓|합|해)/, /끝(입니다|이에요|났)/]

/** if any of these appear near the match, it's a mention, not an announcement */
const NEGATIVE: RegExp[] = [
  /(라고|이라고|라는|이라는|라던|라면)\s*(하면|말하면|표현|말|하는|한|할|개념|용어|뜻)/, // quoted speech / "X라는 표현·개념"
  /표현/,
  /예를\s*들(어|면)/,
  /예시/,
  /질문/, // "쉬는 시간에 질문하세요"
  /배울|배우(는|겠)|다룰|다루(는|겠)|볼\s*(내용|거예요|겁니다)/, // "다음 시간에 배울 내용은"
  /여기까지(가|는|의)\s*\d+\s*(장|절|단원|페이지)/, // "여기까지가 3장이고"
  /지난\s*(시간|주)/,
  /했었|했잖|했었죠|했죠\s*그/, // recounting the past
  /(시험|문제|퀴즈)에(서)?\s*(나오|낼|출제)/
]

const MIN_WORDS = 3

function minutesFrom(text: string): number | null {
  const m = text.match(/(\d{1,2})\s*분/)
  if (m) return Number(m[1])
  const ko: Record<string, number> = { 오: 5, 십: 10, 십오: 15, 이십: 20, 삼십: 30 }
  const k = text.match(/(십오|이십|삼십|오|십)\s*분/)
  return k ? (ko[k[1]] ?? null) : null
}

/** where the match sits in the chunk (0 = start, 1 = end) */
function position(text: string, m: RegExpMatchArray): number {
  const idx = m.index ?? 0
  return text.length <= 1 ? 1 : idx / Math.max(1, text.length - 1)
}

export function detectAnnouncement(chunk: string): RuleHit {
  const text = (chunk || '').replace(/\s+/g, ' ').trim()
  const none: RuleHit = { kind: 'none', strength: 'weak', minutes: null, phrase: '' }
  if (!text || text.split(' ').length < MIN_WORDS) return none
  if (NEGATIVE.some((re) => re.test(text))) return none

  const tryList = (list: RegExp[], kind: IntentKind, strength: 'strong' | 'weak'): RuleHit | null => {
    for (const re of list) {
      const m = text.match(re)
      if (!m) continue
      // the announcement must be in the trailing 60% of the chunk (a quoted mention up front
      // followed by unrelated content is not an announcement)
      if (position(text, m) < 0.4 && text.length > 40) continue
      return { kind, strength, minutes: kind === 'break' ? minutesFrom(text) : null, phrase: m[0] }
    }
    return null
  }
  return tryList(BREAK_STRONG, 'break', 'strong') ?? tryList(END_STRONG, 'end', 'strong') ?? tryList(BREAK_WEAK, 'break', 'weak') ?? tryList(END_WEAK, 'end', 'weak') ?? none
}
