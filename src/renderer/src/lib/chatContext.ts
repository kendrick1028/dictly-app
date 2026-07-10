// Shared grounding for ad-hoc AI chat (Spotlight search). A "source" is a note/lecture/PDF
// attached as context; we fetch its text and build a prompt that the streaming ai:ask handler
// answers. (The 채팅 tab uses manifest-grounded studio.chatStream instead — see ChatView.)

export interface ChatSource {
  kind: 'note' | 'memo' | 'pdf'
  id: number
  title: string
  /** owning 과목(folder) name — shown in the context so the model knows the source's subject */
  folderName?: string | null
}

export const CHAT_SYSTEM_PROMPT = '당신은 한국어로 답하는 학습 도우미입니다. 사용자의 강의·노트·PDF 학습을 정확하고 간결하게 돕습니다.'
export const CHAT_INSTRUCTION =
  '아래 "참고 자료"는 사용자의 노트·강의 전사·PDF에서 질문과 관련 있을 만한 내용을 모은 것입니다. 질문에 한국어로 명확하고 간결하게 답하세요. ' +
  '먼저 참고 자료에서 답을 찾고 그 내용을 근거로 답하세요(관련 없는 자료는 무시). 자료에 답이 없으면 "제공된 자료에는 없지만"이라고 밝힌 뒤 일반 지식으로 답하세요. ' +
  '이전 대화 맥락을 이어서 답하세요. 필요하면 마크다운과 $...$ 수식 표기를 사용하세요.'

const LABEL: Record<ChatSource['kind'], string> = { note: '노트', memo: '강의', pdf: 'PDF' }

export async function fetchSourceText(c: ChatSource): Promise<string> {
  try {
    if (c.kind === 'note') return (await window.api.notes.get(c.id))?.plainText || ''
    if (c.kind === 'memo') {
      const m = await window.api.memos.get(c.id)
      return m?.transcriptMd || (m?.segments.map((s) => s.text).join(' ') ?? '')
    }
    const pages = await window.api.pdfs.getExtractedPages(c.id)
    return (pages || []).join('\n')
  } catch {
    return ''
  }
}

/** build the `content` payload: 참고 자료 + 이전 대화 + 질문 */
export async function buildChatContent(question: string, sources: ChatSource[], history: { role: 'user' | 'assistant'; content: string }[]): Promise<string> {
  const parts: string[] = []
  for (const c of sources) {
    const text = (await fetchSourceText(c)).slice(0, 7000).trim()
    const subject = c.folderName ? ` (과목: ${c.folderName})` : ''
    parts.push(`## ${LABEL[c.kind]}: ${c.title}${subject}\n${text || '(내용 없음)'}`)
  }
  const ctx = parts.length ? `# 참고 자료 (질문과 관련된 것만 사용)\n${parts.join('\n\n')}\n\n` : ''
  const convo = history.length ? `# 이전 대화\n${history.map((m) => `${m.role === 'user' ? '사용자' : '어시스턴트'}: ${m.content}`).join('\n')}\n\n` : ''
  return `${ctx}${convo}# 질문\n${question}`
}
