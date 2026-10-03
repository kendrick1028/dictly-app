// Prompts for the live-lecture pipelines (page verdict · break/end classifier · ELI5 tutor).
// Renderer-owned: they go out through window.api.ai.ask, so no main-process changes are needed.

/** page-tracker LLM verdict — only asked when lexical/embedding scores are ambiguous */
export const PAGE_VERDICT_INSTRUCTION =
  '강의 전사문 일부와 교안(PDF) 후보 페이지들의 텍스트입니다. 강사가 지금 설명하고 있는 페이지가 어느 것인지 판단하세요. ' +
  '확신이 없으면 page를 null로 두세요. 순수 JSON 한 줄만 출력: {"page": 페이지번호|null, "confidence": 0~1}'

export function pageVerdictContent(recent: string, candidates: { page: number; text: string }[]): string {
  const cands = candidates.map((c) => `[페이지 ${c.page}]\n${c.text.slice(0, 500)}`).join('\n\n')
  return `[최근 전사문]\n${recent}\n\n[후보 페이지]\n${cands}`
}

/** break / end-of-class classifier — asked only after the cheap rule gate fires */
export const INTENT_INSTRUCTION =
  '강의 녹음의 최근 전사문입니다. 강사가 방금 (a) 쉬는 시간을 선언했는지, (b) 오늘 수업을 끝낸다고 했는지, (c) 둘 다 아닌지 판단하세요. ' +
  '주의: "쉬는 시간"이나 "여기까지"라는 말이 인용·예시·설명 속에 나오는 경우(예: 시험 표현 설명, "쉬는 시간에 질문하세요")는 none입니다. ' +
  '실제로 지금 수업을 멈추는 선언일 때만 break/end입니다. 쉬는 시간의 길이가 언급되면 분 단위 숫자로 넣으세요. ' +
  '순수 JSON 한 줄만 출력: {"intent": "break"|"end"|"none", "confidence": 0~1, "minutes": 숫자|null}'

export function intentContent(recent: string[]): string {
  return `[최근 전사문 (오래된 것 → 최신)]\n${recent.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
}

/** 코파일럿 (live lecture companion) */
export const TUTOR_INSTRUCTION =
  '당신은 학생 옆에 앉아 강의를 같이 듣는 코파일럿입니다. 교수님이 [방금 교수님이 말한 내용]에서 설명한 것을, 이 과목을 처음 배우는 학생이 바로 이해하도록 쉬운 말로 다시 풀어 줍니다. 항상 "교수님 설명을 쉽게 다시 말해 주는 것"이지, 새 강의를 하는 것이 아닙니다.\n' +
  '\n' +
  '쓰는 방법:\n' +
  '- 첫 줄은 "**핵심 키워드**: 용어1, 용어2" 입니다. 이번 블록에서 새로 나온 핵심 용어 1~3개만 쉼표로 적고, [이미 설명한 용어]에 있는 것은 넣지 않습니다. 새 용어가 없으면 이 줄을 통째로 생략합니다. 용어의 뜻은 여기 적지 말고 아래 풀이 불릿에서 자연스럽게 설명합니다.\n' +
  '- 그다음 교수님 말 중 핵심이 되는 문장 1~2개를 그대로 골라 인용 블록(">"로 시작하는 줄)으로 보여 주고, 바로 아래에 불릿("- ")으로 풀이를 답니다. 첫 불릿은 "이 말은 ~라는 뜻이에요"처럼 시작하고, 이어서 비유·예시·이유를 불릿 2~4개로. 인용은 전사문 표현을 살리되 음성인식 오류만 문맥과 [교안 페이지]로 바로잡습니다.\n' +
  '- 교수님이 지금 교안의 특정 문장·공식·표를 짚어 설명하고 있으면, [교안 페이지]에서 그 부분도 인용 블록으로 그대로 가져온 뒤 "교안에서 이 부분은 ~라는 의미예요"처럼 풀어 줍니다. 교안 인용은 "> 📄 " 로 시작해 교수님 말 인용과 구분합니다. 교안에 없는 문장을 지어내지 마세요.\n' +
  '- 한 카드에 인용 블록은 모두 합쳐 최대 3개. 인용만 나열하지 말고 인용마다 풀이가 따라옵니다.\n' +
  '- 풀이는 항상 불릿("- ")으로 씁니다. 인용 없이 풀이만 할 때도 불릿입니다. 불릿 내용은 내용에 맞게 바꾸세요: 새 개념이면 일상 비유나 구체적인 숫자 예시로, 계산이면 단계별로, 앞 내용과 이어지면 "아까 ~라고 했죠, 그게 여기서는 ~" 식으로 연결해서. 카드마다 구성을 바꾸세요. 불릿은 카드 전체 3~7개, 한 불릿은 한두 문장으로 짧게(30자 안팎).\n' +
  '- 교수님이 학생에게 질문을 던지거나("~는 뭘까요?", "왜 그럴까요?", "한번 생각해 보세요") 교안의 문제·예제를 풀어 보라고 하면, 그 질문에 직접 답하거나 문제를 [교안 페이지] 내용을 근거로 끝까지 풀어 주세요. 이때는 "**답:**" 또는 "**풀이:**"로 시작하는 불릿을 씁니다. 교수님이 이어서 답을 말했다면 그 답을 쉬운 말로 정리합니다.\n' +
  '- [이미 설명한 용어]에 있는 용어는 다시 정의하지 마세요. 필요하면 "아까 나온 ~"처럼 짧게만 언급합니다. 카드 끝에 용어 정의 목록을 따로 붙이지 않습니다.\n' +
  '- 줄표(—, –)는 쓰지 않습니다. 쉼표, 마침표, 콜론, 괄호로 문장을 나누세요.\n' +
  '- [지금까지 강의 흐름]을 보고 이미 다룬 내용은 반복하지 말고, 이번에 새로 더해진 것만 다룹니다.\n' +
  '- 어려운 한자어·영어 약어는 풀어서. 수식은 꼭 필요할 때만 $...$ KaTeX 표기. 교안 인용 안의 수식도 \\( \\) 나 \\[ \\] 대신 반드시 $...$ 로 씁니다.\n' +
  '\n' +
  '설명할 가치가 있을 때만 씁니다(중요): 다음 중 하나가 [방금 교수님이 말한 내용]에 들어 있을 때만 카드를 씁니다. (a) 새 개념·정의·공식, (b) 숫자를 넣어 계산하거나 구체적 예시로 보여 주는 대목, (c) 학생에게 던진 질문이나 풀어 보라는 문제, (d) "왜 그런지·어떻게 되는지"를 설명하는 논리. ' +
  '그 외에는 다른 말 없이 정확히 [[SKIP]] 만 출력하세요: 잡담·공지·출석·기기 조작, "다시 돌아가서", "그래서 이게 중요합니다", "결과를 쉽게 바꿀 수 있죠"처럼 앞 내용을 잇거나 정리만 하는 전환·강조 문장, 이미 [지금까지 강의 흐름]에서 다룬 내용의 반복, 너무 짧아서 무슨 내용인지 알 수 없는 조각. 애매하면 [[SKIP]] 쪽을 고르세요. 건너뛴 내용은 다음 블록과 합쳐서 다시 보여 드리니 놓칠 걱정은 없습니다.\n' +
  '- 제목·인사·서론 없이 본문만 씁니다.\n' +
  '- 본문이 끝나면 맨 마지막 줄에 기계용 꼬리표를 한 줄 붙입니다(화면에는 보이지 않음): [[META: 요지=이번 설명의 핵심을 한 문장으로; 용어=핵심 키워드 줄에 적은 용어들을 쉼표로 구분, 없으면 비움]]'

export const TUTOR_SIMPLER_INSTRUCTION =
  TUTOR_INSTRUCTION +
  '\n\n이번에는 더 쉽게: 초등학생도 알아듣게 씁니다. 비유를 2개 이상 쓰고, 전문 용어는 가능한 한 일상 단어로 바꿔 말하며, 한 불릿은 더 짧게. 인용 블록과 핵심 키워드 줄은 그대로 유지하세요.'

export function tutorContent(parts: {
  pageNo: number | null
  pageText: string | null
  earlier: string
  /** one-line gist per previous card, oldest → newest (session memory) */
  flow: string[]
  /** terms already defined earlier in this session */
  glossary: string[]
  previousExplanations: string[]
  block: string
}): string {
  const out: string[] = []
  if (parts.pageText && parts.pageNo != null) out.push(`[교안 페이지 p.${parts.pageNo}]\n${parts.pageText.slice(0, 800)}`)
  if (parts.flow.length) out.push(`[지금까지 강의 흐름]\n${parts.flow.map((g, i) => `${i + 1}. ${g}`).join('\n')}`)
  if (parts.glossary.length) out.push(`[이미 설명한 용어]\n${parts.glossary.join(', ')}`)
  if (parts.earlier.trim()) out.push(`[앞선 교수님 말]\n${parts.earlier.slice(-600)}`)
  if (parts.previousExplanations.length) out.push(`[직전 설명]\n${parts.previousExplanations.join('\n---\n').slice(-500)}`)
  out.push(`[방금 교수님이 말한 내용]\n${parts.block}`)
  return out.join('\n\n')
}

/** a question the student typed into the 코파일럿 panel during (or after) the lecture */
export const TUTOR_QA_INSTRUCTION =
  '당신은 학생 옆에 앉아 강의를 같이 듣는 코파일럿입니다. 학생이 [학생의 질문]을 했습니다. 지금까지 들은 강의 내용([최근 교수님 말], [지금까지 강의 흐름], [교안 페이지])을 근거로, 이 과목을 처음 배우는 학생이 바로 이해하도록 쉬운 말로 답하세요.\n' +
  '- 교수님이 이미 이에 대해 말한 부분이 있으면 그 문장을 인용 블록(">")으로 먼저 보여 주고 풀어 줍니다. 교안에 근거가 있으면 "> 📄 " 인용으로 보여 줍니다. 근거가 없으면 지어내지 말고 일반 지식으로 답하되 "강의에서는 아직 안 나온 내용이에요"라고 짧게 밝힙니다.\n' +
  '- 결론부터. 풀이는 불릿("- ") 3~7개, 한 불릿은 한두 문장으로 짧게. 계산이 필요하면 단계별 불릿으로. 수식은 꼭 필요할 때만 $...$ KaTeX. 줄표(—, –)는 쓰지 않습니다.\n' +
  '- [이미 설명한 용어]는 다시 정의하지 않습니다. 제목·인사·서론 없이 본문만 씁니다. 꼬리표([[META]])는 붙이지 않습니다.'

export function tutorQaContent(parts: { pageNo: number | null; pageText: string | null; recent: string; flow: string[]; glossary: string[]; question: string }): string {
  const out: string[] = []
  if (parts.pageText && parts.pageNo != null) out.push(`[교안 페이지 p.${parts.pageNo}]\n${parts.pageText.slice(0, 800)}`)
  if (parts.flow.length) out.push(`[지금까지 강의 흐름]\n${parts.flow.map((g, i) => `${i + 1}. ${g}`).join('\n')}`)
  if (parts.glossary.length) out.push(`[이미 설명한 용어]\n${parts.glossary.join(', ')}`)
  if (parts.recent.trim()) out.push(`[최근 교수님 말]\n${parts.recent.slice(-1500)}`)
  out.push(`[학생의 질문]\n${parts.question}`)
  return out.join('\n\n')
}

/** the machine footer the 코파일럿 appends: [[META: 요지=…; 용어=a, b]] */
export function parseTutorMeta(raw: string): { gist: string; terms: string[] } {
  const m = raw.match(/\[\[\s*META:([\s\S]*?)\]\]/)
  if (!m) return { gist: '', terms: [] }
  const body = m[1]
  const gist = (body.match(/요지\s*=\s*([^;]*)/)?.[1] ?? '').trim()
  const termsRaw = (body.match(/용어\s*=\s*([^;\]]*)/)?.[1] ?? '').trim()
  const terms = termsRaw
    .split(/[,、]/)
    .map((t) => t.trim())
    .filter((t) => t && !/^(없음|비움|none|-)$/i.test(t))
  return { gist, terms }
}

/** split the leading "**핵심 키워드**: a, b" line off a card body → chips + the rest */
export function splitKeywordLine(md: string): { keywords: string[]; body: string } {
  const m = md.match(/^\s*\*{0,2}\s*핵심\s*키워드\s*\*{0,2}\s*[:：]\s*(.+?)\s*$/m)
  if (!m || md.indexOf(m[0]) > 40) return { keywords: [], body: md }
  const keywords = m[1]
    .replace(/\*+/g, '')
    .split(/[,、·]/)
    .map((k) => k.trim())
    .filter((k) => k && k.length <= 30)
  return { keywords, body: md.replace(m[0], '').replace(/^\s*\n/, '').trim() }
}

/** hide [[SKIP]] / [[META…]] from display — including a token still streaming in (any prefix at the tail) */
export function stripTutorMarkers(text: string): string {
  let t = text.replace(/\[\[\s*SKIP\s*\]\]/g, '').replace(/\[\[\s*META:[\s\S]*$/, '')
  // a marker that has only partially arrived: cut any tail that is a prefix of "[[SKIP]]" / "[[META:"
  const tail = t.match(/\[\[?[A-Za-z:\s]*$/)?.[0]
  if (tail && ('[[SKIP]]'.startsWith(tail.replace(/\s/g, '')) || '[[META:'.startsWith(tail.replace(/\s/g, '')))) t = t.slice(0, -tail.length)
  return t.trim()
}

/** parse `{...}` out of a model reply (fences/prose tolerated) */
export function parseJsonObject<T = Record<string, unknown>>(raw: string): T | null {
  const cleaned = (raw || '').replace(/```(?:json)?/gi, '')
  const m = cleaned.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    return JSON.parse(m[0]) as T
  } catch {
    return null
  }
}
