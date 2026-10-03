// 코파일럿 (live lecture companion) — batches final chunks into ~25 s / 400-char blocks and streams
// ONE explanation at a time into the store (single-flight; blocks that arrive mid-stream coalesce
// into the next request). Cards live in the store for the session and are saved as a
// 'live_tutor' studio memo when the recording stops.
//
// Session memory: every card's [[META]] footer yields a one-line gist + the terms it defined. The
// gists become the "강의 흐름" list and the terms the "이미 설명한 용어" glossary in later prompts, so
// the copilot stops re-defining what it already covered and can refer back ("아까 나온 ~").
import { useStore } from '../store/useStore'
import { stripCiteTokens } from '../lib/citations'
import { TUTOR_INSTRUCTION, TUTOR_SIMPLER_INSTRUCTION, TUTOR_QA_INSTRUCTION, tutorContent, tutorQaContent, parseTutorMeta, stripTutorMarkers, splitKeywordLine } from './livePrompts'
import type { LiveTutorCard, LiveTutorContent, StudioItem, StudioSourceMap } from '../../../shared/types'

export const BLOCK_SEC = 25
export const BLOCK_CHARS = 400
export const IDLE_MS = 12_000
const SKIP_TOKEN = '[[SKIP]]'
const FLOW_CAP = 14 // gists kept in the prompt (oldest dropped)
const GLOSSARY_CAP = 40
const CARRY_CHARS = 350 // how much of a skipped block is carried into the next prompt

type Block = { text: string; tStart: number; tEnd: number; fromIdx: number; toIdx: number }

/** display text: [[SKIP]] / [[META…]] removed (also while still streaming in) */
function stripSkip(text: string): { body: string; skipped: boolean } {
  const skipped = text.includes(SKIP_TOKEN)
  return { body: stripTutorMarkers(text), skipped }
}

export function tutorSystemPrompt(): string {
  const st = useStore.getState()
  const agent = st.agents.find((a) => a.id === (st.memo?.agentId ?? st.activeAgentId))
  const kw = [...(st.memo?.keywords ?? []), ...(agent?.keywords ?? [])].slice(0, 60).join(', ')
  const parts = [agent?.systemPrompt ?? '']
  if (kw) parts.push(`[이 강의의 핵심 용어] ${kw}`)
  return parts.filter(Boolean).join('\n\n')
}

export class LiveTutorController {
  private stopped = false
  private buf: Block | null = null
  private pending: Block | null = null
  private inflight: { sid: string; cardId: string; block?: Block } | null = null
  private questions: string[] = [] // typed questions waiting for the streaming slot (served before pending blocks)
  private idleTimer: number | null = null
  private lastPartialAt = 0
  private explained: { text: string; md: string }[] = [] // previous blocks + explanations (context)
  private flow: string[] = [] // one-line gist per card — the session's running outline
  private carry: Block | null = null // a skipped (transitional) block: folded into the next one so its lead-in isn't lost
  private glossary: string[] = [] // terms the copilot has already defined this session
  private done: Promise<void> | null = null
  private doneResolve: (() => void) | null = null

  constructor(
    readonly memoId: number,
    readonly pageText: () => { page: number; text: string } | null
  ) {
    void this.restore()
  }

  /** continue this note's 코파일럿: cards already in the panel (same note) or the saved studio item */
  private async restore(): Promise<void> {
    const st = useStore.getState()
    let cards = st.liveTutor.memoId === this.memoId ? st.liveTutor.cards : []
    if (!cards.length) {
      const item = await findCopilotItem(this.memoId)
      if (this.stopped) return
      cards = item ? ((item.content as LiveTutorContent).cards ?? []) : []
      if (cards.length) useStore.getState().setLiveTutor({ cards, memoId: this.memoId })
    }
    // rebuild the session memory from the cards so the copilot doesn't re-define earlier terms
    for (const c of cards) {
      if (c.question) continue
      const { keywords, body } = splitKeywordLine(c.md)
      const gist = body.split('\n').find((l) => l.trim() && !l.trim().startsWith('>'))?.replace(/[*_`>-]/g, '').trim().slice(0, 80)
      if (gist) this.flow.push(gist)
      for (const t of keywords) if (!this.glossary.some((g) => g.toLowerCase() === t.toLowerCase())) this.glossary.push(t)
    }
    if (this.flow.length > 40) this.flow.splice(0, this.flow.length - 40)
    if (this.glossary.length > GLOSSARY_CAP) this.glossary.splice(0, this.glossary.length - GLOSSARY_CAP)
  }

  private get active(): boolean {
    const st = useStore.getState()
    return st.liveTutorOpen && st.aiReady && st.liveTutor.status !== 'paused'
  }

  // ───────────────────────── input ─────────────────────────
  onFinalSegment(idx: number): void {
    if (this.stopped) return
    const st = useStore.getState()
    const seg = st.rec.liveSegments[idx]
    if (!seg || !seg.text.trim()) return
    if (!this.active) {
      // panel closed / paused: keep the newest block only, so opening it explains what's current
      this.buf = null
      return
    }
    if (!this.buf) this.buf = { text: seg.text, tStart: seg.tStart, tEnd: seg.tEnd, fromIdx: idx, toIdx: idx }
    else {
      this.buf.text += ' ' + seg.text
      this.buf.tEnd = seg.tEnd
      this.buf.toIdx = idx
    }
    if (st.liveTutor.status === 'idle') st.setLiveTutor({ status: 'listening' })
    const span = this.buf.tEnd - this.buf.tStart
    if (span >= BLOCK_SEC || this.buf.text.length >= BLOCK_CHARS) this.flush()
    else this.armIdle()
  }

  onPartial(text: string): void {
    if (text) this.lastPartialAt = Date.now()
  }

  /** "지금 설명": explain whatever has accumulated (including the live preview text) */
  explainNow(): void {
    const st = useStore.getState()
    const partial = st.rec.partial.trim()
    if (partial) {
      const last = st.rec.liveSegments[st.rec.liveSegments.length - 1]
      const t = last?.tEnd ?? 0
      if (!this.buf) this.buf = { text: partial, tStart: t, tEnd: t, fromIdx: -1, toIdx: -1 }
      else this.buf.text += ' ' + partial
    }
    this.flush()
  }

  private armIdle(): void {
    if (this.idleTimer != null) window.clearTimeout(this.idleTimer)
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = null
      // the lecturer is still mid-sentence (partial text arriving) → wait a little more
      if (Date.now() - this.lastPartialAt < 3000) {
        this.armIdle()
        return
      }
      this.flush()
    }, IDLE_MS)
  }

  private flush(): void {
    if (this.idleTimer != null) {
      window.clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    const b = this.buf
    this.buf = null
    if (!b || b.text.trim().length < 20) return
    if (this.inflight) {
      // coalesce into the pending block — explained as one unit when the current stream ends
      if (!this.pending) this.pending = b
      else {
        this.pending.text += ' ' + b.text
        this.pending.tEnd = b.tEnd
        this.pending.toIdx = b.toIdx
      }
      return
    }
    void this.explain(b, TUTOR_INSTRUCTION)
  }

  // ───────────────────────── streaming ─────────────────────────
  /** latest store text for the block's chunks (they may have been corrected since) */
  private blockText(b: Block): string {
    if (b.fromIdx < 0) return b.text
    const segs = useStore.getState().rec.liveSegments
    const parts = segs.slice(b.fromIdx, b.toIdx + 1).map((s) => s.text.trim()).filter(Boolean)
    const fromStore = parts.join(' ')
    // keep any un-indexed tail (explainNow's partial) that isn't in the store
    return fromStore.length >= b.text.length * 0.5 ? fromStore : b.text
  }

  private async explain(b: Block, instruction: string, replaceCardId?: string): Promise<void> {
    const st = useStore.getState()
    if (!replaceCardId && this.carry) {
      // a block the copilot skipped as "just a transition" becomes the lead-in of this one
      const lead = this.blockText(this.carry).slice(-CARRY_CHARS)
      b = { ...b, text: `${lead} ${this.blockText(b)}`, tStart: Math.min(this.carry.tStart, b.tStart), fromIdx: -1, toIdx: -1 }
      this.carry = null
    }
    const block = this.blockText(b)
    const page = this.pageText()
    const cardId = replaceCardId ?? `lt_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
    const sid = `tutor_${cardId}`
    this.inflight = { sid, cardId, block: replaceCardId ? undefined : b }
    st.setLiveTutor({ status: 'thinking', streaming: { cardId, md: '', tStart: b.tStart, tEnd: b.tEnd, pdfPage: page?.page ?? null }, error: null })
    const content = tutorContent({
      pageNo: page?.page ?? null,
      pageText: page?.text ?? null,
      earlier: this.explained
        .slice(-2)
        .map((e) => e.text)
        .join(' '),
      flow: this.flow.slice(-FLOW_CAP),
      glossary: this.glossary,
      previousExplanations: this.explained.slice(-1).map((e) => e.md),
      block
    })
    let raw = ''
    try {
      raw = await window.api.ai.ask(sid, instruction, content, tutorSystemPrompt(), useStore.getState().claudeModel, (full) => {
        if (this.inflight?.sid !== sid) return
        const { body } = stripSkip(full)
        useStore.getState().setLiveTutor({ streaming: { cardId, md: body, tStart: b.tStart, tEnd: b.tEnd, pdfPage: page?.page ?? null } })
      })
    } catch (e) {
      const msg = (e as Error).message
      if (this.inflight?.sid === sid) {
        this.inflight = null
        const aborted = msg.includes('중단') || /abort/i.test(msg)
        useStore.getState().setLiveTutor({ streaming: null, status: this.stopped ? 'idle' : 'listening', error: aborted ? null : msg })
      }
      this.settle()
      return
    }
    if (this.inflight?.sid !== sid) return // superseded (closed / stopped)
    this.inflight = null
    const { body, skipped } = stripSkip(raw)
    const s2 = useStore.getState()
    if (skipped && !replaceCardId) this.carry = { ...b, text: block }
    if (!skipped && body) {
      const card: LiveTutorCard = {
        id: cardId,
        tStart: b.tStart,
        tEnd: b.tEnd,
        sourceText: block,
        md: body,
        pdfPage: page?.page ?? null,
        createdAt: Date.now()
      }
      if (replaceCardId) s2.updateLiveTutorCard(replaceCardId, { md: body })
      else {
        s2.pushLiveTutorCard(card)
        this.explained.push({ text: block, md: body })
        if (this.explained.length > 4) this.explained.shift()
        // session memory from the footer (a re-explanation of an old card adds nothing new)
        const meta = parseTutorMeta(raw)
        if (meta.gist) this.flow.push(meta.gist)
        else this.flow.push(body.split('\n').find((l) => l.trim() && !l.trim().startsWith('>'))?.replace(/[*_`]/g, '').slice(0, 80) ?? '')
        if (this.flow.length > 40) this.flow.shift()
        for (const t of [...meta.terms, ...splitKeywordLine(body).keywords]) {
          if (!this.glossary.some((g) => g.toLowerCase() === t.toLowerCase())) this.glossary.push(t)
        }
        if (this.glossary.length > GLOSSARY_CAP) this.glossary.splice(0, this.glossary.length - GLOSSARY_CAP)
      }
    }
    s2.setLiveTutor({ streaming: null, status: this.stopped ? 'idle' : 'listening' })
    this.settle()
  }

  /** after a stream ends: answer a waiting question first, then the coalesced pending block */
  private settle(): void {
    if (this.inflight) return
    const q = this.questions.shift()
    if (q) {
      void this.answer(q)
      return
    }
    if (this.stopped) {
      const p = this.pending
      this.pending = null
      if (p) {
        void this.explain(p, TUTOR_INSTRUCTION) // last block still gets its explanation
        return
      }
      this.doneResolve?.()
      return
    }
    const p = this.pending
    this.pending = null
    if (p && this.active) void this.explain(p, TUTOR_INSTRUCTION)
  }

  // ───────────────────────── questions ─────────────────────────
  /** the student typed a question: it takes the streaming slot next. A running explanation is
   *  aborted and its block re-queued, so the answer comes right away and nothing is lost. */
  ask(question: string): void {
    const q = question.trim()
    if (!q) return
    this.questions.push(q)
    if (this.inflight) {
      if (this.inflight.block) {
        const b = this.inflight.block
        if (!this.pending) this.pending = b
        else this.pending = { ...b, text: `${b.text} ${this.pending.text}`, tEnd: this.pending.tEnd, toIdx: this.pending.toIdx, fromIdx: -1 }
      }
      void window.api.ai.abort(this.inflight.sid) // its catch handler calls settle() → answer()
      return
    }
    this.settle()
  }

  /** recent lecturer speech for a question (last ~1500 chars of the live transcript) */
  private recentTranscript(): string {
    const segs = useStore.getState().rec.liveSegments
    const parts: string[] = []
    let n = 0
    for (let i = segs.length - 1; i >= 0 && n < 1500; i--) {
      const t = segs[i].text.trim()
      if (!t) continue
      parts.unshift(t)
      n += t.length
    }
    return parts.join(' ')
  }

  private async answer(question: string): Promise<void> {
    const st = useStore.getState()
    const page = this.pageText()
    const cardId = `lq_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
    const sid = `tutor_${cardId}`
    const last = st.rec.liveSegments[st.rec.liveSegments.length - 1]
    const t = last?.tEnd ?? 0
    this.inflight = { sid, cardId }
    st.setLiveTutor({ status: 'thinking', streaming: { cardId, md: '', tStart: t, tEnd: t, pdfPage: page?.page ?? null }, error: null })
    // the question shows above the streaming answer right away
    st.pushLiveTutorCard({ id: cardId, tStart: t, tEnd: t, sourceText: question, md: '', pdfPage: page?.page ?? null, createdAt: Date.now(), question })
    const content = tutorQaContent({
      pageNo: page?.page ?? null,
      pageText: page?.text ?? null,
      recent: this.recentTranscript(),
      flow: this.flow.slice(-FLOW_CAP),
      glossary: this.glossary,
      question
    })
    let raw = ''
    try {
      raw = await window.api.ai.ask(sid, TUTOR_QA_INSTRUCTION, content, tutorSystemPrompt(), useStore.getState().claudeModel, (full) => {
        if (this.inflight?.sid !== sid) return
        useStore.getState().setLiveTutor({ streaming: { cardId, md: stripTutorMarkers(full), tStart: t, tEnd: t, pdfPage: page?.page ?? null } })
      })
    } catch (e) {
      const msg = (e as Error).message
      if (this.inflight?.sid === sid) {
        this.inflight = null
        const aborted = msg.includes('중단') || /abort/i.test(msg)
        useStore.getState().updateLiveTutorCard(cardId, { md: aborted ? '(답변이 중단됐어요)' : `답변 실패: ${msg}` })
        useStore.getState().setLiveTutor({ streaming: null, status: this.stopped ? 'idle' : 'listening', error: null })
      }
      this.settle()
      return
    }
    if (this.inflight?.sid !== sid) return
    this.inflight = null
    const s2 = useStore.getState()
    s2.updateLiveTutorCard(cardId, { md: stripTutorMarkers(raw) || '(답을 만들지 못했어요)' })
    s2.setLiveTutor({ streaming: null, status: this.stopped ? 'idle' : 'listening' })
    this.settle()
  }

  /** "더 쉽게": re-explain one card at a simpler level (replaces its text) */
  simplify(cardId: string): void {
    if (this.inflight) return
    const card = useStore.getState().liveTutor.cards.find((c) => c.id === cardId)
    if (!card) return
    void this.explain({ text: card.sourceText, tStart: card.tStart, tEnd: card.tEnd, fromIdx: -1, toIdx: -1 }, TUTOR_SIMPLER_INSTRUCTION, cardId)
  }

  abort(): void {
    if (this.inflight) void window.api.ai.abort(this.inflight.sid)
  }

  // ───────────────────────── lifecycle ─────────────────────────
  private stopping: Promise<void> | null = null

  /** recording stopped: flush the tail block, let the in-flight stream finish, then save */
  stop(): Promise<void> {
    if (!this.stopping) this.stopping = this.runStop()
    return this.stopping
  }

  private async runStop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    this.done = new Promise<void>((r) => (this.doneResolve = r))
    if (this.idleTimer != null) {
      window.clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    const b = this.buf
    this.buf = null
    if (b && b.text.trim().length >= 20 && useStore.getState().liveTutorOpen) {
      if (this.inflight) this.pending = b
      else void this.explain(b, TUTOR_INSTRUCTION)
    }
    if (!this.inflight) this.doneResolve?.()
    // safety: never hold the recording finalize for more than 60 s
    await Promise.race([this.done, new Promise<void>((r) => setTimeout(r, 60_000))])
    await this.save()
  }

  /** resolves when stop()'s flush + save are complete */
  async finished(): Promise<void> {
    if (this.stopping) await this.stopping
  }

  private saved = false
  private async save(): Promise<void> {
    if (this.saved) return
    this.saved = true
    await persistCopilotCards(this.memoId)
  }
}

// ───────────────────────── one studio item per note ─────────────────────────
/** the note's 코파일럿 studio item (newest, if several exist from older versions) */
async function findCopilotItem(memoId: number): Promise<StudioItem | null> {
  try {
    const items = await window.api.studio.listForMemo(memoId)
    const mine = items.filter((i) => i.kind === 'live_tutor').sort((a, b) => b.createdAt - a.createdAt)
    return mine[0] ?? null
  } catch {
    return null
  }
}

/** show this note's 코파일럿 in the panel (saved cards) unless the panel already holds it or a recording of
 *  another note is running. Called when the panel opens on a finished note and before a standalone question. */
export async function loadCopilotForNote(memoId: number): Promise<void> {
  const st = useStore.getState()
  if (st.liveTutor.memoId === memoId) return
  if (st.rec.isRecording && st.recordingMemoId != null && st.recordingMemoId !== memoId) return
  const item = await findCopilotItem(memoId)
  const s2 = useStore.getState()
  if (s2.liveTutor.memoId === memoId) return
  const saved = item ? ((item.content as LiveTutorContent).cards ?? []) : []
  s2.setLiveTutor({ cards: saved, memoId, streaming: null, status: 'idle', error: null })
}

/** write the panel's cards into the note's single 코파일럿 item (update if it exists, else create) */
export async function persistCopilotCards(memoId: number): Promise<void> {
  const st = useStore.getState()
  if (st.liveTutor.memoId != null && st.liveTutor.memoId !== memoId) return
  const cards = st.liveTutor.cards.filter((c) => c.md.trim())
  if (!cards.length) return
  const memo = st.memo?.id === memoId ? st.memo : await window.api.memos.get(memoId)
  const pdfId = st.focusedPdfId
  const pdf = memo?.pdfs.find((p) => p.id === pdfId) ?? null
  const existing = await findCopilotItem(memoId)
  const content: LiveTutorContent = { cards, pdfName: pdf?.name ?? (existing?.content as LiveTutorContent | undefined)?.pdfName }
  try {
    if (existing) await window.api.studio.update(existing.id, { content })
    else {
      const sources: StudioSourceMap = { pdfs: pdf ? [{ index: 1, pdfId: pdf.id, name: pdf.name }] : [], sourceCount: 1 + (pdf ? 1 : 0) }
      const title = `코파일럿 · ${stripCiteTokens(memo?.title ?? '').trim() || '강의'}`
      await window.api.studio.add({ memoId, folderId: null, kind: 'live_tutor', title, options: {}, content, sources })
    }
    if (useStore.getState().selectedMemoId === memoId) void useStore.getState().refreshStudioItems()
  } catch (e) {
    useStore.getState().showToast(`코파일럿 저장 실패: ${(e as Error).message}`)
  }
}

// ───────────────────────── standalone questions (no recording running) ─────────────────────────
let standaloneSid: string | null = null

/** answer a typed question on a finished note: context = the saved transcript's tail + this session's cards */
export async function askCopilotStandalone(memoId: number, question: string): Promise<void> {
  const q = question.trim()
  if (!q) return
  const st = useStore.getState()
  if (standaloneSid) {
    void window.api.ai.abort(standaloneSid) // the newest question wins
  }
  await loadCopilotForNote(memoId)
  const memo = st.memo?.id === memoId ? st.memo : await window.api.memos.get(memoId)
  const segs = memo?.segments ?? []
  const parts: string[] = []
  let n = 0
  for (let i = segs.length - 1; i >= 0 && n < 2500; i--) {
    const t = segs[i].text.trim()
    if (!t) continue
    parts.unshift(t)
    n += t.length
  }
  const cards = useStore.getState().liveTutor.cards
  const flow = cards
    .filter((c) => !c.question && c.md)
    .map((c) => splitKeywordLine(c.md).body.split('\n').find((l) => l.trim() && !l.trim().startsWith('>'))?.replace(/[*_`>-]/g, '').trim().slice(0, 80) ?? '')
    .filter(Boolean)
    .slice(-FLOW_CAP)
  const glossary = Array.from(new Set(cards.flatMap((c) => splitKeywordLine(c.md).keywords))).slice(-GLOSSARY_CAP)
  const cardId = `lq_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
  const sid = `tutor_${cardId}`
  standaloneSid = sid
  const t = segs.length ? segs[segs.length - 1].tEnd : 0
  const s1 = useStore.getState()
  s1.setLiveTutor({ status: 'thinking', streaming: { cardId, md: '', tStart: t, tEnd: t, pdfPage: null }, error: null })
  s1.pushLiveTutorCard({ id: cardId, tStart: t, tEnd: t, sourceText: q, md: '', pdfPage: null, createdAt: Date.now(), question: q })
  const content = tutorQaContent({ pageNo: null, pageText: null, recent: parts.join(' '), flow, glossary, question: q })
  try {
    const raw = await window.api.ai.ask(sid, TUTOR_QA_INSTRUCTION, content, tutorSystemPrompt(), useStore.getState().claudeModel, (full) => {
      if (standaloneSid !== sid) return
      useStore.getState().setLiveTutor({ streaming: { cardId, md: stripTutorMarkers(full), tStart: t, tEnd: t, pdfPage: null } })
    })
    if (standaloneSid !== sid) return
    useStore.getState().updateLiveTutorCard(cardId, { md: stripTutorMarkers(raw) || '(답을 만들지 못했어요)' })
  } catch (e) {
    if (standaloneSid !== sid) return
    const msg = (e as Error).message
    const aborted = msg.includes('중단') || /abort/i.test(msg)
    useStore.getState().updateLiveTutorCard(cardId, { md: aborted ? '(답변이 중단됐어요)' : `답변 실패: ${msg}` })
  } finally {
    if (standaloneSid === sid) {
      standaloneSid = null
      useStore.getState().setLiveTutor({ streaming: null, status: 'idle' })
      void persistCopilotCards(memoId) // questions asked after the lecture are kept with the note too
    }
  }
}
