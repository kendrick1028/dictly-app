// Live AI 튜터 session — 1:1 conversational tutoring over the note/folder sources.
// Top bar = 진도(roadmap progress) + 이해도(overall understanding) + 난이도 stepper; a roadmap
// chip row shows per-concept status/score. Every AI turn ends with a hidden [[STATE:{...}]]
// block that drives the dashboard. Turns persist incrementally to the studio item, so leaving
// & reopening resumes mid-lesson. Finishing (오답노트) routes to the report viewer.
import { useEffect, useRef, useState } from 'react'
import { ArrowUp, HelpCircle, Loader2, Square } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { CitedMarkdown } from './cite/CitedMarkdown'
import { ModelMenu } from '../ModelSelect'
import { prepareStudioContext, resolveStudioTarget, targetFromItem, type StudioContext } from '../../lib/studioJobs'
import { applyState, makeInitialTutorContent, overallUnderstanding, parseStateTail, splitTutorQuestion } from '../../lib/tutor'
import { useAutoGrow } from '../../lib/useAutoGrow'
import type { StudioItem, StudioSourceMap, TutorContent, TutorDifficulty } from '../../../../shared/types'

function Dots(): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <span className="dictly-dot" style={{ animationDelay: '0s' }} />
      <span className="dictly-dot" style={{ animationDelay: '0.18s' }} />
      <span className="dictly-dot" style={{ animationDelay: '0.36s' }} />
    </span>
  )
}

function scoreTone(score: number): string {
  if (score >= 85) return 'text-emerald-600'
  if (score >= 60) return 'text-accent'
  return 'text-amber-600'
}

/** single difficulty tag shown on the current 확인 질문 (replaces the old 4-step stepper) */
function DifficultyTag({ d }: { d: TutorDifficulty }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10.5px] font-medium text-accent">
      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      난이도 {d}
    </span>
  )
}

/** first auto-message that kicks off the lesson (also used on resume when no turns exist yet) */
const KICKOFF = '수업을 시작해 주세요.'
/** wrap-up quick action → the prompt's 마무리 branch (오답노트 + done:true) */
const WRAPUP = '여기까지 할게요. 오늘 배운 내용을 마무리해 주세요.'

type Phase = { k: 'load'; msg: string } | { k: 'ready' } | { k: 'error'; msg: string }

export function TutorSession({ itemId }: { itemId: number }): JSX.Element {
  const setStudioView = useStore((s) => s.setStudioView)
  const showToast = useStore((s) => s.showToast)
  const refreshStudioItems = useStore((s) => s.refreshStudioItems)

  const [phase, setPhase] = useState<Phase>({ k: 'load', msg: '수업을 준비하고 있어요…' })
  const [content, setContent] = useState<TutorContent | null>(null)
  const [sources, setSources] = useState<StudioSourceMap | null>(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [pendingUser, setPendingUser] = useState<string | null>(null) // user text shown while streaming
  const [streamText, setStreamText] = useState('')

  const ctxRef = useRef<StudioContext | null>(null)
  const itemRef = useRef<StudioItem | null>(null)
  const contentRef = useRef<TutorContent | null>(null)
  const runIdRef = useRef(0)
  const streamIdRef = useRef<string | null>(null)
  const kickoffRef = useRef(false) // guard: fire the auto first turn only once per mount
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const pinnedRef = useRef(true) // auto-follow the bottom unless the user scrolled up
  useAutoGrow(taRef, input)

  const backToHub = (): void => setStudioView({ mode: 'hub' })

  const setBoth = (c: TutorContent): void => {
    contentRef.current = c
    setContent(c)
  }

  // ----- one tutoring turn: send userText (hidden = auto kickoff/system-ish messages) -----
  const runTurn = async (userText: string, opts?: { hideUser?: boolean }): Promise<void> => {
    const ctx = ctxRef.current
    const item = itemRef.current
    const cur = contentRef.current
    if (!ctx || !item || !cur || cur.status === 'done') return
    setSending(true)
    setPendingUser(opts?.hideUser ? null : userText)
    setStreamText('')
    const sid = `${Date.now()}_${Math.floor(Math.random() * 1e9)}`
    streamIdRef.current = sid
    const model = useStore.getState().claudeModel
    // state snapshot the model updates from (roadmap/difficulty/stats/wrongNotes only)
    const stateJson = cur.roadmap.length
      ? JSON.stringify({ roadmap: cur.roadmap, difficulty: cur.difficulty, stats: cur.stats, wrongNotes: cur.wrongNotes, done: false })
      : ''
    try {
      const raw = await window.api.studio.tutorStream(
        sid,
        ctx.manifest.text,
        cur.turns.map((t) => ({ role: t.role, content: t.content })),
        userText,
        stateJson,
        cur.mode,
        cur.subject,
        ctx.hasPdfs,
        ctx.multiMemo,
        ctx.agentSystemPrompt,
        model,
        (full) => setStreamText(full)
      )
      const { body, state } = parseStateTail(raw)
      const now = Date.now()
      const withTurns: TutorContent = {
        ...cur,
        turns: [
          ...cur.turns,
          // the auto kickoff/wrapup is stored too — the model needs it in history for coherence
          { role: 'user' as const, content: userText, createdAt: now },
          { role: 'assistant' as const, content: body, createdAt: now }
        ]
      }
      const next = applyState(withTurns, state)
      await window.api.studio.update(item.id, { content: next })
      itemRef.current = { ...item, content: next }
      setBoth(next)
      void refreshStudioItems()
      if (next.status === 'done') setStudioView({ mode: 'viewer', itemId: item.id }) // → 오답노트 report
    } catch (e) {
      const msg = (e as Error).message
      if (msg.includes('중단') || /abort/i.test(msg)) {
        if (!opts?.hideUser) setInput(userText) // stopped → restore so they can resend
      } else {
        showToast(`튜터 응답 실패: ${msg}`)
        if (!opts?.hideUser) setInput(userText)
      }
    } finally {
      streamIdRef.current = null
      setSending(false)
      setPendingUser(null)
      setStreamText('')
    }
  }

  // ----- init / resume -----
  useEffect(() => {
    const runId = ++runIdRef.current
    const alive = (): boolean => runId === runIdRef.current

    const init = async (): Promise<void> => {
      // brand-new session: create the item with the modal's options, then remount on the real id
      if (itemId === 0) {
        const target = resolveStudioTarget()
        if (!target) {
          backToHub()
          return
        }
        const pending = useStore.getState().tutorPendingOpts ?? { mode: 'learn' as const, subject: '' }
        setPhase({ k: 'load', msg: '수업을 준비하고 있어요…' })
        const ctx = await prepareStudioContext(target)
        if (!alive()) return
        if (!ctx) {
          backToHub()
          return
        }
        const created = await window.api.studio.add({
          memoId: target.kind === 'memo' ? target.memoId : 0,
          folderId: target.kind === 'folder' ? target.folderId : null,
          kind: 'tutor',
          title: `AI 튜터 · ${pending.subject.trim() || '수업'}`,
          options: { mode: pending.mode, subject: pending.subject },
          content: makeInitialTutorContent(pending.mode, pending.subject),
          sources: ctx.manifest.sources
        })
        if (!alive()) return
        useStore.setState({ tutorPendingOpts: null })
        await refreshStudioItems()
        setStudioView({ mode: 'tutor', itemId: created.id }) // key change → remount on the real id
        return
      }

      // existing item: resume (or fire the first turn if the lesson hasn't started yet)
      const it = useStore.getState().studioItems.find((x) => x.id === itemId)
      if (!it || it.kind !== 'tutor') {
        backToHub()
        return
      }
      itemRef.current = it
      setSources(it.sources)
      const c = it.content as TutorContent
      setBoth(c)

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
      setPhase({ k: 'ready' })

      // lesson not started yet → auto-fire the kickoff turn (roadmap + first concept)
      if (c.turns.length === 0 && c.status === 'active' && !kickoffRef.current) {
        kickoffRef.current = true
        void runTurn(KICKOFF, { hideUser: true })
      }
    }

    void init()
    return () => {
      runIdRef.current++
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId])

  // track whether the user is pinned to the bottom (so we only auto-follow when they haven't scrolled up)
  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }
  // new turns + streaming deltas auto-scroll to the bottom while pinned
  useEffect(() => {
    if (pinnedRef.current) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [content?.turns.length, sending, streamText])

  // on first open of a session with history, jump to the latest turn
  const initScrollRef = useRef(-1)
  useEffect(() => {
    if (phase.k !== 'ready' || !content) return
    if (initScrollRef.current === itemId) return
    initScrollRef.current = itemId
    pinnedRef.current = true
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }))
  }, [phase, content, itemId])

  const send = (text?: string): void => {
    const t = (text ?? input).trim()
    if (!t || sending) return
    setInput('')
    pinnedRef.current = true // sending a message always follows to the bottom
    void runTurn(t)
  }

  const stop = (): void => {
    if (streamIdRef.current) void window.api.ai.abort(streamIdRef.current)
  }

  // ----- render -----
  if (phase.k === 'load') {
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
  if (!content) return <div />

  const total = content.roadmap.length
  const done = content.roadmap.filter((r) => r.status === 'done').length
  const pct = total ? Math.round((done / total) * 100) : 0
  const understanding = overallUnderstanding(content.roadmap)
  const correctRate = content.stats.asked > 0 ? Math.round(((content.stats.correct + content.stats.partial * 0.5) / content.stats.asked) * 100) : null
  const streamBody = streamText ? parseStateTail(streamText).body : ''
  // index of the latest assistant turn — the current 확인 질문 (gets the difficulty tag)
  let lastAsstIdx = -1
  for (let i = content.turns.length - 1; i >= 0; i--) {
    if (content.turns[i].role === 'assistant') {
      lastAsstIdx = i
      break
    }
  }

  const UserBubble = ({ text }: { text: string }): JSX.Element => (
    <div className="flex justify-end">
      <div className="max-w-[82%] whitespace-pre-wrap rounded-2xl bg-black/[0.06] px-3.5 py-2 text-[14px] text-ink">{text}</div>
    </div>
  )

  // an assistant turn = explanation + a distinct 확인 질문 box (+ difficulty tag on the current one).
  // plain function (not a component) so streaming re-renders don't remount CitedMarkdown.
  const renderAssistant = (body: string, showTag: boolean): JSX.Element => {
    const { explanation, question } = splitTutorQuestion(body)
    return (
      <div className="space-y-2 px-0.5">
        {showTag && <DifficultyTag d={content.difficulty} />}
        {explanation && (
          <div className="text-[14px]">
            <CitedMarkdown sources={sources}>{explanation}</CitedMarkdown>
          </div>
        )}
        {question && (
          <div className="bg-accent/[0.05] px-3 py-2.5">
            <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-accent">
              <HelpCircle size={12} /> 확인 질문
            </div>
            <div className="text-[14px] font-medium text-ink [&_p]:!my-0">
              <CitedMarkdown sources={sources}>{question}</CitedMarkdown>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="dictly-anim-in flex h-full min-h-0 flex-col">
      {/* ── 진도 · 이해도 · 난이도 dashboard ── */}
      <div className="shrink-0 border-b border-black/5 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2 text-[11px] text-subtle">
              <span className="font-medium text-ink">{content.subject.trim() || 'AI 튜터'}</span>
              {content.mode === 'sprint' && (
                <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">스프린트</span>
              )}
              <span>{total > 0 ? `진도 ${done}/${total}` : '수업 준비 중'}</span>
              {correctRate != null && <span className="tabular-nums">· 정답률 {correctRate}%</span>}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-black/10">
              <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className="shrink-0 text-right">
            {understanding == null ? (
              <div className="text-[13px] font-semibold leading-none text-subtle/70">측정 전</div>
            ) : (
              <div className={`text-[22px] font-bold leading-none tabular-nums ${scoreTone(understanding)}`}>
                {understanding}
                <span className="ml-0.5 text-[12px] font-medium text-subtle">점</span>
              </div>
            )}
            <div className="mt-0.5 text-[10px] text-subtle">이해도</div>
          </div>
        </div>

        {/* roadmap chips */}
        {total > 0 && (
          <div className="dictly-no-scrollbar mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
            {content.roadmap.map((r, i) => (
              <span
                key={r.id}
                title={r.understanding != null ? `${r.label} — 이해도 ${r.understanding}점` : r.label}
                className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium transition ${
                  r.status === 'done'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : r.status === 'active'
                      ? 'border-accent/50 bg-accent/10 text-accent ring-1 ring-accent/30'
                      : 'border-black/10 bg-white text-subtle'
                }`}
              >
                {i + 1}. {r.label}
                {r.understanding != null && <b className="tabular-nums">{r.understanding}</b>}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── conversation ── */}
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {content.turns.length === 0 && !sending && (
          <div className="flex justify-start">
            <div className="max-w-[92%] rounded-2xl bg-white px-3.5 py-2.5 text-[13px] leading-relaxed text-subtle shadow-sm">
              1:1 과외 수업이에요. 선생님이 로드맵을 짜고 한 개념씩 설명한 뒤 확인 질문을 해요. 답을 하면 이해도가 기록되고, 틀린 개념은 오답노트로 정리돼요.
            </div>
          </div>
        )}

        {content.turns.map((t, k) =>
          t.role === 'user' ? (
            t.content === KICKOFF || t.content === WRAPUP ? null : <UserBubble key={k} text={t.content} />
          ) : (
            // the latest answer holds the current 확인 질문 → tag it with the difficulty
            <div key={k}>{renderAssistant(t.content, !sending && k === lastAsstIdx && content.status === 'active')}</div>
          )
        )}

        {/* current streaming turn */}
        {sending && (
          <div className="space-y-3">
            {pendingUser && <UserBubble text={pendingUser} />}
            {streamBody ? renderAssistant(streamBody, true) : <div className="px-0.5"><Dots /></div>}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── input (AI 채팅 모달과 동일한 구성) ── */}
      <div className="shrink-0 p-3">
        {/* floating action tabs above the input field */}
        {content.status === 'active' && (
          <div className="mb-2 flex items-center gap-1.5">
            <button
              onClick={() => send('모르겠어요')}
              disabled={sending || content.turns.length === 0}
              className="flex items-center gap-1 rounded-full border border-black/10 bg-white px-2.5 py-1 text-[11.5px] text-subtle shadow-sm transition hover:bg-black/[0.03] hover:text-ink disabled:opacity-40"
              title="솔직하게! 선생님이 가장 작은 단계부터 함께 풀어가요"
            >
              <HelpCircle size={12} /> 모르겠어요
            </button>
            <button
              onClick={() => send(WRAPUP)}
              disabled={sending || content.turns.length === 0}
              className="rounded-full border border-black/10 bg-white px-2.5 py-1 text-[11.5px] text-subtle shadow-sm transition hover:bg-black/[0.03] hover:text-ink disabled:opacity-40"
              title="오답노트로 정리하고 수업을 마쳐요"
            >
              여기까지 (마무리)
            </button>
          </div>
        )}
        <div className="rounded-2xl border border-black/10 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return // IME guard
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            rows={1}
            placeholder="선생님 질문에 답해보세요…"
            disabled={sending || content.status === 'done'}
            className="block max-h-40 w-full resize-none overflow-y-auto rounded-2xl bg-transparent px-3.5 pt-3 pb-1.5 text-[14px] text-ink outline-none focus:outline-none focus-visible:outline-none placeholder:text-subtle/50 disabled:opacity-60"
          />
          <div className="flex items-center gap-1 px-1.5 pb-1.5 pt-0.5">
            <ModelMenu />
            <div className="flex-1" />
            {sending ? (
              <button
                onClick={stop}
                title="응답 중단"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent text-white transition hover:bg-accent/90 active:scale-95"
              >
                <Square size={14} className="fill-current" />
              </button>
            ) : (
              <button
                onClick={() => send()}
                disabled={!input.trim() || content.status === 'done'}
                title="보내기"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent text-white transition hover:bg-accent/90 active:scale-95 disabled:opacity-30"
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
