// PageTracker — the "where is the lecturer in the 교안" state machine (one instance per recording).
// Pure logic: no store, no DOM, no timers. The engine feeds it chunks + optional async evidence
// (embedding scores, an LLM verdict) and applies the decisions it returns.
//
// Design (MaViLS-style): raw similarity is only half of it — a continuity prior (slides go
// 1→2→3), hysteresis (two consecutive votes, or one overwhelming one), a cooldown between turns
// and a "quiet" period after the user flips a page themselves are what keep it from flapping.
import { blendScores, buildPageIndex, lexicalScores, queryVector, type PageIndex } from './pageMatcher'

// ── tunables ──────────────────────────────────────────────────────────────────────────────
export const WINDOW_CHUNKS = 3 // transcript chunks in the query window
/** recency weights for the window (oldest → newest): the newest chunk dominates */
export const WINDOW_WEIGHTS = [0.25, 0.5, 1.0]
export const WINDOW_CHARS = 350
export const MIN_QUERY_CHARS = 12 // shorter (normalized) chunks are observed, never voted on
export const MIN_SIGNAL = 2.5 // idf mass the NEWEST chunk must carry to vote ("다중 IRR 문제" ≈ 5)
export const WEAK_SIGNAL = 1.0 // below this the chunk is off-topic talk (counts toward "lost")
export const MIN_EVIDENCE = 0.12 // raw score a page needs before it can win
export const STRONG_EVIDENCE = 0.25 // raw score that wins in ONE vote (with 2× margin)
export const MARGIN = 1.15 // winner must beat the current page by this factor …
export const MARGIN_ABS = 0.02 // … plus this absolute gap
export const VOTES_TO_TURN = 2
export const COOLDOWN_MS = 6000 // min gap between auto turns (strong evidence bypasses)
export const QUIET_AFTER_USER_MS = 20000 // stay silent after the user flips a page
export const BACK = 2 // local candidate window: [cur-BACK, cur+FWD]
export const FWD = 4
export const GLOBAL_EVERY = 4 // do a whole-PDF scan every N chunks (recovers from "lost")
export const LOST_AFTER = 3 // consecutive weak windows → lost → global scan each chunk
export const AMBIGUOUS_RATIO = 0.9 // top2/top1 ≥ this → ambiguous (LLM verdict candidate)
export const AMBIGUOUS_STREAK = 2
/** specific-sounding chunks that match NO page for this many chunks = paraphrasing lecturer → ask the LLM */
export const UNMATCHED_STREAK = 2
export const LLM_MIN_GAP_MS = 30000
export const LLM_MAX_CALLS = 20
/** continuity prior by page delta from the current page */
export const PRIOR: Record<number, number> = { 0: 1.0, 1: 0.97, 2: 0.9, 3: 0.85, 4: 0.8, [-1]: 0.9, [-2]: 0.8 }
export const PRIOR_FAR = 0.6
/** weight of embedding evidence in the async re-score (lexical keeps the majority) */
export const EMBED_WEIGHT = 0.4

export type TrackerReason = 'vote' | 'strong' | 'llm' | 'user'

export interface TrackerDecision {
  /** set when the tracker wants the viewer moved to this page */
  turnTo: number | null
  reason: TrackerReason | null
  /** page to tag the arriving chunk with (current page after the decision) */
  tagPage: number | null
  /** ask the engine for an LLM verdict between these candidates (only when ambiguous) */
  askLlm: { candidates: number[]; query: string } | null
  /** ask the engine to embed this query text (fire-and-forget; result arrives via onEmbedScores) */
  embedQuery: string | null
  lost: boolean
}

export interface TrackerSnapshot {
  page: number | null
  lost: boolean
  quiet: boolean
  votes: { page: number; count: number } | null
  lastScores: { page: number; raw: number; adj: number }[]
}

export class PageTracker {
  private index: PageIndex | null = null
  private pageCount = 0
  private cur: number | null = null
  private lastWritten: number | null = null
  private window: string[] = []
  private vote: { page: number; count: number } | null = null
  private lastTurnAt = 0
  private quietUntil = 0
  private chunkNo = 0
  private weakStreak = 0
  private lost = false
  private ambiguousStreak = 0
  private unmatchedStreak = 0
  private lastLlmAt = 0
  private llmCalls = 0
  /** lexical scores + query of the most recent chunk (re-scored when its embedding arrives) */
  private lastLex: Map<number, number> | null = null
  private lastQuery: string | null = null
  private voteChunkNo = -1
  private turnedChunkNo = -1
  private lastScores: { page: number; raw: number; adj: number }[] = []

  constructor(private now: () => number = () => Date.now()) {}

  /** (re)load the PDF text; resets evidence but keeps the current page anchor if still valid */
  setPages(pages: string[]): void {
    this.index = buildPageIndex(pages)
    this.pageCount = pages.length
    this.vote = null
    this.weakStreak = 0
    this.lost = false
    this.lastLex = null
    if (this.cur != null && this.cur > this.pageCount) this.cur = null
  }

  /** monotonically increasing id of the last observed chunk (pairs async evidence with its chunk) */
  get chunk(): number {
    return this.chunkNo
  }

  get ready(): boolean {
    return !!this.index && this.pageCount > 0
  }

  /** the viewer's current page as we last knew it (from the store, user or us) */
  get page(): number | null {
    return this.cur
  }

  /** the page WE last wrote — anything else in the store is a user gesture */
  get written(): number | null {
    return this.lastWritten
  }

  /** anchor the tracker on a page the user is looking at (start of recording / user flip) */
  onUserPage(page: number, quiet = true): void {
    if (!Number.isFinite(page) || page < 1) return
    this.cur = Math.round(page)
    this.lastWritten = this.cur
    this.vote = null
    this.weakStreak = 0
    this.lost = false
    if (quiet) this.quietUntil = this.now() + QUIET_AFTER_USER_MS
  }

  /** async embedding evidence for the query returned by observe() (same chunk, ~20 ms later):
   *  re-scores the same window with lexical ⊕ embedding. May ADD evidence (vote / turn) but never
   *  reverts a turn the lexical pass already made. Returns null when nothing changes. */
  onEmbedScores(chunkNo: number, embScores: Map<number, number>): TrackerDecision | null {
    if (chunkNo !== this.chunkNo || !this.lastLex || !embScores.size) return null // stale
    const raw = blendScores(this.lastLex, embScores, EMBED_WEIGHT)
    return this.decide(raw, chunkNo, this.lastQuery ?? '', true)
  }

  /** LLM verdict for an ambiguity request */
  onLlmVerdict(page: number | null, confidence: number): TrackerDecision | null {
    this.lastLlmAt = this.now()
    if (page == null || !(confidence >= 0.7) || page < 1 || page > this.pageCount) return null
    if (page === this.cur) {
      this.vote = null
      return null
    }
    return this.turn(page, 'llm')
  }

  snapshot(): TrackerSnapshot {
    return {
      page: this.cur,
      lost: this.lost,
      quiet: this.now() < this.quietUntil,
      votes: this.vote ? { ...this.vote } : null,
      lastScores: this.lastScores.slice(0, 5)
    }
  }

  /** feed one final transcript chunk (raw text) */
  observe(chunkText: string): TrackerDecision {
    const none: TrackerDecision = { turnTo: null, reason: null, tagPage: this.cur, askLlm: null, embedQuery: null, lost: this.lost }
    const text = (chunkText || '').trim()
    if (!text) return none
    this.window.push(text)
    if (this.window.length > WINDOW_CHUNKS) this.window.shift()
    this.chunkNo++
    if (!this.index || !this.pageCount) return none

    const query = this.window.join(' ').slice(-WINDOW_CHARS)
    const weights = WINDOW_WEIGHTS.slice(WINDOW_WEIGHTS.length - this.window.length)
    const qv = queryVector(this.index, this.window, weights)
    const normalizedLen = text.replace(/\s+/g, '').length
    // observe-only: a tiny chunk ("네 그래서 이제") keeps the window but never votes
    if (normalizedLen < MIN_QUERY_CHARS) return { ...none, tagPage: this.cur }
    // a long chunk whose OWN text carries no PDF signal = off-topic talk → counts toward "lost"
    // (widens the search to the whole PDF once the lecturer comes back to the slides)
    const own = queryVector(this.index, text)
    if (!qv || !own || own.signal < WEAK_SIGNAL) {
      this.weakStreak++
      if (this.weakStreak >= LOST_AFTER) this.lost = true
      return { ...none, tagPage: this.cur, lost: this.lost }
    }
    // generic lecture connective ("그래서 이걸 보면 여기서 중요한 게…") — too vague to vote on
    if (own.signal < MIN_SIGNAL) return { ...none, tagPage: this.cur }

    // candidate set
    const cur = this.cur
    const global = cur == null || this.lost || this.chunkNo % GLOBAL_EVERY === 0
    const cands: number[] = []
    if (global) for (let p = 1; p <= this.pageCount; p++) cands.push(p)
    else for (let p = Math.max(1, cur! - BACK); p <= Math.min(this.pageCount, cur! + FWD); p++) cands.push(p)

    const lex = lexicalScores(this.index, qv.vec, cands)
    this.lastLex = lex
    this.lastQuery = query
    const d = this.decide(lex, this.chunkNo, query, false) ?? { ...none, embedQuery: query }

    // paraphrase detection on the NEWEST chunk alone (the window's residue from earlier chunks
    // would mask it): specific words, yet no page matches → the lecturer is explaining the slide
    // in their own words. Only the LLM can read that — ask it with the local candidates.
    let ownTop = 0
    for (const v of lexicalScores(this.index, own.vec, cands).values()) if (v > ownTop) ownTop = v
    if (ownTop < MIN_EVIDENCE) {
      this.unmatchedStreak++
      if (!d.askLlm && !d.turnTo && cur != null && this.unmatchedStreak >= UNMATCHED_STREAK && this.llmBudgetOk()) {
        this.spendLlm()
        this.unmatchedStreak = 0
        const local: number[] = []
        for (let p = Math.max(1, cur - 1); p <= Math.min(this.pageCount, cur + 3); p++) local.push(p)
        d.askLlm = { candidates: local, query }
      }
    } else this.unmatchedStreak = 0
    return d
  }

  /** the decision rule shared by the sync (lexical) pass and the async (embedding) re-score.
   *  `rescore` = second pass for the same chunk: its vote REPLACES the first pass's vote for this
   *  chunk (no double counting) and it can never undo a turn already made for this chunk. */
  private decide(raw: Map<number, number>, chunkNo: number, query: string, rescore: boolean): TrackerDecision | null {
    const cur = this.cur
    const none: TrackerDecision = { turnTo: null, reason: null, tagPage: cur, askLlm: null, embedQuery: rescore ? null : query, lost: this.lost }
    if (rescore && this.turnedChunkNo === chunkNo) return null // already turned on this chunk

    // continuity prior
    const adj = new Map<number, number>()
    for (const [p, r] of raw) {
      const d = cur == null ? 0 : p - cur
      adj.set(p, r * (cur == null ? 1 : (PRIOR[d] ?? PRIOR_FAR)))
    }
    const ranked = [...adj.entries()].sort((a, b) => b[1] - a[1])
    this.lastScores = ranked.slice(0, 5).map(([p, a]) => ({ page: p, raw: raw.get(p) ?? 0, adj: a }))
    if (!ranked.length) return rescore ? null : none

    const [topPage, topAdj] = ranked[0]
    const topRaw = raw.get(topPage) ?? 0
    const second = ranked[1]

    // lost detection: nothing in the window looks like the transcript
    if (topRaw < MIN_EVIDENCE) {
      if (rescore) return null
      this.weakStreak++
      if (this.weakStreak >= LOST_AFTER && !this.lost) this.lost = true
      return { ...none, lost: this.lost }
    }
    if (!rescore) this.weakStreak = 0

    // ambiguity → maybe ask the LLM (rate-limited; only from the sync pass)
    let askLlm: TrackerDecision['askLlm'] = null
    if (!rescore) {
      if (second && second[1] >= topAdj * AMBIGUOUS_RATIO && second[0] !== topPage) {
        this.ambiguousStreak++
        if (this.ambiguousStreak >= AMBIGUOUS_STREAK && this.llmBudgetOk()) {
          this.spendLlm()
          this.ambiguousStreak = 0
          askLlm = { candidates: ranked.slice(0, 3).map(([p]) => p), query }
        }
      } else this.ambiguousStreak = 0
    }

    // no anchor yet → adopt the best page immediately
    if (cur == null) {
      this.lost = false
      return { ...this.turn(topPage, 'vote', chunkNo), askLlm }
    }

    if (topPage === cur) {
      if (!rescore || this.voteChunkNo === chunkNo) this.vote = null // this chunk no longer supports a challenger
      this.lost = false
      return rescore ? null : { ...none, askLlm, lost: false }
    }

    // hysteresis: the challenger must LEAD on VOTES_TO_TURN consecutive chunks and clear the
    // margin on the deciding one (a single overwhelming chunk may turn on its own)
    if (this.vote && this.vote.page === topPage) {
      if (this.voteChunkNo !== chunkNo) this.vote.count++ // a re-score of the same chunk doesn't add a vote
    } else this.vote = { page: topPage, count: 1 }
    this.voteChunkNo = chunkNo
    const curAdj = adj.get(cur) ?? 0
    const beats = topAdj >= curAdj * MARGIN + MARGIN_ABS
    const strong = topRaw >= STRONG_EVIDENCE && topAdj >= curAdj * MARGIN * 2 + MARGIN_ABS
    const quiet = this.now() < this.quietUntil
    const cooling = this.now() - this.lastTurnAt < COOLDOWN_MS
    const enough = strong || (beats && this.vote.count >= VOTES_TO_TURN)
    if (!enough || quiet || (cooling && !strong)) return rescore ? null : { ...none, askLlm }
    this.lost = false
    return { ...this.turn(topPage, strong ? 'strong' : 'vote', chunkNo), askLlm }
  }

  private llmBudgetOk(): boolean {
    return this.llmCalls < LLM_MAX_CALLS && this.now() - this.lastLlmAt >= LLM_MIN_GAP_MS
  }
  private spendLlm(): void {
    this.llmCalls++
    this.lastLlmAt = this.now()
  }

  private turn(page: number, reason: TrackerReason, chunkNo = this.chunkNo): TrackerDecision {
    this.cur = page
    this.lastWritten = page
    this.vote = null
    this.lastTurnAt = this.now()
    this.weakStreak = 0
    this.turnedChunkNo = chunkNo
    return { turnTo: page, reason, tagPage: page, askLlm: null, embedQuery: null, lost: false }
  }
}
