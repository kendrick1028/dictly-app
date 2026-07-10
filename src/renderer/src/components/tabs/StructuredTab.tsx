import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, Sparkles, Loader2 } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { MarkdownMath } from '../MarkdownMath'
import { applyMathRules } from '../../math/koMathRules'
import { fmtClock, fmtRange } from '../../lib/time'
import { isHeading } from '../../lib/structure'

export function StructuredTab(): JSX.Element {
  const { memo, agents, activeAgentId, aiReady, busy, structureMemo, saveStructuredSegments } = useStore()
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [curTime, setCurTime] = useState(0)

  const agent = useMemo(
    () => agents.find((a) => a.id === (memo?.agentId ?? activeAgentId)),
    [agents, memo?.agentId, activeAgentId]
  )
  const mathRules = agent?.mathRules ?? {}
  const replacements = agent?.replacements ?? {}

  useEffect(() => {
    let revoked: string | null = null
    setAudioUrl(null)
    if (memo?.audioPath) {
      window.api.recordings.read(memo.audioPath).then((bytes) => {
        if (!bytes) return
        const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'audio/webm' }))
        revoked = url
        setAudioUrl(url)
      })
    }
    return () => {
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [memo?.audioPath])

  useEffect(() => {
    if (editIdx !== null && taRef.current) {
      taRef.current.style.height = 'auto'
      taRef.current.style.height = taRef.current.scrollHeight + 'px'
      taRef.current.focus()
    }
  }, [editIdx, editText])

  if (!memo) return <div />
  const loading = busy.structure
  const segs = memo.structuredSegments
  const hasTranscript = memo.segments.length > 0 || memo.transcriptMd.trim().length > 0
  const activeIdx = playing ? segs.findIndex((s) => curTime >= s.tStart && curTime < s.tEnd) : -1

  const seek = (t: number): void => {
    if (audioRef.current) {
      audioRef.current.currentTime = t
      audioRef.current.play()
    }
  }
  const togglePlay = (): void => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) a.play()
    else a.pause()
  }

  const startEdit = (i: number): void => {
    setEditIdx(i)
    setEditText(segs[i].text)
  }
  const commitEdit = async (): Promise<void> => {
    if (editIdx === null) return
    const idx = editIdx
    setEditIdx(null)
    if (segs[idx]?.text === editText) return
    const next = segs.map((s, i) => (i === idx ? { ...s, text: editText } : s))
    await saveStructuredSegments(next)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-2">
        <button
          onClick={() => structureMemo()}
          disabled={loading || !hasTranscript || !aiReady}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          title="전체 맥락을 보고 교정 + 맥락 단위 그룹화 + 부제목"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {loading ? '정리 생성 중…' : segs.length ? '다시 정리' : '정리 생성'}
        </button>
        {segs.length > 0 && !loading && <span className="text-[12px] text-subtle">구간을 클릭하면 그 부분부터 재생 · 텍스트 클릭 시 수정</span>}
        {!aiReady && <span className="text-[12px] text-red-500">AI 미연결 — 상단 “연결”에서 설정</span>}
      </div>

      {audioUrl && segs.length > 0 && (
        <div className="flex items-center gap-3 border-b border-black/5 px-4 py-2">
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

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {loading && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-accent">
            <Loader2 size={14} className="animate-spin" /> 맥락 단위로 정리하는 중이에요
            <span className="inline-flex items-center gap-1">
              <span className="dictly-dot" style={{ animationDelay: '0s' }} />
              <span className="dictly-dot" style={{ animationDelay: '0.18s' }} />
              <span className="dictly-dot" style={{ animationDelay: '0.36s' }} />
            </span>
          </div>
        )}
        {segs.length === 0 && !loading && (
          <div className="mt-16 text-center text-subtle">
            <p className="text-[14px]">아직 정리된 내용이 없어요</p>
            <p className="mt-1 text-[13px]">“정리 생성”을 누르면 전사 내용을 맥락 단위로 그룹화하고 부제목을 달아 정리해요</p>
            <p className="mt-1 text-[12px]">(음성인식 원문은 그대로 유지돼요)</p>
          </div>
        )}

        <div className="space-y-2.5 pt-1">
          {segs.map((s, i) => {
            const editing = editIdx === i
            const heading = isHeading(s.text) && !editing
            return (
              <div key={i} className={heading ? 'group pt-2' : 'group'}>
                {!heading && !editing && (
                  <button onClick={() => seek(s.tStart)} className="mb-0.5 clock text-[11px] text-subtle hover:text-accent" title="이 구간부터 재생">
                    {fmtRange(s.tStart, s.tEnd)}
                  </button>
                )}
                {editing ? (
                  <textarea
                    ref={taRef}
                    value={editText}
                    onChange={(e) => {
                      setEditText(e.target.value)
                      e.currentTarget.style.height = 'auto'
                      e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px'
                    }}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault()
                        void commitEdit()
                      } else if (e.key === 'Escape') setEditIdx(null)
                    }}
                    className="block w-full resize-none overflow-hidden bg-transparent text-[15px] leading-relaxed text-ink outline-none"
                    style={{ border: 'none', padding: 0, margin: 0, fontFamily: 'inherit' }}
                  />
                ) : (
                  <div
                    onClick={() => startEdit(i)}
                    className={`cursor-text rounded ${i === activeIdx ? 'playing-seg' : ''}`}
                    title="클릭하여 수정"
                  >
                    <MarkdownMath className="!text-[15px] [&_p]:!my-0">{applyMathRules(s.text, mathRules, replacements)}</MarkdownMath>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
