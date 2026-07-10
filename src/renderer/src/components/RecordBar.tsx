import { useEffect, useRef, useState } from 'react'
import { Mic, Square, Pause, Play, Settings2, Loader2, Users } from 'lucide-react'
import { useStore } from '../store/useStore'
import { fmtClock } from '../lib/time'
import { startRecording, stopRecording, pauseRecording, resumeRecording, reconfigureSession } from '../audio/recorderController'
import { Waveform } from './Waveform'
import { AgentMenu, ModelMenu, SourceMenu } from './ModelSelect'

/** Elapsed clock isolated so the 250ms tick re-renders ONLY this tiny span, not the whole bar. */
function RecClock(): JSX.Element {
  const elapsedSec = useStore((s) => s.rec.elapsedSec)
  return (
    <span className="dictly-pop-in min-w-[44px] text-center clock text-[13px] tabular-nums text-ink">{fmtClock(elapsedSec)}</span>
  )
}

/** ⚙ options popover — available both idle and DURING recording (toggles apply live). */
function Options(): JSX.Element {
  const setRec = useStore((s) => s.setRec)
  const aiReady = useStore((s) => s.aiReady)
  const openaiKeySet = useStore((s) => s.openaiKeySet)
  const realtimePreview = useStore((s) => s.realtimePreview)
  const setRealtimePreview = useStore((s) => s.setRealtimePreview)
  const liveCorrect = useStore((s) => s.rec.liveCorrect)
  const structureOnStop = useStore((s) => s.rec.structureOnStop)
  const localPreview = useStore((s) => s.rec.localPreview)
  const sttModel = useStore((s) => s.rec.model)
  const setSttModel = useStore((s) => s.setSttModel)
  const isRecording = useStore((s) => s.rec.isRecording)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const toggleLocalPreview = (on: boolean): void => {
    setRec({ localPreview: on })
    const r = useStore.getState().rec
    if (r.isRecording || r.finalizing) void reconfigureSession()
  }

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const togglePreview = (on: boolean): void => {
    // persist the setting FIRST, then reconfigure the live session (so the sidecar reads
    // the new value) — otherwise toggling off mid-recording wouldn't disconnect realtime.
    void (async () => {
      await setRealtimePreview(on)
      const r = useStore.getState().rec
      if (r.isRecording || r.finalizing) await reconfigureSession()
    })()
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex h-9 w-9 items-center justify-center rounded-full hover:bg-black/5 ${open ? 'bg-black/5 text-accent' : 'text-subtle'}`}
        title="녹음 옵션"
      >
        <Settings2 size={17} />
      </button>
      {open && (
        <div className="absolute bottom-11 left-1/2 w-60 -translate-x-1/2 rounded-2xl border border-black/10 bg-white p-3 shadow-xl">
          <div className="space-y-3">
            {/* local Whisper model — accuracy vs speed */}
            <div>
              <div className="mb-1.5 text-[11px] font-medium text-subtle">전사 모델</div>
              <div className="flex gap-1 rounded-lg bg-black/[0.04] p-0.5">
                {(['turbo', 'large-v3'] as const).map((id) => (
                  <button
                    key={id}
                    onClick={() => void setSttModel(id)}
                    className={`flex-1 rounded-md px-2 py-1 text-[12px] transition ${
                      sttModel === id ? 'bg-white font-medium text-ink shadow-sm' : 'text-subtle hover:text-ink'
                    }`}
                  >
                    {id === 'turbo' ? 'turbo · 빠름' : 'large-v3 · 정확'}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[10.5px] leading-snug text-subtle/80">
                large-v3는 더 정확하지만 느려요. 첫 사용 시 모델을 내려받아요{isRecording ? ' · 다음 녹음부터 적용' : ''}.
              </p>
            </div>
            <label
              className={`flex items-center gap-2 text-[12px] ${aiReady ? 'text-ink' : 'text-subtle/40'}`}
              title={aiReady ? '청크가 전사될 때마다 AI로 맥락 교정' : 'AI 연결 필요'}
            >
              <input
                type="checkbox"
                checked={liveCorrect && !!aiReady}
                disabled={!aiReady}
                onChange={(e) => setRec({ liveCorrect: e.target.checked })}
                className="accent-accent"
              />
              실시간 교정
            </label>
            <label
              className="flex items-center gap-2 text-[12px] text-ink"
              title="말하는 중 로컬(소형 모델) 미리보기. 끄면 GPU를 전부 확정 전사에 써서 느린 Mac에서 지연이 줄어듭니다."
            >
              <input
                type="checkbox"
                checked={localPreview}
                onChange={(e) => toggleLocalPreview(e.target.checked)}
                className="accent-accent"
              />
              로컬 실시간 미리보기
            </label>
            <label
              className={`flex items-center gap-2 text-[12px] ${openaiKeySet ? 'text-ink' : 'text-subtle/40'}`}
              title={openaiKeySet ? 'OpenAI Realtime으로 단어 단위 미리보기(전사 확정은 그대로)' : '연결에서 OpenAI API 키 필요'}
            >
              <input
                type="checkbox"
                checked={realtimePreview && openaiKeySet}
                disabled={!openaiKeySet}
                onChange={(e) => togglePreview(e.target.checked)}
                className="accent-accent"
              />
              실시간 미리보기 (OpenAI)
            </label>
            <label className="flex items-center gap-2 text-[12px] text-ink" title="녹음 종료 후 맥락 단위로 그룹화 + 부제목 정리">
              <input
                type="checkbox"
                checked={structureOnStop && !!aiReady}
                disabled={!aiReady}
                onChange={(e) => setRec({ structureOnStop: e.target.checked })}
                className="accent-accent"
              />
              종료 후 자동 정리
            </label>
            {!openaiKeySet && <p className="text-[11px] text-subtle">미리보기는 상단 “연결”에서 OpenAI 키 입력 후 사용</p>}
          </div>
        </div>
      )}
    </div>
  )
}

/** 에이전트/키워드 quick-open button — sits next to the ⚙ options in the pill. */
function AgentPillButton(): JSX.Element {
  const setAgentManagerOpen = useStore((s) => s.setAgentManagerOpen)
  return (
    <button
      onClick={() => setAgentManagerOpen(true, true)}
      className="flex h-9 w-9 items-center justify-center rounded-full text-subtle hover:bg-black/5"
      title="에이전트 / 키워드"
    >
      <Users size={17} />
    </button>
  )
}

export function RecordBar(): JSX.Element {
  // fine-grained: the bar re-renders on state changes, not on the 250ms clock (see RecClock)
  const isRecording = useStore((s) => s.rec.isRecording)
  const finalizing = useStore((s) => s.rec.finalizing)
  const paused = useStore((s) => s.rec.paused)
  const finalizeRemaining = useStore((s) => s.rec.finalizeRemaining)
  const sttError = useStore((s) => s.rec.sttError)
  const memo = useStore((s) => s.memo)
  const allMemos = useStore((s) => s.allMemos)
  const recordingMemoId = useStore((s) => s.recordingMemoId)

  const active = isRecording || finalizing
  const recTitle =
    recordingMemoId != null ? allMemos.find((m) => m.id === recordingMemoId)?.title ?? memo?.title ?? '녹음 중' : ''

  const start = async (): Promise<void> => {
    if (!memo) await useStore.getState().createMemo()
    await startRecording()
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex flex-col items-center gap-1.5 px-4">
      {sttError && (
        <div className="pointer-events-auto flex max-w-[520px] items-center gap-2 rounded-xl bg-red-50 px-3 py-1.5 text-[12px] text-red-600 shadow-lg ring-1 ring-red-200">
          <span className="flex-1">{sttError}</span>
          {sttError.includes('화면 녹화') && (
            <button
              onClick={() => window.api.permissions.openScreenSettings()}
              className="shrink-0 rounded-md bg-red-100 px-2 py-1 font-medium text-red-700 hover:bg-red-200"
            >
              화면 기록 설정 열기
            </button>
          )}
        </div>
      )}

      {/* title of the memo currently being recorded, floating above the pulse */}
      {active && (
        <div className="dictly-pop-in pointer-events-none flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-0.5 text-[11px] font-medium text-white shadow">
          <span className={`h-1.5 w-1.5 rounded-full ${paused ? 'bg-gray-300' : 'animate-pulse bg-emerald-400'}`} />
          <span className="max-w-[240px] truncate">{recTitle}</span>
        </div>
      )}

      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-black/10 bg-white/95 px-2.5 py-2 shadow-xl backdrop-blur">
        {active ? (
          finalizing ? (
            // after stop: single non-interactive spinner while the server drains its queue —
            // pause/stop are gone (nothing to control) and a new recording can't be started yet
            <div className="flex items-center gap-2 px-3 py-1.5">
              <Loader2 size={18} className="animate-spin text-accent" />
              <span className="text-[13px] text-subtle">
                전사 마무리 중{finalizeRemaining > 0 ? ` · ${finalizeRemaining}개 남음` : '…'}
              </span>
            </div>
          ) : (
            <>
              <Options />
              <AgentPillButton />
              {/* waveform unfurls — the pill stretches as the pulse appears */}
              <div className="dictly-wave-grow flex h-7 items-center">
                <Waveform paused={paused} />
              </div>
              <RecClock />
              <button
                onClick={() => (paused ? resumeRecording() : pauseRecording())}
                className="dictly-pop-in flex h-10 w-10 items-center justify-center rounded-full bg-black/5 text-ink transition hover:bg-black/10"
                title={paused ? '재개' : '일시중지'}
              >
                {paused ? <Play size={17} fill="currentColor" /> : <Pause size={17} fill="currentColor" />}
              </button>
              <button
                onClick={() => stopRecording()}
                className="dictly-pop-in flex h-10 w-10 items-center justify-center rounded-full bg-red-500 text-white shadow-md transition hover:bg-red-600"
                title="녹음 종료"
              >
                <Square size={16} fill="white" />
              </button>
            </>
          )
        ) : (
          <>
            {/* input source + engine-aware model (model also drives realtime correction) */}
            <SourceMenu />
            <ModelMenu />
            <AgentMenu />
            <Options />
            <button
              onClick={start}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-white shadow-md transition hover:bg-accent/90"
              title="녹음 시작"
            >
              <Mic size={20} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
