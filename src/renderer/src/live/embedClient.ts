// Sentence-embedding client for the STT sidecar (`{"type":"embed"}` over its own WebSocket, so it
// never shares the audio stream's socket). Fails soft: after a few errors/timeouts it marks itself
// unavailable for the rest of the session and the page tracker keeps running on lexical scores.
import { denseCosine, embedScoresFromCosines } from './pageMatcher'

const REQUEST_TIMEOUT_MS = 8000
const FIRST_REQUEST_TIMEOUT_MS = 90000 // the first call may download the model (~120 MB)
const MAX_FAILURES = 3

type Pending = { resolve: (v: number[][]) => void; reject: (e: Error) => void; timer: number }

export class EmbedClient {
  private ws: WebSocket | null = null
  private opening: Promise<WebSocket> | null = null
  private pending = new Map<string, Pending>()
  private failures = 0
  private seq = 0
  private everSucceeded = false
  /** set when the client gave up for this session */
  unavailable: string | null = null
  model: string | null = null

  get available(): boolean {
    return !this.unavailable
  }

  private async socket(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return this.ws
    if (this.opening) return this.opening
    this.opening = (async () => {
      const sidecar = await window.api.stt.ensure()
      if (!sidecar.port) throw new Error(sidecar.error ?? 'STT 서버 없음')
      const ws = new WebSocket(`ws://127.0.0.1:${sidecar.port}`)
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve()
        ws.onerror = () => reject(new Error('임베딩 소켓 연결 실패'))
      })
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return
        let msg: { type: string; id?: string; vectors?: number[][]; model?: string; message?: string }
        try {
          msg = JSON.parse(ev.data)
        } catch {
          return
        }
        if (!msg.id) return
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        window.clearTimeout(p.timer)
        if (msg.type === 'embed_done' && Array.isArray(msg.vectors)) {
          this.model = msg.model ?? this.model
          this.everSucceeded = true
          this.failures = 0
          p.resolve(msg.vectors)
        } else p.reject(new Error(msg.message ?? '임베딩 실패'))
      }
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null
        for (const [id, p] of this.pending) {
          window.clearTimeout(p.timer)
          p.reject(new Error('임베딩 소켓 종료'))
          this.pending.delete(id)
        }
      }
      this.ws = ws
      return ws
    })().finally(() => {
      this.opening = null
    })
    return this.opening
  }

  private fail(e: Error): void {
    this.failures++
    if (this.failures >= MAX_FAILURES && !this.unavailable) this.unavailable = e.message
  }

  /** embed texts; throws on failure (callers treat a throw as "no embedding evidence this time") */
  async embed(texts: string[], kind: 'query' | 'passage'): Promise<number[][]> {
    if (this.unavailable) throw new Error(this.unavailable)
    if (!texts.length) return []
    const ws = await this.socket().catch((e: Error) => {
      this.fail(e)
      throw e
    })
    const id = `e${++this.seq}_${Date.now()}`
    return new Promise<number[][]>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id)
        const err = new Error('임베딩 응답 시간 초과')
        this.fail(err)
        reject(err)
      }, this.everSucceeded ? REQUEST_TIMEOUT_MS : FIRST_REQUEST_TIMEOUT_MS)
      this.pending.set(id, {
        resolve,
        reject: (e) => {
          this.fail(e)
          reject(e)
        },
        timer
      })
      try {
        ws.send(JSON.stringify({ type: 'embed', id, kind, texts }))
      } catch (e) {
        this.pending.delete(id)
        window.clearTimeout(timer)
        this.fail(e as Error)
        reject(e as Error)
      }
    })
  }

  /** page vectors for a PDF: DB cache (same model) → sidecar → DB */
  async pageVectors(pdfId: number, pages: string[]): Promise<number[][] | null> {
    try {
      const cached = await window.api.pdfs.getPageEmbeddings(pdfId)
      if (cached && cached.vectors.length === pages.length && (!this.model || cached.model === this.model)) {
        this.model = cached.model
        return cached.vectors
      }
    } catch {
      /* fall through */
    }
    // embed only non-empty pages (empty ones get a null slot so indices stay page-aligned)
    const idx: number[] = []
    const texts: string[] = []
    pages.forEach((t, i) => {
      if (t && t.trim()) {
        idx.push(i)
        texts.push(t.slice(0, 1500)) // ≈ the first 512 tokens anyway
      }
    })
    if (!texts.length) return null
    const vecs = await this.embed(texts, 'passage')
    const out: number[][] = pages.map(() => [])
    idx.forEach((pi, k) => (out[pi] = vecs[k] ?? []))
    void window.api.pdfs.setPageEmbeddings(pdfId, { model: this.model ?? 'unknown', dims: vecs[0]?.length ?? 0, vectors: out }).catch(() => {})
    return out
  }

  /** score candidate pages for a query text → page → [0,1] */
  async scorePages(query: string, pageVecs: number[][], candidates: number[]): Promise<Map<number, number>> {
    const [q] = await this.embed([query.slice(0, 1500)], 'query')
    const cos = new Map<number, number>()
    if (!q) return cos
    for (const p of candidates) {
      const v = pageVecs[p - 1]
      if (v && v.length) cos.set(p, denseCosine(q, v))
    }
    return embedScoresFromCosines(cos)
  }

  close(): void {
    for (const [id, p] of this.pending) {
      window.clearTimeout(p.timer)
      p.reject(new Error('닫힘'))
      this.pending.delete(id)
    }
    try {
      this.ws?.close()
    } catch {
      /* ignore */
    }
    this.ws = null
  }
}
