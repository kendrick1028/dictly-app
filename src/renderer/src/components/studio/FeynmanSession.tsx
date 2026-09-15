// Live Feynman-review session — chat-style UI where the AI asks one question at a time and grades
// the user's spoken-style answers. Top bar = progress (left) + running weighted score (right).
// Questions/answers persist per keystroke-of-answer to the studio item, so leaving & reopening the
// note resumes from the first unanswered question. Finishing a round routes to the report viewer.
import { useEffect, useRef, useState } from 'react'
import { Loader2, Send, Square } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { CitedMarkdown } from './cite/CitedMarkdown'
import { ModelMenu } from '../ModelSelect'
import { prepareStudioContext, resolveStudioTarget, targetFromItem, type StudioContext } from '../../lib/studioJobs'
import { parseFeynmanQuestions } from '../../lib/studioParse'
import { buildFocusSummary, makeRound, parseScoreTail, weightedScore } from '../../lib/feynman'
import { stripCiteTokens } from '../../lib/citations'
import { useAutoGrow } from '../../lib/useAutoGrow'
import type { FeynmanContent, FeynmanRound, StudioItem, StudioSourceMap } from '../../../../shared/types'

function Dots(): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <span className="dictly-dot" style={{ animationDelay: '0s' }} />
      <span className="dictly-dot" style={{ animationDelay: '0.18s' }} />
      <span className="dictly-dot" style={{ animationDelay: '0.36s' }} />
    </span>
  )
}

type Phase = { k: 'gen'; msg: string } | { k: 'ready' } | { k: 'error'; msg: string }

export function FeynmanSession({ itemId }: { itemId: number }): JSX.Element {
  const setStudioView = useStore((s) => s.setStudioView)
  const showToast = useStore((s) => s.showToast)
  const refreshStudioItems = useStore((s) => s.refreshStudioItems)

  const [phase, setPhase] = useState<Phase>({ k: 'gen', msg: '복습 질문을 만들고 있어요…' })
  const [round, setRound] = useState<FeynmanRound | null>(null)
  const [sources, setSources] = useState<StudioSourceMap | null>(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [pendingAnswer, setPendingAnswer] = useState('')
  const [streamText, setStreamText] = useState('')

  const ctxRef = useRef<StudioContext | null>(null)
  const itemRef = useRef<StudioItem | null>(null) // working copy (content kept in sync with DB)
  const runIdRef = useRef(0)
  const streamIdRef = useRef<string | null>(null) // current grade run (for stop)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  useAutoGrow(taRef, input)

  const backToHub = (): void => setStudioView({ mode: 'hub' })

  // ----- init / resume -----
  useEffect(() => {
    const runId = ++runIdRef.current
    const alive = (): boolean => runId === runIdRef.current

    const genQuestions = async (ctx: StudioContext, focus?: string): Promise<ReturnType<typeof parseFeynmanQuestions>> => {
      const opts: Record<string, unknown> = { hasPdfs: ctx.hasPdfs, multiMemo: ctx.multiMemo, ...(focus ? { reviewFocus: focus } : {}) }
      let raw = await window.api.studio.generate('feynman', opts, ctx.manifest.text, ctx.agentSystemPrompt, ctx.model)
      let parsed = parseFeynmanQuestions(raw)
      if (!parsed) {
        raw = await window.api.studio.generate(
          'feynman',
          { ...opts, custom: '★ 직전 출력이 형식에 맞지 않았습니다. 지정된 스키마의 순수 JSON만(코드펜스·설명 없이) 다시 출력하세요.' },
          ctx.manifest.text,
          ctx.agentSystemPrompt,
          ctx.model
        )
        parsed = parseFeynmanQuestions(raw)
      }
      return parsed
    }

    const init = async (): Promise<void> => {
      // brand-new session: generate questions, create the item, then remount with the real id
      if (itemId === 0) {
        const target = resolveStudioTarget()
        if (!target) {
          backToHub()
          return
        }
        setPhase({ k: 'gen', msg: '복습 질문을 만들고 있어요…' })
        const ctx = await prepareStudioContext(target)
        if (!alive()) return
        if (!ctx) {
          backToHub()
          return
        }
        const parsed = await genQuestions(ctx)
        if (!alive()) return
        if (!parsed) {
          setPhase({ k: 'error', msg: 'AI가 질문을 만들지 못했습니다. 다시 시도해 주세요.' })
          return
        }
        const created = await window.api.studio.add({
          memoId: target.kind === 'memo' ? target.memoId : 0,
          folderId: target.kind === 'folder' ? target.folderId : null,
          kind: 'feynman',
          title: parsed.title,
          options: {},
          content: { rounds: [makeRound(0, parsed.questions)], currentRound: 0 } as FeynmanContent,
          sources: ctx.manifest.sources
        })
        if (!alive()) return
        await refreshStudioItems()
        setStudioView({ mode: 'feynman', itemId: created.id }) // key change → remount on the real id
        return
      }

      // existing item: resume an active round, or (entered from 복습하기) spawn a review round
      const it = useStore.getState().studioItems.find((x) => x.id === itemId)
      if (!it || it.kind !== 'feynman') {
        backToHub()
        return
      }
      itemRef.current = it
      setSources(it.sources)
      const content = it.content as FeynmanContent
      const cur = content.rounds[content.currentRound] ?? content.rounds[content.rounds.length - 1]

      // resume from the ITEM's own stored sources — no live selection required
      const target = targetFromItem(it)
      if (!target) {
        setPhase({ k: 'error', msg: '이 항목의 소스를 찾을 수 없습니다.' })
        return
      }
      const ctx = await prepareStudioContext(target, { quiet: true })
      if (!alive()) return
      if (!ctx) {
        setPhase({ k: 'error', msg: '소스를 불러오지 못했습니다. 전사문 또는 PDF가 필요합니다.' })
        return
      }
      ctxRef.current = ctx

      if (cur && cur.status === 'active') {
        setRound(cur)
        setPhase({ k: 'ready' })
        return
      }
      // 복습하기 → new review round seeded with the last round's weak areas
      setPhase({ k: 'gen', msg: '미흡했던 부분 위주로 복습 질문을 만들고 있어요…' })
      const last = content.rounds[content.rounds.length - 1]
      const parsed = await genQuestions(ctx, buildFocusSummary(last))
      if (!alive()) return
      if (!parsed) {
        setPhase({ k: 'error', msg: 'AI가 복습 질문을 만들지 못했습니다. 다시 시도해 주세요.' })
        return
      }
      const newRound = makeRound(content.rounds.length, parsed.questions, buildFocusSummary(last))
      const newContent: FeynmanContent = { rounds: [...content.rounds, newRound], currentRound: content.rounds.length }
      await window.api.studio.update(itemId, { content: newContent })
      if (!alive()) return
      itemRef.current = { ...it, content: newContent }
      await refreshStudioItems()
      setRound(newRound)
      setPhase({ k: 'ready' })
    }

    void init()
    return () => {
      runIdRef.current++ // invalidate in-flight work on unmount / itemId change
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId])

  // follow new content ONLY when already near the bottom, so the user can scroll up freely while grading streams
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140
    if (nearBottom) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [round?.answers.length, sending, streamText])

  // on first opening a session that already has answered turns, jump to the latest
  const initScrollRef = useRef(-1)
  useEffect(() => {
    if (phase.k !== 'ready' || !round) return
    if (initScrollRef.current === itemId) return
    initScrollRef.current = itemId
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }))
  }, [phase, round, itemId])

  // ----- grading -----
  const send = async (): Promise<void> => {
    const text = input.trim()
    const ctx = ctxRef.current
    const item = itemRef.current
    if (!text || sending || !round || !ctx || !item) return
    const i = round.answers.length
    if (i >= round.questions.length) return
    const q = round.questions[i]
    setInput('')
    setPendingAnswer(text)
    setSending(true)
    setStreamText('')
    const sid = `${Date.now()}_${Math.floor(Math.random() * 1e9)}`
    streamIdRef.current = sid
    const model = useStore.getState().claudeModel
    const prior = round.answers
      .map((a, k) => `Q${k + 1}: ${stripCiteTokens(round.questions[k].question)} → ${a.score}점`)
      .join('\n')
    try {
      const raw = await window.api.studio.feynmanGrade(
        sid,
        ctx.manifest.text,
        q.question,
        q.modelAnswer,
        text,
        prior,
        ctx.hasPdfs,
        ctx.multiMemo,
        ctx.agentSystemPrompt,
        model,
        (full) => setStreamText(full)
      )
      const { body, score } = parseScoreTail(raw)
      const newAnswers = [...round.answers, { userAnswer: text, score: score ?? 0, feedback: body }]
      const done = newAnswers.length >= round.questions.length
      const updated: FeynmanRound = {
        ...round,
        answers: newAnswers,
        status: done ? 'done' : 'active',
        finalScore: done ? weightedScore(newAnswers, round.questions) : null
      }
      const content = item.content as FeynmanContent
      const newContent: FeynmanContent = { ...content, rounds: content.rounds.map((r, idx) => (idx === content.currentRound ? updated : r)) }
      await window.api.studio.update(itemId, { content: newContent })
      itemRef.current = { ...item, content: newContent }
      setRound(updated)
      void refreshStudioItems()
      if (done) setStudioView({ mode: 'viewer', itemId }) // → report
    } catch (e) {
      const msg = (e as Error).message
      if (msg.includes('중단') || /abort/i.test(msg)) {
        setInput(text) // stopped → keep their answer so they can resubmit
      } else {
        showToast(`채점 실패: ${msg}`)
        setInput(text) // let the user retry
      }
    } finally {
      streamIdRef.current = null
      setSending(false)
      setPendingAnswer('')
      setStreamText('')
    }
  }

  const stop = (): void => {
    if (streamIdRef.current) void window.api.ai.abort(streamIdRef.current)
  }

  // ----- render -----
  if (phase.k === 'gen') {
    return (
      <div className="dictly-anim-in flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <Loader2 size={26} className="animate-spin text-accent" />
        <p className="text-[13px] text-subtle">{phase.msg}</p>
      </div>
    )
  }
  if (phase.k === 'error') {
    return (
      <div className="dictly-anim-in flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-[13px] text-ink">{phase.msg}</p>
        <button onClick={backToHub} className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-[12px] hover:bg-black/5">
          스튜디오로 돌아가기
        </button>
      </div>
    )
  }
  if (!round) return <div />

  const total = round.questions.length
  const answered = round.answers.length
  const pct = total ? Math.round((answered / total) * 100) : 0
  const liveScore = weightedScore(round.answers, round.questions)
  const roundLabel = round.index === 0 ? '복습 세션' : `복습 ${round.index}회차`
  const curIndex = answered // first unanswered

  const QuestionPrompt = ({ idx }: { idx: number }): JSX.Element | null => {
    const q = round.questions[idx]
    if (!q) return null
    const stage = q.stage && (idx === 0 || round.questions[idx - 1].stage !== q.stage) ? q.stage : null
    return (
      <div className="flex flex-col items-start gap-1">
        {stage && <div className="ml-1 text-[11px] font-semibold uppercase tracking-wide text-accent">{stage}</div>}
        <div className="px-0.5 text-[14px]">
          <CitedMarkdown sources={sources}>{`**Q${idx + 1}.** ${q.question}`}</CitedMarkdown>
        </div>
      </div>
    )
  }

  // AI feedback renders inline (no bubble)
  const Feedback = ({ md, score }: { md: string; score: number }): JSX.Element => (
    <div className="px-0.5 text-[14px]">
      <div className="mb-1 inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">이번 답변 {score}점</div>
      <CitedMarkdown sources={sources}>{md}</CitedMarkdown>
    </div>
  )

  const UserBubble = ({ text }: { text: string }): JSX.Element => (
    <div className="flex justify-end">
      <div className="max-w-[82%] whitespace-pre-wrap rounded-2xl bg-black/[0.06] px-3.5 py-2 text-[14px] text-ink">{text}</div>
    </div>
  )

  return (
    <div className="dictly-anim-in flex h-full min-h-0 flex-col">
      {/* progress + live score */}
      <div className="shrink-0 border-b border-black/5 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2 text-[11px] text-subtle">
              <span className="font-medium text-ink">{roundLabel}</span>
              <span>
                {answered}/{total}문항
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-black/10">
              <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[22px] font-bold leading-none text-accent tabular-nums">
              {liveScore}
              <span className="ml-0.5 text-[12px] font-medium text-subtle">점</span>
            </div>
            <div className="mt-0.5 text-[10px] text-subtle">실시간 점수</div>
          </div>
        </div>
      </div>

      {/* conversation */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {/* intro: full question list */}
        <div className="flex justify-start">
          <div className="max-w-[92%] rounded-2xl bg-white px-3.5 py-2.5 text-[14px] shadow-sm">
            <p className="mb-2 text-[13px] leading-relaxed text-subtle">
              파인만 학습법으로 복습해요. 아래 질문에 <b className="text-ink">본인 말로</b> 답하면 소스에 비춰 채점하고 보강할 점을 짚어 드려요. 한 문제씩 진행합니다.
            </p>
            <ol className="space-y-1.5">
              {round.questions.map((q, k) => {
                const stage = q.stage && (k === 0 || round.questions[k - 1].stage !== q.stage) ? q.stage : null
                return (
                  <li key={q.id}>
                    {stage && <div className="mb-1 mt-2 text-[11px] font-semibold uppercase tracking-wide text-accent">{stage}</div>}
                    <div className={`flex gap-1.5 ${k < answered ? 'opacity-50' : ''}`}>
                      <span className="shrink-0 text-[12px] font-semibold text-subtle">{k + 1}.</span>
                      <div className="min-w-0 flex-1 text-[13px]">
                        <CitedMarkdown sources={sources}>{q.question}</CitedMarkdown>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>
        </div>

        {/* answered turns */}
        {round.answers.map((a, k) => (
          <div key={k} className="space-y-3">
            <QuestionPrompt idx={k} />
            <UserBubble text={a.userAnswer} />
            <Feedback md={a.feedback} score={a.score} />
          </div>
        ))}

        {/* current turn */}
        {sending ? (
          <div className="space-y-3">
            <QuestionPrompt idx={curIndex} />
            <UserBubble text={pendingAnswer} />
            <div className="flex justify-start">
              <div className="max-w-[88%] rounded-2xl bg-white px-3.5 py-2 text-[14px] shadow-sm">
                {streamText ? <CitedMarkdown sources={sources}>{parseScoreTail(streamText).body}</CitedMarkdown> : <Dots />}
              </div>
            </div>
          </div>
        ) : (
          curIndex < total && <QuestionPrompt idx={curIndex} />
        )}
        <div ref={bottomRef} />
      </div>

      {/* answer input */}
      <div className="shrink-0 border-t border-black/5 p-3">
        <div className="mb-2 flex items-center gap-1.5">
          <span className="text-[12px] text-subtle">모델</span>
          <ModelMenu />
        </div>
        <div className="flex items-end gap-2">
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return // IME guard
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            rows={1}
            placeholder={`Q${curIndex + 1} 답변을 본인 말로 적어보세요…`}
            disabled={sending}
            className="flex-1 resize-none rounded-xl border border-black/10 bg-white px-3 py-2 text-[14px] outline-none focus:border-accent disabled:opacity-60"
          />
          {sending ? (
            <button onClick={stop} title="채점 중단" className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-white hover:bg-accent/90">
              <Square size={15} className="fill-current" />
            </button>
          ) : (
            <button
              onClick={() => void send()}
              disabled={!input.trim()}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-white hover:bg-accent/90 disabled:opacity-40"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
