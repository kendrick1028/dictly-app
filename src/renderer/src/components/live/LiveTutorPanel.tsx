// 코파일럿 panel — sits in the studio's slot (studio collapses while it is open) and shows the
// explanation cards streamed from the live transcript, one per ~25 s block. Cards quote the
// lecturer / the slide (blockquotes) and re-explain in plain language; "더 쉽게" re-explains one
// card at a simpler level; clicking the time span jumps the transcript there.
import { useEffect, useRef, useState } from 'react'
import { Copy, GraduationCap, MessageCircleQuestion, Pause, Play, SendHorizonal, Sparkles, Wand2, X } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { MarkdownMath } from '../MarkdownMath'
import { fmtRange } from '../../lib/time'
import { copyText } from '../../lib/clipboard'
import { useStickToBottom, JumpToLatest } from '../../lib/useStickToBottom'
import { liveEngine } from '../../live/liveLectureEngine'
import { askCopilotStandalone, loadCopilotForNote } from '../../live/liveTutorController'
import { splitKeywordLine } from '../../live/livePrompts'
import type { LiveTutorCard } from '../../../../shared/types'

function Dots(): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <span className="dictly-dot" style={{ animationDelay: '0s' }} />
      <span className="dictly-dot" style={{ animationDelay: '0.18s' }} />
      <span className="dictly-dot" style={{ animationDelay: '0.36s' }} />
    </span>
  )
}

const MD = 'dictly-copilot !text-[13.5px] leading-[1.75] [&_p]:!my-2 [&_ul]:!my-1.5 [&_ul]:!pl-5 [&_li]:!my-1 [&_strong]:text-ink'

/** "핵심 키워드" chips parsed off the top of a card */
export function KeywordChips({ keywords }: { keywords: string[] }): JSX.Element | null {
  if (!keywords.length) return null
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1">
      <span className="text-[10.5px] font-semibold text-subtle">핵심 키워드</span>
      {keywords.map((k) => (
        <span key={k} className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent">
          {k}
        </span>
      ))}
    </div>
  )
}

/** plain function (not a component) so streaming re-renders don't remount the markdown tree */
function Skeleton(): JSX.Element {
  return (
    <div className="space-y-2 py-1">
      {[0.95, 0.8, 0.6].map((w, i) => (
        <div key={i} className="dictly-shimmer h-3 rounded" style={{ width: `${w * 100}%` }} />
      ))}
    </div>
  )
}

function renderCard(card: LiveTutorCard, opts: { streamingMd?: string; onJump: () => void; onSimpler?: () => void; busy: boolean }): JSX.Element {
  const streaming = opts.streamingMd != null
  const hasSpan = card.tEnd > card.tStart || card.tStart > 0
  const { keywords, body } = splitKeywordLine(streaming ? (opts.streamingMd ?? '') : card.md)
  return (
    <div key={card.id} className={`rounded-xl border px-3 py-2.5 ${streaming ? 'border-accent/30 bg-accent/[0.04]' : 'border-black/5 bg-black/[0.02]'}`}>
      <div className="mb-1 flex items-center gap-1.5">
        {card.question ? (
          <span className="flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-700">
            <MessageCircleQuestion size={11} /> 내 질문
          </span>
        ) : hasSpan ? (
          <button onClick={opts.onJump} className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums text-accent hover:bg-accent/20" title="전사문에서 이 구간 보기">
            {fmtRange(card.tStart, card.tEnd)}
          </button>
        ) : (
          <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[10.5px] font-medium text-accent">설명 생성 중</span>
        )}
        {card.pdfPage != null && <span className="rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[10.5px] text-subtle">p.{card.pdfPage}</span>}
        <div className="flex-1" />
        {!streaming && opts.onSimpler && !card.question && (
          <button onClick={opts.onSimpler} disabled={opts.busy} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] text-subtle hover:bg-black/5 hover:text-ink disabled:opacity-40" title="이 설명을 더 쉽게 다시 풀어달라고 하기">
            <Wand2 size={11} /> 더 쉽게
          </button>
        )}
      </div>
      {card.question && <div className="mb-1.5 rounded-lg bg-white/70 px-2.5 py-1.5 text-[13px] font-medium text-ink">{card.question}</div>}
      <KeywordChips keywords={keywords} />
      {streaming && !opts.streamingMd ? (
        <Skeleton />
      ) : (
        <MarkdownMath className={MD}>{body}</MarkdownMath>
      )}
    </div>
  )
}

/** question box at the bottom of the panel: during a recording the live controller answers with
 *  the session's context; on a finished note the standalone path uses the saved transcript */
function AskBar({ disabled, onAsk }: { disabled: boolean; onAsk: (q: string) => void }): JSX.Element {
  const [q, setQ] = useState('')
  const send = (): void => {
    const t = q.trim()
    if (!t || disabled) return
    onAsk(t)
    setQ('')
  }
  return (
    <div className="shrink-0 border-t border-black/5 px-3 py-2">
      <div className={`flex items-end gap-1.5 rounded-xl border bg-white px-2.5 py-1.5 ${disabled ? 'border-black/5 opacity-60' : 'border-black/10 focus-within:border-accent'}`}>
        <textarea
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
          disabled={disabled}
          rows={1}
          placeholder="지금 내용에 대해 질문하기…"
          className="max-h-24 min-h-[22px] flex-1 resize-none bg-transparent text-[13px] leading-[22px] text-ink outline-none placeholder:text-subtle/70"
          style={{ height: 'auto' }}
          onInput={(e) => {
            const el = e.currentTarget
            el.style.height = 'auto'
            el.style.height = `${Math.min(96, el.scrollHeight)}px`
          }}
        />
        <button onClick={send} disabled={disabled || !q.trim()} className="rounded-lg p-1 text-accent hover:bg-accent/10 disabled:opacity-40" title="질문 보내기 (Enter)">
          <SendHorizonal size={15} />
        </button>
      </div>
    </div>
  )
}

export function LiveTutorPanel(): JSX.Element {
  const toggleLiveTutor = useStore((s) => s.toggleLiveTutor)
  const setLiveTutor = useStore((s) => s.setLiveTutor)
  const cards = useStore((s) => s.liveTutor.cards)
  const streaming = useStore((s) => s.liveTutor.streaming)
  const status = useStore((s) => s.liveTutor.status)
  const error = useStore((s) => s.liveTutor.error)
  const aiReady = useStore((s) => s.aiReady)
  const isRecording = useStore((s) => s.rec.isRecording)
  const recordingMemoId = useStore((s) => s.recordingMemoId)
  const memoId = useStore((s) => s.memo?.id ?? null)
  const setScrollTarget = useStore((s) => s.setScrollTarget)
  const setTab = useStore((s) => s.setTab)
  const contentRef = useRef<HTMLDivElement>(null)
  const { following, followRef, scrollToBottom } = useStickToBottom(contentRef)
  const recordingThis = isRecording && recordingMemoId != null && recordingMemoId === memoId
  const paused = status === 'paused'
  // opening the panel on a finished note shows that note's saved 코파일럿 (one per note)
  useEffect(() => {
    if (memoId != null && !recordingThis) void loadCopilotForNote(memoId)
  }, [memoId, recordingThis])

  const jump = (t: number): void => {
    if (memoId == null) return
    setTab('transcript')
    setScrollTarget({ memoId, t })
  }
  const copyAll = (): void => {
    const md = cards.map((c) => `### ${fmtRange(c.tStart, c.tEnd)}${c.pdfPage != null ? ` · p.${c.pdfPage}` : ''}\n\n${c.md}`).join('\n\n')
    void copyText(md)
    useStore.getState().showToast('코파일럿 설명을 복사했어요')
  }
  const streamingCard: LiveTutorCard | null = streaming
    ? (cards.find((c) => c.id === streaming.cardId) ?? {
        id: streaming.cardId,
        tStart: streaming.tStart ?? 0,
        tEnd: streaming.tEnd ?? 0,
        sourceText: '',
        md: '',
        pdfPage: streaming.pdfPage ?? null,
        createdAt: 0
      })
    : null
  const streamingIsExisting = !!streaming && cards.some((c) => c.id === streaming.cardId)

  // auto-follow the newest card / streaming text (unless the user scrolled up to read).
  // Instant (never smooth: a smooth scroll restarted on every token lags behind the text), and
  // repeated on the next frame because KaTeX/markdown can grow the card after the commit.
  const total = cards.length + (streaming?.md.length ?? 0) + (streaming ? 1 : 0)
  useEffect(() => {
    if (!followRef.current) return
    const el = contentRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'instant' })
    const raf = requestAnimationFrame(() => {
      if (followRef.current) el.scrollTo({ top: el.scrollHeight, behavior: 'instant' })
    })
    return () => cancelAnimationFrame(raf)
  }, [total, followRef])

  return (
    <div className="dictly-anim-in flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 px-3 pb-1.5 pt-2.5">
        <GraduationCap size={14} className="text-orange-600" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-subtle">코파일럿</span>
        <span
          className={`ml-1 inline-block h-1.5 w-1.5 rounded-full ${
            status === 'thinking' ? 'animate-pulse bg-accent' : status === 'listening' ? 'bg-emerald-500' : paused ? 'bg-amber-400' : 'bg-gray-300'
          }`}
          title={status === 'thinking' ? '설명 생성 중' : status === 'listening' ? '강의 듣는 중' : paused ? '일시정지' : '대기'}
        />
        <div className="flex-1" />
        {recordingThis && (
          <>
            <button
              onClick={() => liveEngine()?.tutor.explainNow()}
              disabled={!aiReady || paused || status === 'thinking'}
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-40"
              title="지금까지 들은 내용을 바로 설명"
            >
              <Sparkles size={12} /> 지금 설명
            </button>
            <button
              onClick={() => {
                if (paused) setLiveTutor({ status: 'listening' })
                else {
                  liveEngine()?.tutor.abort()
                  setLiveTutor({ status: 'paused' })
                }
              }}
              className="rounded p-1 text-subtle hover:bg-black/5"
              title={paused ? '코파일럿 다시 켜기' : '코파일럿 잠시 멈춤'}
            >
              {paused ? <Play size={14} /> : <Pause size={14} />}
            </button>
          </>
        )}
        {cards.length > 0 && (
          <button onClick={copyAll} className="rounded p-1 text-subtle hover:bg-black/5" title="설명 전체 복사 (마크다운)">
            <Copy size={14} />
          </button>
        )}
        <button onClick={() => toggleLiveTutor(false)} className="rounded p-1 text-subtle hover:bg-black/5" title="닫기">
          <X size={15} />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={contentRef} className="absolute inset-0 space-y-2 overflow-y-auto px-3 pb-4 pt-1">
          {!aiReady && <div className="mt-10 px-4 text-center text-[12px] leading-relaxed text-subtle">AI가 연결되어 있지 않아요. 상단 연결에서 설정하세요.</div>}
          {aiReady && !recordingThis && cards.length === 0 && (
            <div className="mt-10 px-4 text-center text-[12px] leading-relaxed text-subtle">
              녹음을 시작하면 교수님 설명을 20~30초 단위로
              <br />
              인용하고, 쉬운 말로 다시 풀어 드려요.
            </div>
          )}
          {aiReady && recordingThis && cards.length === 0 && !streaming && (
            <div className="mt-10 px-4 text-center text-[12px] leading-relaxed text-subtle">
              듣는 중… 첫 설명은 약 25초 뒤에 나와요.
              <br />
              지금 바로 듣고 싶으면 <b>지금 설명</b>을 누르세요.
            </div>
          )}
          {cards.map((c) =>
            renderCard(c, {
              streamingMd: streaming && streaming.cardId === c.id ? streaming.md : undefined,
              onJump: () => jump(c.tStart),
              onSimpler: recordingThis ? () => liveEngine()?.tutor.simplify(c.id) : undefined,
              busy: !!streaming
            })
          )}
          {streaming && streamingCard && !streamingIsExisting && renderCard(streamingCard, { streamingMd: streaming.md, onJump: () => {}, busy: true })}
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-[11.5px] text-red-600">{error}</div>}
        </div>
        {!following && (cards.length > 0 || !!streaming) && <JumpToLatest onClick={scrollToBottom} />}
      </div>
      <AskBar
        disabled={!aiReady || memoId == null}
        onAsk={(q) => {
          const eng = liveEngine()
          if (recordingThis && eng) eng.tutor.ask(q)
          else if (memoId != null) void askCopilotStandalone(memoId, q)
        }}
      />
    </div>
  )
}
