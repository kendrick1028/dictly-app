import { memo, useEffect, useMemo, useRef } from 'react'
import { useStore } from '../../store/useStore'
import { MarkdownMath } from '../MarkdownMath'
import { applyMathRules } from '../../math/koMathRules'
import { buildScript } from '../../lib/structure'

const EMPTY_RULES: Record<string, string> = {}

function TypingDots(): JSX.Element {
  return (
    <span className="ml-1 inline-flex items-center gap-1 align-middle">
      <span className="dictly-dot" style={{ animationDelay: '0s' }} />
      <span className="dictly-dot" style={{ animationDelay: '0.18s' }} />
      <span className="dictly-dot" style={{ animationDelay: '0.36s' }} />
    </span>
  )
}

// Memoized so the whole concatenated transcript re-parses (markdown + KaTeX) ONLY when the
// text actually changes — not on every partial/elapsed tick (which used to re-parse it all).
const RawBody = memo(function RawBody({ md }: { md: string }): JSX.Element {
  return <MarkdownMath className="!text-[15px] leading-loose [&_h2]:mt-4 [&_p]:my-2.5">{md}</MarkdownMath>
})

// live preview line isolated so partial updates re-render only this line
function RawPreview(): JSX.Element | null {
  const partial = useStore((s) => s.rec.partial)
  const paused = useStore((s) => s.rec.paused)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // instant (not 'smooth') — avoids piling up scroll animations that starve the waveform rAF
    if (partial && !paused) ref.current?.scrollIntoView({ block: 'end' })
  }, [partial, paused])
  if (paused) return null
  return (
    <div ref={ref} className="py-1 text-subtle">
      {partial && <span className="block text-[15px]">{partial}</span>}
      <span className="mt-1 inline-block">
        <TypingDots />
      </span>
    </div>
  )
}

export function RawTab(): JSX.Element {
  const memo = useStore((s) => s.memo)
  const agents = useStore((s) => s.agents)
  const activeAgentId = useStore((s) => s.activeAgentId)
  const recordingMemoId = useStore((s) => s.recordingMemoId)
  const isRecording = useStore((s) => s.rec.isRecording)
  const finalizing = useStore((s) => s.rec.finalizing)
  const liveSegments = useStore((s) => s.rec.liveSegments)
  const bottomRef = useRef<HTMLDivElement>(null)

  const agent = useMemo(
    () => agents.find((a) => a.id === (memo?.agentId ?? activeAgentId)),
    [agents, memo?.agentId, activeAgentId]
  )

  const isRecordingThis = recordingMemoId != null && memo?.id === recordingMemoId
  const live = (isRecording || finalizing) && isRecordingThis
  const segments = useMemo(
    () => (memo ? (live ? [...memo.segments, ...liveSegments] : memo.segments) : []),
    [memo, live, liveSegments]
  )
  const script = useMemo(() => buildScript(segments), [segments])
  const mathRules = agent?.mathRules ?? EMPTY_RULES
  const replacements = agent?.replacements ?? EMPTY_RULES
  const md = useMemo(() => applyMathRules(script, mathRules, replacements), [script, mathRules, replacements])

  // keep the latest line in view on new content (partial-driven scrolling is in RawPreview)
  useEffect(() => {
    if (live) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [script, live])

  if (!memo) return <div />
  const hasContent = script.trim().length > 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 py-2 text-[12px] text-subtle">타임라인 없이 이어진 연속 대본 · 실시간</div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {hasContent ? (
          <RawBody md={md} />
        ) : (
          <div className="mt-16 text-center text-subtle">
            <p className="text-[14px]">아직 내용이 없습니다</p>
            <p className="mt-1 text-[13px]">녹음을 시작하면 여기에 연속 대본이 실시간으로 쌓입니다</p>
          </div>
        )}
        {live && <RawPreview />}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
