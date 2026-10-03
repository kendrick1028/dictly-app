// LiveLectureEngine — thin fan-out + lifecycle owner for the live-lecture pipelines.
// recorderController calls it at exactly four points (start / final segment / partial / stop);
// it forwards to the page tracker, the announcement (break/end) detector and the live tutor.
// Each pipeline fails independently — a dead embedding socket or an aborted AI call never
// touches transcription or the other pipelines.
import { useStore } from '../store/useStore'
import { toast } from '../lib/toastStore'
import { getPdfPages, ocrIndexPdf } from '../lib/pdfText'
import { PageTracker, type TrackerDecision } from './pageTracker'
import { EmbedClient } from './embedClient'
import { PAGE_VERDICT_INSTRUCTION, pageVerdictContent, parseJsonObject } from './livePrompts'
import { LectureIntentDetector } from './lectureIntentDetector'
import { LiveTutorController } from './liveTutorController'
import type { PdfDoc } from '../../../shared/types'

// ── prefs (persisted via window.api.prefs; loaded once at startup) ──
export const PREF_AUTO_PAGE = 'live.autoPage'
export const PREF_INTENT = 'live.intent'
export const PREF_INTENT_END = 'live.intentEnd' // 'stop' | 'suggest'

export function setAutoPagePref(on: boolean): void {
  useStore.getState().setAutoPage({ on, status: on ? (engine?.pdfId != null ? 'following' : 'noPdf') : 'off' })
  void window.api.prefs.set(PREF_AUTO_PAGE, on ? '1' : '')
  if (on) engine?.pageTrackerOn()
}
export function setIntentPref(on: boolean, endAction?: 'stop' | 'suggest'): void {
  const st = useStore.getState()
  const end = endAction ?? st.lectureIntent.endAction
  st.setLectureIntent({ on, endAction: end })
  void window.api.prefs.set(PREF_INTENT, on ? '1' : '')
  void window.api.prefs.set(PREF_INTENT_END, end)
}

/** pause/resume auto page-turn for this recording (PdfViewer "자동" pill) */
export function toggleAutoPageFollow(): void {
  const st = useStore.getState()
  if (!st.autoPage.on) return
  if (st.autoPage.status === 'following' || st.autoPage.status === 'lost') st.setAutoPage({ status: 'paused' })
  else if (st.autoPage.status === 'paused') {
    st.setAutoPage({ status: 'following' })
    engine?.reanchor()
  }
}

let engine: LiveLectureEngine | null = null
export function liveEngine(): LiveLectureEngine | null {
  return engine
}

export class LiveLectureEngine {
  readonly memoId: number
  private tracker = new PageTracker()
  private embed = new EmbedClient()
  private pageVecs: number[][] | null = null
  private pages: string[] | null = null
  pdfId: number | null = null
  private stopped = false
  private unsubscribe: (() => void) | null = null
  private llmBusy = false
  /** last LLM page verdict (diagnostics) */
  lastLlm: { at: number; candidates: number[]; raw: string; page: number | null; confidence: number; error?: string } | null = null
  private embedBusy = false
  private lastTaggedIdx = -1
  readonly intent: LectureIntentDetector
  readonly tutor: LiveTutorController

  constructor(memoId: number) {
    this.memoId = memoId
    this.intent = new LectureIntentDetector(memoId)
    this.tutor = new LiveTutorController(memoId, () => this.currentPageText())
  }

  // ───────────────────────── lifecycle ─────────────────────────
  static start(memoId: number): LiveLectureEngine {
    engine?.stop()
    // one 코파일럿 per note: cards of the SAME note stay (the recording continues them); another
    // note's cards are dropped here and the controller restores this note's saved session
    const lt = useStore.getState().liveTutor
    useStore.getState().setLiveTutor({ status: 'idle', streaming: null, error: null, ...(lt.memoId === memoId ? {} : { cards: [], memoId }) })
    engine = new LiveLectureEngine(memoId)
    engine.boot()
    return engine
  }

  private boot(): void {
    const st = useStore.getState()
    if (st.autoPage.on) this.pageTrackerOn()
    // watch the focused pane + user page flips (store-driven; cheap selector compare)
    let prevFocused = st.focusedPdfId
    let prevPage = st.focusedPdfId != null ? st.currentPdfPage[st.focusedPdfId] : undefined
    let prevTutorOpen = st.liveTutorOpen
    this.unsubscribe = useStore.subscribe((s) => {
      if (this.stopped) return
      // closing the 실시간 튜터 panel (close button, rail, studio expand) aborts its in-flight stream
      if (s.liveTutorOpen !== prevTutorOpen) {
        prevTutorOpen = s.liveTutorOpen
        if (!s.liveTutorOpen) this.tutor.abort()
      }
      const fid = s.focusedPdfId
      const page = fid != null ? s.currentPdfPage[fid] : undefined
      if (fid !== prevFocused) {
        prevFocused = fid
        prevPage = page
        if (s.autoPage.on) void this.attachPdf(fid)
        return
      }
      if (page !== prevPage) {
        prevPage = page
        // a store page we did NOT write = the user flipped → re-anchor + stay quiet for a while
        if (fid != null && fid === this.pdfId && page != null && page !== this.tracker.written) {
          this.tracker.onUserPage(page)
          if (s.autoPage.status === 'lost') s.setAutoPage({ status: 'following' })
        }
      }
    })
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.unsubscribe?.()
    this.unsubscribe = null
    this.embed.close()
    this.intent.stop()
    void this.tutor.stop()
    const st = useStore.getState()
    st.setAutoPage({ status: st.autoPage.on ? 'noPdf' : 'off', flash: null })
    if (engine === this) engine = null
  }

  // ───────────────────────── page tracker ─────────────────────────
  pageTrackerOn(): void {
    if (this.stopped) return
    void this.attachPdf(useStore.getState().focusedPdfId)
  }

  /** re-anchor on whatever page the user is looking at (after a manual pause of following) */
  reanchor(): void {
    const st = useStore.getState()
    if (this.pdfId != null) {
      const p = st.currentPdfPage[this.pdfId]
      if (p) this.tracker.onUserPage(p, false)
    }
  }

  private async attachPdf(pdfId: number | null): Promise<void> {
    const st = useStore.getState()
    this.pdfId = pdfId
    this.pages = null
    this.pageVecs = null
    if (pdfId == null) {
      st.setAutoPage({ status: 'noPdf', engine: 'lexical' })
      return
    }
    const pdf = st.memo?.pdfs.find((p) => p.id === pdfId) ?? null
    if (!pdf) {
      st.setAutoPage({ status: 'noPdf' })
      return
    }
    const res = await getPdfPages(pdf)
    if (this.stopped || this.pdfId !== pdfId) return
    if (res.status === 'ready') {
      this.loadPages(pdf, res.pages)
      return
    }
    if (res.status === 'needsOcr') {
      st.setAutoPage({ status: 'noText' })
      // never spend AI vision silently — offer it
      toast.warning(`교안 "${pdf.name}"에 텍스트가 없어 자동 넘김을 쓸 수 없어요`, {
        duration: 10000,
        action: 'OCR 인덱싱',
        onAction: () => {
          const s2 = useStore.getState()
          const agent = s2.agents.find((a) => a.id === (s2.memo?.agentId ?? s2.activeAgentId))
          s2.showToast('교안 OCR 인덱싱 중… (완료되면 자동 넘김이 시작돼요)')
          void ocrIndexPdf(pdf, agent?.systemPrompt ?? '')
            .then((pages) => {
              if (!this.stopped && this.pdfId === pdfId) this.loadPages(pdf, pages)
            })
            .catch((e: Error) => s2.showToast(`OCR 실패: ${e.message}`))
        }
      })
      return
    }
    st.setAutoPage({ status: 'noText' })
  }

  private loadPages(pdf: PdfDoc, pages: string[]): void {
    const st = useStore.getState()
    this.pages = pages
    this.tracker.setPages(pages)
    const cur = st.currentPdfPage[pdf.id]
    this.tracker.onUserPage(cur || 1, false)
    st.setAutoPage({ status: st.autoPage.status === 'paused' ? 'paused' : 'following', engine: 'lexical' })
    // embeddings are a background upgrade: never awaited by the chunk path
    void this.embed
      .pageVectors(pdf.id, pages)
      .then((vecs) => {
        if (this.stopped || this.pdfId !== pdf.id) return
        this.pageVecs = vecs
        if (vecs) useStore.getState().setAutoPage({ engine: 'lexical+embed' })
      })
      .catch(() => {
        /* lexical only */
      })
  }

  /** diagnostics (dev hook / tooltips) */
  trackerSnapshot(): ReturnType<PageTracker['snapshot']> & { embed: boolean; embedError: string | null; lastLlm: LiveLectureEngine['lastLlm'] } {
    return { ...this.tracker.snapshot(), embed: !!this.pageVecs, embedError: this.embed.unavailable, lastLlm: this.lastLlm }
  }

  /** current page text for the tutor context */
  currentPageText(): { page: number; text: string } | null {
    const p = this.tracker.page
    if (p == null || !this.pages) return null
    const t = this.pages[p - 1]
    return t ? { page: p, text: t } : null
  }

  /** synchronous inference for an arriving FINAL chunk (to be stored at liveSegments[idx]) →
   *  page to tag it with (or null). Lexical decision now; the embedding re-score for the SAME
   *  chunk lands ~20 ms later and may add evidence (retro-tagging the chunk if it turns). */
  inferPage(text: string, idx: number): number | null {
    if (this.stopped || this.pdfId == null || !this.tracker.ready) return null
    const st = useStore.getState()
    if (!st.autoPage.on) return null
    const paused = st.autoPage.status === 'paused'
    const d = this.tracker.observe(text)
    this.applyDecision(d, paused, idx)
    // activity readout: even when nothing turns, show that the chunk was analysed and how well the
    // current page matched (the pill blips on `at`)
    const sn = this.tracker.snapshot()
    const top = sn.lastScores[0]
    useStore.getState().setAutoPage({
      scan: { at: Date.now(), page: this.tracker.page, score: top?.page === this.tracker.page ? top.raw : (sn.lastScores.find((x) => x.page === this.tracker.page)?.raw ?? 0), challenger: sn.votes?.page ?? null, challengerVotes: sn.votes?.count ?? 0 }
    })
    return d.tagPage
  }

  private applyDecision(d: TrackerDecision, paused: boolean, idx: number): void {
    const st = useStore.getState()
    const pdfId = this.pdfId
    if (pdfId == null) return
    if (d.turnTo != null && !paused) {
      st.setCurrentPdfPage(pdfId, d.turnTo)
      st.setAutoPage({ lastTurnAt: Date.now(), lastAutoPage: d.turnTo, flash: { pdfId, page: d.turnTo, at: Date.now() }, status: 'following' })
      if (idx >= 0 && st.rec.liveSegments[idx]) st.setLiveSegmentPage(idx, pdfId, d.turnTo)
    } else if (!paused) {
      const want = d.lost ? 'lost' : 'following'
      if (st.autoPage.status !== want) st.setAutoPage({ status: want })
    }
    if (d.embedQuery && this.pageVecs && this.embed.available && !this.embedBusy) {
      this.embedBusy = true
      const chunkNo = this.tracker.chunk
      const cands: number[] = []
      const cur = this.tracker.page ?? 1
      const n = this.pageVecs.length
      const global = d.lost || cur == null
      for (let p = global ? 1 : Math.max(1, cur - 2); p <= (global ? n : Math.min(n, cur + 4)); p++) cands.push(p)
      void this.embed
        .scorePages(d.embedQuery, this.pageVecs, cands)
        .then((scores) => {
          if (this.stopped) return
          const again = this.tracker.onEmbedScores(chunkNo, scores)
          if (again) this.applyDecision(again, useStore.getState().autoPage.status === 'paused', idx)
        })
        .catch(() => {
          if (!this.embed.available) useStore.getState().setAutoPage({ engine: 'lexical' })
        })
        .finally(() => {
          this.embedBusy = false
        })
    }
    if (d.askLlm && st.aiReady && !this.llmBusy && this.pages) {
      this.llmBusy = true
      const cands = d.askLlm.candidates.map((p) => ({ page: p, text: this.pages?.[p - 1] ?? '' }))
      const sid = `page_${Date.now()}`
      const askedCands = d.askLlm.candidates
      void window.api.ai
        .ask(sid, PAGE_VERDICT_INSTRUCTION, pageVerdictContent(d.askLlm.query, cands), '', undefined, () => {})
        .then((raw) => {
          if (this.stopped) return
          const j = parseJsonObject<{ page?: number | null; confidence?: number }>(raw)
          const page = typeof j?.page === 'number' ? j.page : null
          const confidence = Number(j?.confidence ?? 0)
          this.lastLlm = { at: Date.now(), candidates: askedCands, raw: raw.slice(0, 200), page, confidence }
          const verdict = this.tracker.onLlmVerdict(page, confidence)
          if (verdict) this.applyDecision(verdict, useStore.getState().autoPage.status === 'paused', -1)
        })
        .catch((e: Error) => {
          this.lastLlm = { at: Date.now(), candidates: askedCands, raw: '', page: null, confidence: 0, error: e.message }
        })
        .finally(() => {
          this.llmBusy = false
        })
    }
  }

  // ───────────────────────── fan-out from the recorder ─────────────────────────
  /** a final chunk was appended at liveSegments[idx] */
  onFinalSegment(idx: number): void {
    if (this.stopped) return
    this.lastTaggedIdx = idx
    this.intent.onFinalSegment(idx)
    this.tutor.onFinalSegment(idx)
  }

  onPartial(text: string): void {
    if (this.stopped) return
    this.tutor.onPartial(text)
  }

  /** a chunk got its AI correction — nothing to do for the tracker (already tagged); tutor reads the store lazily */
  onSegmentCorrected(_idx: number): void {
    /* reserved */
  }

  /** the chunk index most recently handed to the pipelines */
  get lastIndex(): number {
    return this.lastTaggedIdx
  }
}
