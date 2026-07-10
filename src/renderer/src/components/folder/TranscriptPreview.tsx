// Read-only transcript reader for the folder 미리보기 pane: segment list with time chips,
// audio playback, and scroll-to-time (citation chips in folder studio target this).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Pause, Play } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { MarkdownMath } from '../MarkdownMath'
import { applyMathRules } from '../../math/koMathRules'
import { fmtClock, fmtRange } from '../../lib/time'
import type { Memo } from '../../../../shared/types'

export function TranscriptPreview({ memoId, t, nonce }: { memoId: number; t?: number; nonce?: number }): JSX.Element {
  const agents = useStore((s) => s.agents)
  const [memo, setMemo] = useState<Memo | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [curTime, setCurTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setMemo(null)
    setLoadFailed(false)
    window.api.memos
      .get(memoId)
      .then((m) => {
        if (cancelled) return
        if (m) setMemo(m)
        else setLoadFailed(true) // deleted/missing source → don't spin forever
      })
      .catch(() => !cancelled && setLoadFailed(true))
    return () => {
      cancelled = true
    }
  }, [memoId])

  useEffect(() => {
    let revoked: string | null = null
    if (memo?.audioPath) {
      void window.api.recordings.read(memo.audioPath).then((bytes) => {
        if (!bytes) return
        const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'audio/webm' }))
        revoked = url
        setAudioUrl(url)
      })
    } else {
      setAudioUrl(null)
    }
    return () => {
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [memo?.audioPath])

  const agent = useMemo(() => agents.find((a) => a.id === (memo?.agentId ?? null)), [agents, memo?.agentId])
  const segments = memo?.segments ?? []
  const mathRules = agent?.mathRules ?? {}
  const replacements = agent?.replacements ?? {}

  const seek = (sec: number): void => {
    const a = audioRef.current
    if (a) {
      a.currentTime = sec
      void a.play()
    }
  }
  const togglePlay = (): void => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) void a.play()
    else a.pause()
  }

  // citation jump → scroll the cited chunk to center + play
  useEffect(() => {
    if (t == null || !segments.length) return
    let idx = segments.findIndex((s) => t >= s.tStart && t < s.tEnd)
    if (idx < 0) {
      let bd = 30
      segments.forEach((s, i) => {
        const d = Math.abs(s.tStart - t)
        if (d < bd) {
          bd = d
          idx = i
        }
      })
    }
    if (idx < 0) return
    let tries = 0
    const center = (): void => {
      const c = contentRef.current
      const row = c?.querySelector(`[data-seg-idx="${idx}"]`) as HTMLElement | null
      if (!c) return
      if (!row) {
        if (tries++ < 10) requestAnimationFrame(center)
        return
      }
      const cr = c.getBoundingClientRect()
      const rr = row.getBoundingClientRect()
      c.scrollTo({ top: c.scrollTop + (rr.top - cr.top) - c.clientHeight / 2 + rr.height / 2, behavior: 'smooth' })
    }
    requestAnimationFrame(() => requestAnimationFrame(center))
    seek(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, nonce, segments.length])

  if (loadFailed) {
    return <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-subtle">전사문을 불러올 수 없어요</div>
  }
  if (!memo) {
    return (
      <div className="flex h-full items-center justify-center text-subtle">
        <Loader2 size={16} className="animate-spin" />
      </div>
    )
  }

  const activeIdx = playing ? segments.findIndex((s) => curTime >= s.tStart && curTime < s.tEnd) : -1

  return (
    <div className="flex h-full min-h-0 flex-col">
      {audioUrl && (
        <div className="flex shrink-0 items-center gap-3 border-b border-black/5 px-4 py-2">
          <button onClick={togglePlay} className="flex h-8 w-8 items-center justify-center rounded-full bg-black/5 hover:bg-black/10">
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <span className="clock text-[12px] tabular-nums text-subtle">{fmtClock(curTime)}</span>
          <input
            type="range"
            min={0}
            max={memo.durationSec || 0}
            value={curTime}
            onChange={(e) => seek(Number(e.target.value))}
            className="h-1 flex-1 accent-accent"
          />
          <span className="clock text-[12px] tabular-nums text-subtle">{fmtClock(memo.durationSec)}</span>
          <audio
            ref={audioRef}
            src={audioUrl}
            onTimeUpdate={(e) => setCurTime((e.target as HTMLAudioElement).currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            hidden
          />
        </div>
      )}
      <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-3">
        {segments.length === 0 ? (
          <div className="mt-8 text-center text-[12px] text-subtle">전사문이 없습니다</div>
        ) : (
          <div className="space-y-3">
            {segments.map((s, i) =>
              s.text.trim() ? (
                <div key={i} data-seg-idx={i} className="group">
                  <div className="mb-0.5 flex items-center gap-2">
                    <button onClick={() => seek(s.tStart)} className="clock text-[11px] text-subtle hover:text-accent">
                      {fmtRange(s.tStart, s.tEnd)}
                    </button>
                  </div>
                  <div className={i === activeIdx ? 'playing-seg rounded' : 'rounded'}>
                    <MarkdownMath className="!text-[15px] [&_p]:!my-0">{applyMathRules(s.text, mathRules, replacements)}</MarkdownMath>
                  </div>
                </div>
              ) : null
            )}
          </div>
        )}
      </div>
    </div>
  )
}
