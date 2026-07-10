// Chat slash-command registry. Each command matches BOTH an English and a Korean alias, and belongs
// to a group (shown as a section header in the palette). All are grounded chat commands.

export interface SlashCommand {
  id: string
  aliases: string[] // e.g. ['/summary', '/요약'] — matched by prefix, case-insensitive
  label: string // shown in the palette
  hint: string
  group: string // palette section
}

/** palette section order */
export const SLASH_GROUPS = ['요약·정리', '강의 포인트', '일정·할 일']

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'summary', aliases: ['/summary', '/요약'], label: '핵심 요약', hint: '강의 핵심 내용을 요약', group: '요약·정리' },
  { id: 'formula', aliases: ['/formula', '/formulas', '/공식'], label: '공식 시트', hint: '등장한 공식·수식을 한곳에 정리', group: '요약·정리' },
  { id: 'glossary', aliases: ['/glossary', '/용어'], label: '용어 사전', hint: '핵심 용어와 정의', group: '요약·정리' },
  { id: 'cheatsheet', aliases: ['/cheatsheet', '/cheat', '/치트'], label: '치트시트', hint: '시험용 한 장 압축 요약', group: '요약·정리' },
  { id: 'highlight', aliases: ['/highlight', '/강조'], label: '강조 정리', hint: '강조·반복된 부분을 중요도(★)순으로', group: '강의 포인트' },
  { id: 'textbook', aliases: ['/textbook', '/교재'], label: '교재 페이지 정리', hint: '언급된 교재 페이지별 핵심을 페이지 순서로', group: '강의 포인트' },
  { id: 'timeline', aliases: ['/timeline', '/타임라인'], label: '타임라인', hint: '시간 순 주제 흐름', group: '강의 포인트' },
  { id: 'todo', aliases: ['/todo', '/tasks', '/할일'], label: '할 일·액션', hint: '공지된 과제·시험 등 할 일', group: '일정·할 일' },
  { id: 'schedule', aliases: ['/schedule', '/일정'], label: '일정', hint: '강의에서 언급된 일정을 날짜순으로 정리', group: '일정·할 일' },
]

/** group the (filtered) matches into palette sections, preserving SLASH_GROUPS order */
export function groupMatches(matches: SlashCommand[]): { group: string; items: SlashCommand[] }[] {
  return SLASH_GROUPS.map((g) => ({ group: g, items: matches.filter((c) => c.group === g) })).filter((s) => s.items.length > 0)
}

export interface SlashMatch {
  token: string // typed token incl. leading '/', lowercased
  extra: string // text after the first space (extra user context)
  matches: SlashCommand[]
}

/** If `input` starts with '/', return the command token, any trailing text, and prefix matches. */
export function matchSlash(input: string): SlashMatch | null {
  if (!input.startsWith('/')) return null
  const sp = input.indexOf(' ')
  const token = (sp === -1 ? input : input.slice(0, sp)).toLowerCase()
  const extra = sp === -1 ? '' : input.slice(sp + 1).trim()
  const matches = SLASH_COMMANDS.filter((c) => c.aliases.some((a) => a.toLowerCase().startsWith(token)))
  return { token, extra, matches }
}

/** Exact command for a fully-typed alias (used when sending without picking from the palette). */
export function exactSlash(input: string): { cmd: SlashCommand; extra: string } | null {
  const m = matchSlash(input)
  if (!m) return null
  const cmd = SLASH_COMMANDS.find((c) => c.aliases.some((a) => a.toLowerCase() === m.token))
  return cmd ? { cmd, extra: m.extra } : null
}
