// 실시간 AI 튜터 — batches final chunks into ~25 s / 400-char blocks and streams ONE ELI5
// explanation at a time into the store (single-flight; blocks that arrive mid-stream coalesce
// into the next request). Cards live in the store for the session and are saved as a
// 'live_tutor' studio memo when the recording stops.
import { useStore } from '../store/useStore'
import { stripCiteTokens } from '../lib/citations'
import { TUTOR_INSTRUCTION, TUTOR_SIMPLER_INSTRUCTION, tutorContent } from './livePrompts'
import type { LiveTutorCard, LiveTutorContent, StudioSourceMap } from '../../../shared/types'

export const BLOCK_SEC = 25
export const BLOCK_CHARS = 400
export const IDLE_MS = 12_000
const SKIP_TOKEN = '[[SKIP]]'

type Block = { text: string; tStart: number; tEnd: number; fromIdx: number; toIdx: number }

/** strip a complete or partially-streamed [[SKIP]] token */
function stripSkip(text: string): { body: string; skipped: boolean } {
  const skipped = text.includes(SKIP_TOKEN)
  const body = text
    .replace(/\[\[\s*SKIP\s*\]\]/g, '')
    .replace(/\[\[\s*S?K?I?P?\]?\]?$/i, '')
    .trim()
  return { body, skipped }
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
  private inflight: { sid: string; cardId: string } | null = null
  private idleTimer: number | null = null
  private lastPartialAt = 0
  private explained: { text: string; md: string }[] = [] // previous blocks + explanations (context)
  private done: Promise<void> | null = null
  private doneResolve: (() => void) | null = null

  constructor(
    readonly memoId: number,
    readonly pageText: () => { page: number; text: string } | null
  ) {}

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
    const block = this.blockText(b)
    const page = this.pageText()
    const cardId = replaceCardId ?? `lt_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
    const sid = `tutor_${cardId}`
    this.inflight = { sid, cardId }
    st.setLiveTutor({ status: 'thinking', streaming: { cardId, md: '', tStart: b.tStart, tEnd: b.tEnd, pdfPage: page?.page ?? null }, error: null })
    const content = tutorContent({
      pageNo: page?.page ?? null,
      pageText: page?.text ?? null,
      earlier: this.explained
        .slice(-2)
        .map((e) => e.text)
        .join(' '),
      previousExplanations: this.explained.slice(-2).map((e) => e.md),
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
      else s2.pushLiveTutorCard(card)
      this.explained.push({ text: block, md: body })
      if (this.explained.length > 4) this.explained.shift()
    }
    s2.setLiveTutor({ streaming: null, status: this.stopped ? 'idle' : 'listening' })
    this.settle()
  }

  /** after a stream ends: run the coalesced pending block, or resolve the stop promise */
  private settle(): void {
    if (this.stopped) {
      const p = this.pending
      this.pending = null
      if (p && !this.inflight) {
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
    const st = useStore.getState()
    const cards = st.liveTutor.cards
    if (!cards.length) return
    const memo = st.memo?.id === this.memoId ? st.memo : await window.api.memos.get(this.memoId)
    const pdfId = st.focusedPdfId
    const pdf = memo?.pdfs.find((p) => p.id === pdfId) ?? null
    const sources: StudioSourceMap = { pdfs: pdf ? [{ index: 1, pdfId: pdf.id, name: pdf.name }] : [], sourceCount: 1 + (pdf ? 1 : 0) }
    const content: LiveTutorContent = { cards, pdfName: pdf?.name }
    const title = `실시간 튜터 · ${stripCiteTokens(memo?.title ?? '').trim() || '강의'}`
    try {
      await window.api.studio.add({ memoId: this.memoId, folderId: null, kind: 'live_tutor', title, options: {}, content, sources })
      if (useStore.getState().selectedMemoId === this.memoId) void useStore.getState().refreshStudioItems()
    } catch (e) {
      useStore.getState().showToast(`실시간 튜터 저장 실패: ${(e as Error).message}`)
    }
  }
}
