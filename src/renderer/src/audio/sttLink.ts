// A self-healing connection to the transcription server for ONE recording session.
//
// The server may run on another Mac behind an SSH tunnel, so the connection can drop mid-lecture
// (Wi-Fi hiccup, the remote Mac rebooting, or this Mac falling back to its own sidecar). The link
// keeps the last HISTORY_SEC of streamed audio. On reconnect it asks the app for a server again
// (`stt.ensure()` restarts the remote one or falls back locally), re-sends the config, and replays
// the audio from where the last FINAL segment ended, so the transcript has no hole and no repeat.
//
// Timeline: the server stamps segments relative to its connection's first sample. Each connection
// starts at `connBase` (a sample index on this recording's timeline), so callers add
// `offsetSec = connBase / 16000` to every timestamp the server sends.
const SR = 16000
const HISTORY_SEC = 120

type Frame = { at: number; buf: ArrayBuffer }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServerMsg = any

export interface SttLinkHandlers {
  /** config message, rebuilt on every (re)connection so it reflects the current settings */
  config: () => Promise<Record<string, unknown>>
  onMessage: (msg: ServerMsg, offsetSec: number) => void
  /** connection lost / restored; `detail` = a notice for the user (e.g. a fallback note) */
  onState: (s: 'reconnecting' | 'restored', detail?: string) => void
}

const samplesOf = (b: ArrayBuffer): number => b.byteLength / 4

export class SttLink {
  private ws: WebSocket | null = null
  private ready = false
  private closing = false
  private draining = false
  private dropped = false
  private connBase = 0
  private captured = 0
  private hist: Frame[] = []
  private histSamples = 0
  private lastFinalEnd = 0
  private retryTimer: number | null = null
  private attempt = 0

  constructor(private readonly h: SttLinkHandlers) {}

  get isOpen(): boolean {
    return this.ready && this.ws?.readyState === WebSocket.OPEN
  }

  /** first connection (the caller already has a running server on `port`) */
  connect(port: number): void {
    this.open(port, 0)
  }

  /** one captured 16 kHz Float32 frame (paused frames are simply never handed in) */
  sendAudio(buf: ArrayBuffer): void {
    const n = samplesOf(buf)
    this.hist.push({ at: this.captured, buf })
    this.histSamples += n
    this.captured += n
    while (this.hist.length > 1 && this.histSamples - samplesOf(this.hist[0].buf) >= HISTORY_SEC * SR) {
      this.histSamples -= samplesOf(this.hist.shift()!.buf)
    }
    if (this.isOpen) this.ws!.send(buf)
  }

  sendJson(obj: Record<string, unknown>): void {
    if (this.isOpen) this.ws!.send(JSON.stringify(obj))
  }

  /** recording stopped: ask the server to drain. Re-sent after a reconnect so the tail still lands. */
  beginStop(): void {
    this.draining = true
    this.sendJson({ type: 'stop' })
  }

  close(): void {
    this.closing = true
    if (this.retryTimer != null) window.clearTimeout(this.retryTimer)
    this.retryTimer = null
    try {
      this.ws?.close()
    } catch {
      /* ignore */
    }
    this.ws = null
    this.ready = false
  }

  // ───────────────────────── internals ─────────────────────────
  private open(port: number, replayFrom: number): void {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    this.ready = false
    ws.onopen = () => {
      void (async () => {
        const cfg = await this.h.config()
        if (this.ws !== ws || this.closing) return
        ws.send(JSON.stringify(cfg))
        // replay everything captured from `replayFrom` (connection #1: the frames buffered while
        // the socket was opening; later: what the dead server never finalized)
        const first = this.hist.findIndex((f) => f.at + samplesOf(f.buf) > replayFrom)
        this.connBase = first >= 0 ? this.hist[first].at : this.captured
        if (first >= 0) for (let i = first; i < this.hist.length; i++) ws.send(this.hist[i].buf)
        this.ready = true
        if (this.draining) ws.send(JSON.stringify({ type: 'stop' }))
        this.attempt = 0
      })()
    }
    ws.onmessage = (ev) => {
      if (this.ws !== ws || typeof ev.data !== 'string') return
      let msg: ServerMsg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      if (msg.type === 'segment' && typeof msg.tEnd === 'number') {
        this.lastFinalEnd = Math.max(this.lastFinalEnd, this.connBase + Math.round(msg.tEnd * SR))
      }
      this.h.onMessage(msg, this.connBase / SR)
    }
    ws.onclose = () => {
      if (this.ws !== ws || this.closing) return
      this.ready = false
      this.ws = null
      if (!this.dropped) {
        this.dropped = true
        this.h.onState('reconnecting')
      }
      this.scheduleReconnect()
    }
    ws.onerror = () => {
      /* onclose follows and handles it */
    }
  }

  private scheduleReconnect(): void {
    if (this.closing || this.retryTimer != null) return
    const delay = [300, 1500, 4000, 8000][Math.min(this.attempt, 3)]
    this.attempt++
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null
      void this.reconnect()
    }, delay)
  }

  private async reconnect(): Promise<void> {
    if (this.closing) return
    let st: Awaited<ReturnType<typeof window.api.stt.ensure>>
    try {
      st = await window.api.stt.ensure()
    } catch {
      this.scheduleReconnect()
      return
    }
    if (this.closing) return
    if (!st.port) {
      this.scheduleReconnect()
      return
    }
    const oldest = this.hist.length ? this.hist[0].at : this.captured
    this.open(st.port, Math.max(this.lastFinalEnd, oldest))
    // report once the new socket is actually open
    const ws = this.ws
    const watch = window.setInterval(() => {
      if (this.ws !== ws || this.closing) return window.clearInterval(watch)
      if (this.isOpen) {
        window.clearInterval(watch)
        this.dropped = false
        this.h.onState('restored', st.note ?? (st.remote ? '맥미니에 다시 연결됐어요' : '이 Mac에서 전사를 이어가요'))
      }
    }, 100)
  }
}
