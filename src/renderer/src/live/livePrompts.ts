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

/** live ELI5 tutor */
export const TUTOR_INSTRUCTION =
  '당신은 강의를 옆에서 같이 듣는 친절한 튜터입니다. [방금 강사가 말한 내용]을 이 과목을 처음 배우는 학생(중학생 수준)이 바로 이해하도록 아주 쉽게 풀어 주세요.\n' +
  '출력 형식(반드시 지키세요):\n' +
  '1) 첫 줄: 방금 내용의 핵심을 쉬운 말 한 문장으로.\n' +
  '2) 빈 줄 하나.\n' +
  '3) 일상 비유나 구체적 예시로 풀어 주는 문단 2~3문장. 한 문장은 짧게(30자 안팎), 어려운 한자어·영어 약어는 풀어서.\n' +
  '4) 빈 줄 하나.\n' +
  '5) 마지막에 "**용어**: 뜻" 형태로 이번에 새로 나온 핵심 용어 1~2개만 한 줄씩(굵게는 여기서만).\n' +
  '- [이전 설명]과 겹치는 내용은 반복하지 말고 새로 추가된 내용만 다루세요.\n' +
  '- 음성인식 오류로 보이는 단어는 문맥과 [교안 페이지]를 참고해 바로잡아 이해하세요.\n' +
  '- 수식은 꼭 필요할 때만 $...$ KaTeX 표기를 쓰세요.\n' +
  '- 잡담·공지·출석·기기 조작처럼 학습 내용이 아니면 다른 말 없이 정확히 [[SKIP]] 만 출력하세요.\n' +
  '- 제목·인사·서론 없이 위 형식대로만 출력합니다.'

export const TUTOR_SIMPLER_INSTRUCTION =
  TUTOR_INSTRUCTION.replace('처음 배우는 학생(중학생 수준)', '초등학생') +
  '\n- 이번에는 비유를 2개 이상 쓰고, 전문 용어는 가능한 한 쓰지 말고 일상 단어로 바꿔 말하세요. 한 문장은 더 짧게.'

export function tutorContent(parts: { pageNo: number | null; pageText: string | null; earlier: string; previousExplanations: string[]; block: string }): string {
  const out: string[] = []
  if (parts.pageText && parts.pageNo != null) out.push(`[교안 페이지 p.${parts.pageNo}]\n${parts.pageText.slice(0, 800)}`)
  if (parts.earlier.trim()) out.push(`[앞선 강의 내용]\n${parts.earlier.slice(-600)}`)
  if (parts.previousExplanations.length) out.push(`[이전 설명]\n${parts.previousExplanations.join('\n---\n').slice(-500)}`)
  out.push(`[방금 강사가 말한 내용]\n${parts.block}`)
  return out.join('\n\n')
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
