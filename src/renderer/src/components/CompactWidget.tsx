import { Mic, Square, Pause, Play, Maximize2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import { fmtClock } from '../lib/time'
import { startRecording, stopRecording, pauseRecording, resumeRecording } from '../audio/recorderController'

function TypingDots(): JSX.Element {
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <span className="dictly-dot" style={{ animationDelay: '0s' }} />
      <span className="dictly-dot" style={{ animationDelay: '0.18s' }} />
      <span className="dictly-dot" style={{ animationDelay: '0.36s' }} />
    </span>
  )
}

/**
 * The whole window when in compact mode: a small floating pill (fixed size, always
 * on top across Spaces) showing the live transcript over two lines + record controls,
 * so you can keep recording while working elsewhere. The ⤢ button restores full size.
 */
export function CompactWidget(): JSX.Element {
  const { rec, memo, allMemos, recordingMemoId, exitCompact } = useStore()
  const active = rec.isRecording || rec.finalizing

  // live text from the recent segments + current partial; rendered bottom-anchored in a
  // fixed 2-line box so the LATEST words always show (older text scrolls up, never "…").
  const recent = rec.liveSegments.filter((s) => s.text.trim()).slice(-4).map((s) => s.text).join(' ')
  const recName = recordingMemoId != null ? allMemos.find((m) => m.id === recordingMemoId)?.title ?? memo?.title : memo?.title
  const liveText = active ? `${recent} ${rec.partial}`.trim() || '…' : (recName || '대기 중').trim()

  const onStart = async (): Promise<void> => {
    if (!useStore.getState().memo) await useStore.getState().createMemo()
    await startRecording()
  }

  const btn = 'no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition'

  return (
    <div className="drag flex h-full w-full select-none items-center gap-2 bg-panel px-3">
      <span className={`h-2 w-2 shrink-0 rounded-full ${active && !rec.paused ? 'animate-pulse bg-red-500' : 'bg-gray-400'}`} />
      {/* max 2 lines: short text is centered by the row (items-center); long text is
          bottom-anchored so the latest words stay visible (no fixed height = no awkward
          bottom-alignment on a single line). */}
      <div className="flex max-h-9 flex-1 flex-col justify-end overflow-hidden">
        <span className="text-[12.5px] leading-snug text-ink">{liveText}</span>
      </div>
      {active && !rec.paused && <TypingDots />}
      {active && <span className="clock shrink-0 text-[12px] tabular-nums text-subtle">{fmtClock(rec.elapsedSec)}</span>}
      <div className="flex w-[112px] shrink-0 items-center justify-end gap-1.5">
        {active ? (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (rec.paused) resumeRecording()
                else pauseRecording()
              }}
              className={`${btn} bg-black/5 text-ink hover:bg-black/10`}
              title={rec.paused ? '재개' : '일시중지'}
            >
              {rec.paused ? <Play size={14} fill="currentColor" /> : <Pause size={14} fill="currentColor" />}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                void stopRecording()
              }}
              className={`${btn} bg-red-500 text-white hover:bg-red-600`}
              title="녹음 종료"
            >
              <Square size={12} fill="white" />
            </button>
          </>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation()
              void onStart()
            }}
            className={`${btn} bg-accent text-white hover:bg-accent/90`}
            title="녹음 시작"
          >
            <Mic size={15} />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation()
            void exitCompact()
          }}
          className={`${btn} bg-black/5 text-subtle hover:bg-black/10`}
          title="전체화면으로 복원"
        >
          <Maximize2 size={14} />
        </button>
      </div>
    </div>
  )
}
