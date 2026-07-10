import { useStore, isDefaultTitle, sanitizeTitle } from '../store/useStore'
import { segmentsToMarkdown } from '../math/koMathRules'
import { wordSubs } from '../lib/wordDiff'
import type { Segment } from '../../../shared/types'
import workletUrl from './pcm-worklet.js?url'

interface RecSession {
  ws: WebSocket
  ctx: AudioContext
  source: MediaStreamAudioSourceNode
  node: AudioWorkletNode
  // Separate 48kHz context for the SAVED audio (high fidelity). The 16k ctx above feeds the
  // transcriber; this one feeds the file. Both are Web Audio (one hardware clock) so their
  // timelines stay locked — the saved audio aligns with the transcript, but isn't capped at
  // the 8kHz bandwidth that 16k mono imposed (which made system-audio recordings sound muffled).
  fileCtx: AudioContext
  fileSource: MediaStreamAudioSourceNode
  fileNode: AudioWorkletNode
  stream: MediaStream
  /** tracks kept alive only to keep the capture session healthy (e.g. system-audio video) */
  extra: MediaStreamTrack[]
  /** on-disk raw-PCM take file being written to continuously during recording */
  takePath: string
  /** serialized chain of pending chunk appends */
  append: { chain: Promise<void> }
  timer: number
  startMs: number
  memoId: number
  /** existing memo content captured at start, so a new take APPENDS */
  base: { segments: Segment[]; durationSec: number; audioPath: string | null; md: string }
}

let session: RecSession | null = null
// synchronous re-entrancy guard: `session` is only assigned at the END of
// startRecording (after several awaits), so a rapid second call would otherwise
// slip past the `if (session)` check and create a DUPLICATE session (two ws / two
// timers / doubled transcript). This flag is set synchronously to block that.
let starting = false
// set if the user hits stop DURING startup (optimistic UI shows the recording controls
// before setup finishes) — startRecording checks it after each await and aborts cleanly.
let cancelStart = false
// resolves when the server confirms it has drained all queued utterances
let stoppedResolve: (() => void) | null = null
// While finalizing we wait on PROGRESS, not a fixed deadline: every segment/finalizing
// message resets this timer, and we only give up if transcription makes NO progress for
// FINALIZE_STALL_MS. A blind cap (the old 180s) discarded a large backlog mid-drain and
// silently lost the tail (e.g. recorded 75min but only 67min transcribed).
let finalizeStallTimer: number | null = null
const FINALIZE_STALL_MS = 90000
// live audio analyser exposed to the waveform visualizer
let analyser: AnalyserNode | null = null
// pause state: while paused we drop PCM frames, so the transcript timeline AND the audio
// file (both fed by the same frames) skip the same interval and stay aligned.
let pausedFlag = false
let pausedMs = 0 // total accumulated paused time this session
let pauseStartMs = 0

// ---- audio-pipeline watchdog ----
// Over long recordings the capture pipeline can silently die: the OS suspends the
// AudioContext (system sleep / audio route change) or the source track ends (device
// unplugged, screen-share stopped). PCM then stops flowing — so transcription AND the
// waveform freeze — but the elapsed timer (Date.now based) keeps running, so the app
// LOOKS like it's still recording. The watchdog detects the stall, tries to revive a
// suspended context, and surfaces a clear message instead of zombie-ing.
let lastFrameMs = 0
let watchdog: number | null = null
let stalled = false
const STALL_MS = 6000
const STALL_MSG = '⚠️ 오디오 입력이 끊겼습니다. 복구를 시도 중입니다…'
const LOST_MSG = '오디오 입력이 중단되었습니다(장치 변경·절전·공유 중단 등). 지금까지의 전사는 저장됩니다 — 녹음을 다시 시작하세요.'
// the source track is temporarily muted (OS interruption, audio route change, system
// audio gone quiet): it still delivers SILENT frames so the frame watchdog stays "healthy",
// but the audio file / waveform / transcript all blank out for this stretch.
const MUTE_MSG = '⚠️ 오디오 입력이 일시적으로 끊겼습니다 — 이 구간은 녹음·전사되지 않습니다.'

function stopWatchdog(): void {
  if (watchdog != null) {
    window.clearInterval(watchdog)
    watchdog = null
  }
}

/** Called on every PCM frame: the pipeline is alive — clear any stall warning. */
function markFrame(): void {
  lastFrameMs = Date.now()
  if (stalled) {
    stalled = false
    if (useStore.getState().rec.sttError === STALL_MSG) useStore.getState().setRec({ sttError: null })
  }
}

// ---- on-disk audio = the SAME PCM stream that's transcribed ----
// The saved recording is written from these exact frames (raw Float32 16kHz mono), batched
// ~1s before each disk append. Because the audio file and the transcript come from one
// stream, their timelines are identical by construction — no drift, even across pauses/stalls.
let pcmPending: Float32Array[] = []
let pcmPendingSamples = 0

function flushPcm(takePath: string, append: { chain: Promise<void> }, force = false): void {
  if (pcmPendingSamples === 0) return
  if (!force && pcmPendingSamples < 48000) return // batch ~1s of 48kHz audio per write
  const merged = new Float32Array(pcmPendingSamples)
  let o = 0
  for (const c of pcmPending) {
    merged.set(c, o)
    o += c.length
  }
  pcmPending = []
  pcmPendingSamples = 0
  const bytes = new Uint8Array(merged.buffer)
  append.chain = append.chain.then(() => window.api.recordings.appendTake(takePath, bytes)).catch(() => {})
}

export function getAnalyser(): AnalyserNode | null {
  return analyser
}

// ---- realtime per-chunk AI correction ----
// Correction uses the model the user picked in the pill, and runs a few in
// parallel (each chunk is independent) to keep up with incoming chunks.
const MAX_CONCURRENT_CORRECTIONS = 3
let correctQueue: number[] = []
let activeCorrections = 0
// Correction waits for FOLLOWING context: a chunk is only corrected once this many later
// chunks exist, so the AI sees both the preceding AND the next chunks (better disambiguation
// of homophones / cut-off phrases). Trailing chunks are flushed at stop.
const FOLLOW_DELAY = 2
// highest live-segment index already queued for correction (monotonic; avoids double-scheduling)
let scheduledIdx = -1
// ad-hoc term corrections applied to incoming live chunks (not persisted as rules)
let runtimeReplacements: Record<string, string> = {}
// live segments the user manually edited — don't let auto-correction clobber them
const editedLive = new Set<number>()

function applyRuntime(t: string): string {
  for (const [from, to] of Object.entries(runtimeReplacements)) {
    if (from) t = t.split(from).join(to)
  }
  return t
}

/** Register an ad-hoc correction so future live chunks get it too (this session). */
export function addRuntimeReplacement(from: string, to: string): void {
  if (from && from !== to) runtimeReplacements[from] = to
}

/** Mark a live-segment index as manually edited so correction skips it. */
export function markLiveEdited(index: number): void {
  editedLive.add(index)
}

function stripChunkText(t: string): string {
  return t
    .replace(/^```(?:\w+)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .replace(/^["'`\s]+|["'`\s]+$/g, '')
    .trim()
}

/**
 * Parse a {prev, text} rolling-boundary correction response.
 * `prev` = completed sentence(s) that belong to the previous segment;
 * `text` = the trailing (possibly still-in-progress) last sentence for the current segment.
 * `prevGiven` distinguishes an explicit empty prev ("merge into current") from a parse failure.
 */
export function parseCorrection(raw: string): { prev: string; text: string; prevGiven: boolean } {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  const m = cleaned.match(/\{[\s\S]*\}/)
  if (m) {
    try {
      const o = JSON.parse(m[0])
      return {
        prev: String(o.prev ?? '').trim(),
        text: String(o.text ?? '').trim(),
        prevGiven: Object.prototype.hasOwnProperty.call(o, 'prev')
      }
    } catch {
      /* fall through */
    }
  }
  return { prev: '', text: stripChunkText(cleaned), prevGiven: false }
}

async function correctOne(idx: number, systemPrompt: string): Promise<void> {
  try {
    if (editedLive.has(idx)) return // user edited this — don't overwrite
    const segs = useStore.getState().rec.liveSegments
    if (!segs[idx]) return
    // IN-PLACE correction ONLY: surrounding chunks are passed as read-only context,
    // but we never move text across chunk boundaries or touch timestamps — so each
    // chunk stays exactly aligned with the recorded audio (timeline is preserved).
    const context = segs.slice(Math.max(0, idx - 6), idx).map((s) => s.text).join(' ').slice(-1500)
    // FOLLOWING context: the next chunks (already arrived thanks to FOLLOW_DELAY) help the
    // AI resolve homophones / phrases that only make sense once you hear what comes after.
    const follow = segs.slice(idx + 1, idx + 1 + FOLLOW_DELAY).map((s) => s.text).join(' ').slice(0, 1500)
    const chunk = segs[idx].text
    const { text } = parseCorrection(
      await window.api.claude.correctChunk(context, follow, chunk, systemPrompt, useStore.getState().claudeModel)
    )
    if (editedLive.has(idx)) return
    const out = applyRuntime(text || chunk)
    if (out && out !== chunk) {
      useStore.getState().updateLiveSegment(idx, out)
      // agent self-improvement: learn repeated single-word corrections from the live AI pass
      const st = useStore.getState()
      const agent = st.agents.find((a) => a.id === (st.memo?.agentId ?? st.activeAgentId))
      if (agent?.selfImprove) {
        for (const sub of wordSubs(chunk, out)) {
          const kind: 'term' | 'math' = /[$\\^_]/.test(sub.from + sub.to) ? 'math' : 'term'
          void window.api.agents.recordCorrection(agent.id, sub.from, sub.to, kind).then((res) => {
            if (res?.applied) st.showToast(`규칙 자동 추가: ${res.from} → ${res.to}`)
          })
        }
      }
    }
  } catch {
    /* keep raw chunk on failure */
  } finally {
    useStore.getState().markCorrecting(idx, false)
  }
}

/** Drain the correction queue with bounded concurrency (each chunk is independent). */
function pumpCorrections(systemPrompt: string): void {
  while (activeCorrections < MAX_CONCURRENT_CORRECTIONS && correctQueue.length) {
    const idx = correctQueue.shift()!
    activeCorrections++
    void correctOne(idx, systemPrompt).finally(() => {
      activeCorrections--
      pumpCorrections(systemPrompt)
    })
  }
}

// Build the system prompt for live correction: the agent's systemPrompt PLUS its
// correction-only keywords (math/notation preferred spellings), capped so a huge list can't
// bloat the prompt or slow the call. These are SEPARATE from transcription keywords.
const CORRECTION_HINT_CAP = 800
function correctionSystemPrompt(
  agent: { systemPrompt?: string; correctionKeywords?: string[] } | undefined
): string {
  const base = agent?.systemPrompt ?? ''
  // memo-specific keywords first (priority), then the agent's correction keywords
  const memoKw = useStore.getState().memo?.keywords ?? []
  const kw = [...memoKw, ...(agent?.correctionKeywords ?? [])].join(', ').slice(0, CORRECTION_HINT_CAP)
  if (!kw) return base
  const hint = `[전문 용어·표기 참고] 다음 용어가 자주 등장합니다 — 음성인식 오류로 보이면 이 표기로 교정하세요(억지로 끼워넣지는 말 것): ${kw}`
  return base ? `${base}\n\n${hint}` : hint
}

/** Queue chunk `idx` for correction once (monotonic guard). */
function scheduleCorrection(idx: number, systemPrompt: string): void {
  if (idx < 0 || idx <= scheduledIdx) return
  scheduledIdx = idx
  correctQueue.push(idx)
  useStore.getState().markCorrecting(idx, true)
  pumpCorrections(systemPrompt)
}

function clearFinalizeStall(): void {
  if (finalizeStallTimer != null) {
    window.clearTimeout(finalizeStallTimer)
    finalizeStallTimer = null
  }
}

/** Reset the no-progress timeout — called on each finalize-time transcription progress. */
function bumpFinalizeStall(): void {
  if (stoppedResolve == null) return // not currently waiting on a finalize drain
  clearFinalizeStall()
  finalizeStallTimer = window.setTimeout(() => {
    finalizeStallTimer = null
    const r = stoppedResolve
    stoppedResolve = null
    useStore.getState().setRec({
      sttError: '일부 구간이 전사되지 못했습니다(전사가 멈춤). 저장된 부분까지만 반영됩니다.'
    })
    r?.()
  }, FINALIZE_STALL_MS)
}

// Whisper treats initial_prompt as trailing decoder context and silently keeps only its LAST
// ~224 tokens — an unbounded keyword dump gets its FRONT (our highest-priority terms: the memo
// keywords) cut off, and a huge list dilutes the bias. Cap it ourselves so every included term
// actually biases recognition; priority-first order then guarantees the important terms survive.
const INITIAL_PROMPT_CAP = 350
function buildInitialPrompt(): string {
  const st = useStore.getState()
  const agent = st.agents.find((a) => a.id === st.activeAgentId)
  // memo-specific keywords (extracted from the note's linked PDFs) take priority over the agent's
  const memoKw = st.memo?.keywords ?? []
  const terms = [...memoKw, ...(agent?.keywords ?? []), ...Object.values(agent?.mathRules ?? {})]
  const uniq = Array.from(new Set(terms.map((t) => t.trim()).filter(Boolean)))
  let out = ''
  for (const t of uniq) {
    const next = out ? `${out}, ${t}` : t
    if (next.length > INITIAL_PROMPT_CAP) break
    out = next
  }
  return out
}

/**
 * Acquire the capture stream. Returns the audio-only stream we record/analyze plus any
 * `extra` tracks that must be kept ALIVE for the session to stay healthy (stopped only at
 * teardown). For system audio that's the video track — see below.
 */
async function getStream(source: 'mic' | 'system'): Promise<{ stream: MediaStream; extra: MediaStreamTrack[] }> {
  if (source === 'system') {
    // Attempt capture directly. The FIRST attempt triggers the macOS Screen
    // Recording prompt and registers the app in System Settings — so we must
    // NOT bail out early on a non-granted status (that's what kept the app
    // from ever appearing in the list).
    try {
      // Plain video:true — the loopback handler (audioLoopback.ts) supplies the screen source +
      // 'loopback' audio. We do NOT constrain or modify the video track at all: any tweak
      // (low-fps constraints / applyConstraints) was breaking system-audio capture. The track is
      // kept alive untouched (stopping it kills the audio); resource throttling is revisited later.
      const display = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
      const video = display.getVideoTracks()
      const audio = display.getAudioTracks()
      if (audio.length === 0) {
        video.forEach((t) => t.stop())
        throw new Error('no-audio-track')
      }
      // KEEP the video track running — do NOT stop it. On macOS, stopping the video track
      // tears down the screen-capture session, and the SYSTEM-AUDIO track dies/mutes with
      // it a while later (the "녹음이 중간에 통째로 비는" gap). We never render it; it's
      // stopped only when the recording ends.
      return { stream: new MediaStream(audio), extra: video }
    } catch (e) {
      // ask main to (re)trigger the OS prompt / register the app, then open Settings
      await window.api.permissions.triggerScreen()
      const status = await window.api.permissions.screenStatus()
      if (status !== 'granted') {
        await window.api.permissions.openScreenSettings()
        throw new Error(
          '시스템 오디오를 캡처하려면 화면 녹화 권한이 필요합니다. 방금 연 “화면 기록” 목록에서 Dictly(개발 중에는 Electron)를 켠 뒤, 앱을 완전히 종료하고 다시 실행하세요.'
        )
      }
      throw new Error(`시스템 오디오 캡처 실패: ${(e as Error).message}`)
    }
  }
  await window.api.permissions.requestMic()
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
  })
  return { stream, extra: [] }
}

/** Once ~2 minutes of transcript has accumulated, auto-generate the note title — but only if
 *  it's still the default placeholder (never overwrite a user-typed title), at most once per
 *  recording session. Keyed to recordingMemoId so it titles the right note even if the user
 *  navigated away. The manual "제목 다시 생성" button is always available regardless. */
async function maybeAutoTitle(): Promise<void> {
  const s = useStore.getState()
  if (s.autoTitledSession || s.recordingMemoId == null || !s.aiReady) return
  const segs = s.rec.liveSegments
  if (segs.length < 2) return
  if (segs[segs.length - 1].tEnd - segs[0].tStart < 120) return
  useStore.setState({ autoTitledSession: true }) // guard synchronously before the async call
  const memoId = s.recordingMemoId
  try {
    const memo = await window.api.memos.get(memoId)
    if (!memo || !isDefaultTitle(memo.title)) return
    const agent = s.agents.find((a) => a.id === (memo.agentId ?? s.activeAgentId))
    const transcript = segs.map((x) => x.text).join(' ').slice(0, 6000)
    if (!transcript.trim()) return
    const clean = sanitizeTitle(await window.api.claude.generateTitle(transcript, agent?.systemPrompt ?? ''))
    if (!clean) return
    await window.api.memos.updateTitle(memoId, clean)
    const cur = useStore.getState()
    void cur.refreshMemos()
    if (cur.selectedMemoId === memoId) void cur.reloadMemo()
  } catch {
    /* keep the default title; user can use the manual regenerate button */
  }
}

export async function startRecording(): Promise<void> {
  const st = useStore.getState()
  const setRec = st.setRec
  if (session || starting) return
  starting = true
  cancelStart = false
  const memo = st.memo
  if (!memo) {
    starting = false
    setRec({ sttError: '메모가 선택되지 않았습니다' })
    return
  }

  // capture existing content so this take is appended after it
  const base = {
    segments: memo.segments,
    durationSec: memo.durationSec || 0,
    audioPath: memo.audioPath,
    md: memo.transcriptMd
  }
  const baseOffset = base.durationSec

  // OPTIMISTIC UI — flip to "recording" instantly so pause/stop appear with no delay; the
  // slower capture + sidecar setup runs below and rolls back on failure or mid-startup stop.
  const rollback = (msg?: string): void => {
    starting = false
    cancelStart = false
    useStore.getState().setRecordingMemo(null)
    setRec({ isRecording: false, paused: false, finalizing: false, sttState: 'idle', ...(msg ? { sttError: msg } : {}) })
  }
  useStore.getState().resetLive()
  useStore.getState().setAutoTitled(false) // fresh auto-title chance each session
  useStore.getState().setRecordingMemo(memo.id)
  setRec({
    isRecording: true,
    paused: false,
    elapsedSec: 0,
    finalizing: false,
    finalizeRemaining: 0,
    sttState: 'loading',
    sttError: null,
    partial: ''
  })

  const sidecar = await window.api.stt.ensure()
  if (!sidecar.port) return rollback(sidecar.error ?? 'STT 서버를 시작할 수 없습니다')
  if (cancelStart) return rollback()
  const vad = await window.api.settings.getVad()
  const tr = await window.api.settings.getTranscribe()

  let stream: MediaStream
  let extra: MediaStreamTrack[] = []
  try {
    const cap = await getStream(st.rec.source)
    stream = cap.stream
    extra = cap.extra
  } catch (e) {
    return rollback(`오디오 캡처 실패: ${(e as Error).message}`)
  }
  if (cancelStart) {
    stream.getTracks().forEach((t) => t.stop())
    extra.forEach((t) => t.stop())
    return rollback()
  }

  // --- transcription context: 16kHz (what Whisper needs) ---
  const ctx = new AudioContext({ sampleRate: 16000 })
  await ctx.resume() // ensure not suspended (would stall capture)
  await ctx.audioWorklet.addModule(workletUrl)
  const sourceNode = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'pcm-worklet')
  sourceNode.connect(node)
  // tap for the live waveform visualizer
  analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.75
  sourceNode.connect(analyser)
  // worklet needs a silent sink to be pulled by the graph — but we DON'T connect it yet:
  // pulling the worklet starts the PCM stream (and the transcription clock).
  const silent = ctx.createGain()
  silent.gain.value = 0

  // --- file context: 48kHz (high-fidelity saved audio) ---
  // A cloned track feeds an independent 48k context so the saved recording keeps full
  // bandwidth. Both contexts share the audio hardware clock, so the file stays time-aligned
  // with the 16k transcript while sounding far better than the old 16k-mono capture.
  const fileTrack = stream.getAudioTracks()[0]?.clone()
  const fileStream = fileTrack ? new MediaStream([fileTrack]) : stream
  if (fileTrack) extra.push(fileTrack) // stop it on teardown
  const fileCtx = new AudioContext({ sampleRate: 48000 })
  await fileCtx.resume()
  await fileCtx.audioWorklet.addModule(workletUrl)
  const fileSource = fileCtx.createMediaStreamSource(fileStream)
  const fileNode = new AudioWorkletNode(fileCtx, 'pcm-worklet')
  fileSource.connect(fileNode)
  const fileSilent = fileCtx.createGain()
  fileSilent.gain.value = 0

  const ws = new WebSocket(`ws://127.0.0.1:${sidecar.port}`)
  ws.binaryType = 'arraybuffer'

  // buffer PCM produced before the socket opens so no frames are lost (drift)
  let wsReady = false
  const pending: ArrayBufferLike[] = []

  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        type: 'config',
        model: st.rec.model,
        language: st.rec.language,
        initialPrompt: buildInitialPrompt(),
        silenceSec: vad.silenceSec,
        maxSec: vad.maxSec,
        // Transcription is built-in: finals are always local Whisper. OpenAI Realtime
        // (gpt-realtime-whisper) is used ONLY when the ⚙ live-preview toggle is on.
        engine: 'local',
        apiKey: tr.apiKey,
        oaiModel: 'gpt-realtime-whisper',
        realtimePreview: tr.realtimePreview,
        localPreview: useStore.getState().rec.localPreview
      })
    )
    wsReady = true
    for (const b of pending) ws.send(b)
    pending.length = 0
  }
  ws.onmessage = (ev) => {
    if (typeof ev.data !== 'string') return
    const msg = JSON.parse(ev.data)
    const store = useStore.getState()
    if (msg.type === 'segment') {
      // tag the chunk with the focused PDF's current page (page↔chunk sync). null when no PDF
      // is open/focused; the focused pane's page when the user is viewing during recording.
      const fid = store.focusedPdfId
      const pdfPage = fid != null ? store.currentPdfPage[fid] ?? null : null
      // offset by existing duration so appended takes get continuous timestamps
      store.appendLiveSegment({
        tStart: msg.tStart + baseOffset,
        tEnd: msg.tEnd + baseOffset,
        text: applyRuntime(msg.text),
        pdfId: fid,
        pdfPage
      })
      bumpFinalizeStall() // a segment arriving = transcription is making progress
      // schedule correction for the chunk FOLLOW_DELAY behind the newest one, so it gets
      // both preceding and the just-arrived following chunks as context.
      const st2 = useStore.getState()
      if (st2.rec.liveCorrect && st2.aiReady) {
        const agent = st2.agents.find((a) => a.id === st2.activeAgentId)
        scheduleCorrection(st2.rec.liveSegments.length - 1 - FOLLOW_DELAY, correctionSystemPrompt(agent))
      }
      void maybeAutoTitle() // auto-name the note once ~2min of transcript has accumulated
    } else if (msg.type === 'partial') {
      store.setRec({ partial: msg.text })
    } else if (msg.type === 'finalizing') {
      store.setRec({ finalizeRemaining: Number(msg.remaining ?? 0) })
      bumpFinalizeStall()
    } else if (msg.type === 'status') {
      store.setRec({ sttState: msg.state === 'ready' ? 'ready' : 'loading' })
    } else if (msg.type === 'stopped') {
      clearFinalizeStall()
      const r = stoppedResolve
      stoppedResolve = null
      r?.()
    } else if (msg.type === 'error') {
      store.setRec({ sttError: msg.message })
    }
  }
  ws.onerror = () => useStore.getState().setRec({ sttError: 'STT 연결 오류' })

  node.port.onmessage = (e) => {
    markFrame() // pipeline is alive (frames flow even while paused — we just drop them)
    if (pausedFlag) return // paused: drop frames so the transcription clock skips the pause
    const buf = (e.data as Float32Array).buffer
    if (wsReady && ws.readyState === WebSocket.OPEN) ws.send(buf)
    else if (ws.readyState === WebSocket.CONNECTING) pending.push(buf)
  }
  // 48k file frames → on-disk PCM. Paused frames are dropped here too, so the file skips the
  // same interval as the transcript and the two timelines stay locked.
  fileNode.port.onmessage = (e) => {
    if (pausedFlag) return
    const f32 = e.data as Float32Array
    pcmPending.push(f32)
    pcmPendingSamples += f32.length
    flushPcm(takePath, append)
  }

  // a suspended/interrupted context (system sleep, audio route change) stops PCM —
  // try to revive it immediately; the watchdog below is the slower backstop.
  ctx.onstatechange = () => {
    if (session && !pausedFlag && ctx.state === 'suspended') void ctx.resume().catch(() => {})
  }
  fileCtx.onstatechange = () => {
    if (session && !pausedFlag && fileCtx.state === 'suspended') void fileCtx.resume().catch(() => {})
  }
  // the capture source ending (device unplugged, screen-share stopped) is unrecoverable
  // for this take — stop cleanly so the transcript so far is saved.
  const capTrack = stream.getAudioTracks()[0]
  if (capTrack) {
    capTrack.addEventListener('ended', () => {
      if (!session) return
      useStore.getState().setRec({ sttError: LOST_MSG })
      void stopRecording()
    })
    // temporary interruption (still 'live', just not delivering real audio) — warn so the
    // user knows this stretch is blank, and clear it the moment audio resumes.
    capTrack.addEventListener('mute', () => {
      if (session) useStore.getState().setRec({ sttError: MUTE_MSG })
    })
    capTrack.addEventListener('unmute', () => {
      if (session && useStore.getState().rec.sttError === MUTE_MSG) useStore.getState().setRec({ sttError: null })
    })
  }

  // continuous on-disk save: the take file is raw PCM written from the worklet frames above
  const takePath = await window.api.recordings.startTake(memo.id)
  const append = { chain: Promise.resolve() as Promise<void> }
  // last cancel checkpoint before capture actually starts: tear down everything built so far
  if (cancelStart) {
    try {
      ws.close()
    } catch {
      /* ignore */
    }
    try {
      node.disconnect()
      sourceNode.disconnect()
      fileNode.disconnect()
      fileSource.disconnect()
    } catch {
      /* ignore */
    }
    void ctx.close().catch(() => {})
    void fileCtx.close().catch(() => {})
    stream.getTracks().forEach((t) => t.stop())
    extra.forEach((t) => t.stop())
    analyser = null
    return rollback()
  }
  // Connecting the worklet sinks begins PCM delivery on both contexts at once: the 16k stream
  // (transcription clock, server t=0) and the 48k stream (saved audio). One hardware clock →
  // aligned timelines.
  node.connect(silent).connect(ctx.destination)
  fileNode.connect(fileSilent).connect(fileCtx.destination)

  const startMs = Date.now()
  const timer = window.setInterval(() => {
    if (pausedFlag) return // freeze the clock while paused
    useStore.getState().setRec({ elapsedSec: (Date.now() - startMs - pausedMs) / 1000 })
  }, 250)

  session = { ws, ctx, source: sourceNode, node, fileCtx, fileSource, fileNode, stream, extra, takePath, append, timer, startMs, memoId: memo.id, base }
  correctQueue = []
  activeCorrections = 0
  scheduledIdx = -1
  pcmPending = []
  pcmPendingSamples = 0
  pausedFlag = false
  pausedMs = 0
  pauseStartMs = 0
  runtimeReplacements = {}
  editedLive.clear()
  // keep the Mac awake (no system sleep / App Nap) so capture isn't suspended mid-recording
  void window.api.window.setRecordingActive(true)
  // arm the audio-pipeline watchdog
  lastFrameMs = Date.now()
  stalled = false
  stopWatchdog()
  watchdog = window.setInterval(() => {
    if (!session || pausedFlag) return
    const track = session.stream.getAudioTracks()[0]
    if (!track || track.readyState === 'ended') {
      // source gone — can't revive this take; save what we have
      useStore.getState().setRec({ sttError: LOST_MSG })
      void stopRecording()
      return
    }
    if (track.muted) {
      // muted tracks keep delivering silent frames (so the frame check below looks healthy)
      // — flag the blank stretch and try to wake a possibly-suspended context.
      if (useStore.getState().rec.sttError !== MUTE_MSG) useStore.getState().setRec({ sttError: MUTE_MSG })
      if (session.ctx.state !== 'running') void session.ctx.resume().catch(() => {})
      return
    }
    if (Date.now() - lastFrameMs < STALL_MS) return // frames still flowing — healthy
    if (session.ctx.state !== 'running') void session.ctx.resume().catch(() => {}) // try to wake it
    if (!stalled) {
      stalled = true
      useStore.getState().setRec({ sttError: STALL_MSG })
    }
  }, 2000)
  // (optimistic UI already set isRecording / recordingMemo / reset live at the top)
  starting = false
  // if stop was pressed after the last checkpoint (capture already live), tear down now
  if (cancelStart) {
    cancelStart = false
    void stopRecording()
  }
}

/** Temporarily pause: dropping frames freezes BOTH the transcript clock and the audio file
 * (no PCM is sent or written), so the paused interval is skipped identically in both. */
export function pauseRecording(): void {
  const s = session
  if (!s || pausedFlag) return
  pausedFlag = true
  pauseStartMs = Date.now()
  useStore.getState().setRec({ paused: true })
}

/** Resume after a pause. */
export function resumeRecording(): void {
  const s = session
  if (!s || !pausedFlag) return
  pausedMs += Date.now() - pauseStartMs
  pausedFlag = false
  useStore.getState().setRec({ paused: false })
}

/** Re-send the sidecar config for the active session — used to toggle the realtime
 * preview overlay mid-recording (the sidecar connects/disconnects accordingly). */
export async function reconfigureSession(): Promise<void> {
  const s = session
  if (!s || s.ws.readyState !== WebSocket.OPEN) return
  const st = useStore.getState()
  const vad = await window.api.settings.getVad()
  const tr = await window.api.settings.getTranscribe()
  try {
    s.ws.send(
      JSON.stringify({
        type: 'config',
        model: st.rec.model,
        language: st.rec.language,
        initialPrompt: buildInitialPrompt(),
        silenceSec: vad.silenceSec,
        maxSec: vad.maxSec,
        engine: 'local',
        apiKey: tr.apiKey,
        oaiModel: 'gpt-realtime-whisper',
        realtimePreview: tr.realtimePreview,
        localPreview: st.rec.localPreview
      })
    )
  } catch {
    /* ignore */
  }
}

export async function stopRecording(): Promise<void> {
  const s = session
  if (!s) {
    // stop pressed during optimistic startup (session not created yet) → cancel the in-flight
    // setup and flip the UI back; startRecording aborts at its next checkpoint.
    if (starting) {
      cancelStart = true
      useStore.getState().setRecordingMemo(null)
      useStore.getState().setRec({ isRecording: false, paused: false, finalizing: false, sttState: 'idle', partial: '' })
    }
    return
  }
  session = null
  stopWatchdog()
  stalled = false
  void window.api.window.setRecordingActive(false) // allow the Mac to sleep again
  const store = useStore.getState()

  window.clearInterval(s.timer)

  // tear down the capture graph FIRST so no more PCM is produced, THEN flush the last buffered
  // file PCM and wait for all disk appends so the take file is complete.
  s.node.disconnect()
  s.source.disconnect()
  s.fileNode.disconnect()
  s.fileSource.disconnect()
  analyser = null
  s.stream.getTracks().forEach((t) => t.stop())
  s.extra.forEach((t) => t.stop()) // release the kept-alive video + cloned file track
  flushPcm(s.takePath, s.append, true)
  await s.append.chain
  await s.ctx.close()
  await s.fileCtx.close()

  const totalPaused = pausedMs + (pausedFlag ? Date.now() - pauseStartMs : 0)
  const durationSec = (Date.now() - s.startMs - totalPaused) / 1000
  pausedFlag = false
  store.setRec({ isRecording: false, paused: false, elapsedSec: durationSec, finalizing: true, finalizeRemaining: 0, partial: '' })

  // Tell the server to finalize + DRAIN its transcription queue, and wait for the 'stopped'
  // ack. Trailing segments keep arriving via onmessage until then. We wait on PROGRESS
  // (bumpFinalizeStall resets on each segment/finalizing message) and only give up if
  // transcription stalls for FINALIZE_STALL_MS — so a large backlog drains fully instead
  // of being cut off by a fixed deadline (which previously lost the tail).
  await new Promise<void>((resolve) => {
    stoppedResolve = resolve
    bumpFinalizeStall()
    try {
      if (s.ws.readyState === WebSocket.OPEN) s.ws.send(JSON.stringify({ type: 'stop' }))
      else {
        clearFinalizeStall()
        stoppedResolve = null
        resolve()
      }
    } catch {
      clearFinalizeStall()
      stoppedResolve = null
      resolve()
    }
  })
  try {
    s.ws.close()
  } catch {
    /* ignore */
  }

  // flush corrections for the final chunks that never reached FOLLOW_DELAY (no following
  // chunks ever arrived), so the tail is corrected too — using whatever follows (maybe none).
  if (useStore.getState().rec.liveCorrect && useStore.getState().aiReady) {
    const st2 = useStore.getState()
    const agent = st2.agents.find((a) => a.id === st2.activeAgentId)
    const sysPrompt = correctionSystemPrompt(agent)
    const n = st2.rec.liveSegments.length
    for (let j = scheduledIdx + 1; j < n; j++) scheduleCorrection(j, sysPrompt)
  }

  // wait for realtime per-chunk corrections to drain so the saved transcript reflects them
  const waitStart = Date.now()
  while ((activeCorrections > 0 || correctQueue.length) && Date.now() - waitStart < 120000) {
    await new Promise((r) => setTimeout(r, 200))
  }

  // ---- APPEND this take onto the RECORDING memo (NOT whatever is selected now) ----
  // The user may have navigated to other memos while recording; always write back to
  // the memo the recording started on. Read its current content fresh from the DB.
  const targetId = s.memoId
  const targetMemo = await window.api.memos.get(targetId)
  const baseSegs = targetMemo?.segments ?? s.base.segments
  const baseMd = targetMemo?.transcriptMd ?? s.base.md
  const newSegs = useStore.getState().rec.liveSegments.filter((x) => x.text.trim()) // drop merged-away
  const allSegs = [...baseSegs, ...newSegs]
  const agent = useStore
    .getState()
    .agents.find((a) => a.id === (targetMemo?.agentId ?? useStore.getState().activeAgentId))
  const rules = agent?.mathRules ?? {}
  const reps = agent?.replacements ?? {}
  const newMd = segmentsToMarkdown(newSegs, rules, reps)
  const md = baseMd.trim() ? `${baseMd.trim()}\n\n${newMd}` : segmentsToMarkdown(allSegs, rules, reps)

  // finalize the take file (concatenated onto the previous take if any)
  try {
    const total = s.base.durationSec + durationSec
    await window.api.recordings.finalizeTake(targetId, s.takePath, total, s.base.audioPath ?? undefined)
  } catch (e) {
    console.error('recording finalize failed', e)
  }

  // clear the live buffer BEFORE persisting so the new segments aren't shown twice
  useStore.getState().resetLive()
  await window.api.memos.updateTranscript(targetId, md, allSegs)
  const st = useStore.getState()
  // reflect in the UI only if the recording memo is the one currently open
  if (st.selectedMemoId === targetId) await st.reloadMemo()
  await st.refreshMemos() // update sidebar counts/previews
  st.setRecordingMemo(null)
  st.setRec({ finalizing: false, finalizeRemaining: 0, sttState: 'idle' })

  // optional: auto-structure on stop — only when the recorded memo is in view
  // (structureMemo operates on the currently selected memo)
  if (st.rec.structureOnStop && useStore.getState().selectedMemoId === targetId) {
    await useStore.getState().structureMemo()
  }
}
