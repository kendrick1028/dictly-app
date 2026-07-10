import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Sparkles, StickyNote, AudioLines, FileText, X, Square, CornerDownLeft } from 'lucide-react'
import { useStore } from '../store/useStore'
import { MarkdownMath } from './MarkdownMath'
import { SpiralLoader } from './SpiralLoader'
import { buildChatContent, CHAT_INSTRUCTION, CHAT_SYSTEM_PROMPT } from '../lib/chatContext'
import type { NoteSourceHit } from '../../../shared/types'

// app-wide Spotlight search: keyword search across notes/lectures/PDFs, with an AI-question fallback.
// '@' attaches a note/lecture/PDF as context for the AI question.

interface Chip {
  kind: 'note' | 'memo' | 'pdf'
  id: number
  title: string
  /** routing info to open the source (PDFs need their owning lecture or folder) */
  memoId?: number | null
  folderId?: number | null
  /** owning 과목(folder) name — injected into the AI context so subject-scoped questions resolve */
  folderName?: string | null
}
type Action = { type: 'open'; hit: NoteSourceHit } | { type: 'attach'; hit: NoteSourceHit } | { type: 'ai' }

const KIND_META: Record<'note' | 'memo' | 'pdf', { label: string; Icon: typeof StickyNote }> = {
  note: { label: '노트', Icon: StickyNote },
  memo: { label: '강의', Icon: AudioLines },
  pdf: { label: 'PDF', Icon: FileText }
}

interface ConvoMsg {
  role: 'user' | 'assistant'
  content: string
}

function hitId(h: NoteSourceHit): number | null {
  return h.kind === 'note' ? (h.noteId ?? null) : h.kind === 'memo' ? h.memoId : (h.pdfId ?? null)
}

export function Spotlight(): JSX.Element | null {
  const spotlightOpen = useStore((s) => s.spotlightOpen)
  const closeSpotlight = useStore((s) => s.closeSpotlight)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<NoteSourceHit[]>([])
  const [chips, setChips] = useState<Chip[]>([])
  const [sel, setSel] = useState(0)
  const [convo, setConvo] = useState<ConvoMsg[]>([]) // the multi-turn AI conversation (kept until Esc/close)
  const [streaming, setStreaming] = useState<string | null>(null) // assistant text currently streaming
  const [loading, setLoading] = useState(false)
  const [usedSources, setUsedSources] = useState<Chip[]>([]) // sources grounding the conversation
  const [render, setRender] = useState(false) // stays true through the exit animation after spotlightOpen flips false

  const streamIdRef = useRef<string | null>(null)
  const busyRef = useRef(false) // synchronous guard against double-firing askAI before setLoading renders
  const sessionIdRef = useRef<number | null>(null) // the spotlight chat session (created on first question)
  const sourcesRef = useRef<Chip[]>([]) // sources reused for follow-up turns
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const convoRef = useRef<HTMLDivElement>(null)
  const chatActive = convo.length > 0 || streaming != null

  // active '@' mention token at a word boundary → attach-source mode
  const atIdx = useMemo(() => {
    const i = query.lastIndexOf('@')
    return i >= 0 && (i === 0 || query[i - 1] === ' ') ? i : -1
  }, [query])
  const mentionActive = atIdx >= 0
  const mentionQuery = mentionActive ? query.slice(atIdx + 1) : ''
  const term = mentionActive ? mentionQuery.trim() : query.trim()
  const aiShown = !mentionActive && !!query.trim()

  // reset on open; abort any in-flight answer on close
  useEffect(() => {
    if (spotlightOpen) {
      setQuery('')
      setResults([])
      setChips([])
      setConvo([])
      setStreaming(null)
      setUsedSources([])
      setSel(0)
      setLoading(false)
      busyRef.current = false
      sessionIdRef.current = null
      sourcesRef.current = []
      const h = setTimeout(() => inputRef.current?.focus(), 30)
      return () => clearTimeout(h)
    }
    if (streamIdRef.current) {
      void window.api.ai.abort(streamIdRef.current)
      streamIdRef.current = null // stale deltas are ignored by the sid guard in askAI
    }
    busyRef.current = false
    setLoading(false)
    return undefined
  }, [spotlightOpen])

  // debounced search (mention mode searches even on empty query so the user can browse to attach)
  useEffect(() => {
    if (!spotlightOpen) return undefined
    if (!mentionActive && !term) {
      setResults([])
      return undefined
    }
    let cancelled = false
    const h = setTimeout(() => {
      void window.api.search.all(term).then((r) => {
        if (!cancelled) setResults(r)
      })
    }, 140)
    return () => {
      cancelled = true
      clearTimeout(h)
    }
  }, [term, mentionActive, spotlightOpen])

  const actions: Action[] = useMemo(() => {
    if (mentionActive) return results.map((hit) => ({ type: 'attach', hit }) as Action)
    const out: Action[] = results.map((hit) => ({ type: 'open', hit }))
    if (aiShown) out.push({ type: 'ai' })
    return out
  }, [results, mentionActive, aiShown])

  // default selection: highlight the AI row when keyword search is empty / query is long / a question
  useEffect(() => {
    if (mentionActive) {
      setSel(0)
      return
    }
    const q = query.trim()
    const aiPrimary = aiShown && (results.length === 0 || q.length >= 20 || /[?？]\s*$/.test(q))
    setSel(aiPrimary ? results.length : 0)
  }, [results, mentionActive, query, aiShown])

  // auto-scroll the conversation as it grows / streams
  useEffect(() => {
    if (chatActive) convoRef.current?.scrollTo({ top: convoRef.current.scrollHeight })
  }, [convo, streaming, chatActive])

  // keep the highlighted row in view
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  // mount immediately on open; keep mounted briefly on close so the exit animation can play
  useEffect(() => {
    if (spotlightOpen) {
      setRender(true)
      return undefined
    }
    if (!render) return undefined
    const t = setTimeout(() => setRender(false), 170)
    return () => clearTimeout(t)
  }, [spotlightOpen, render])

  if (!render) return null
  const closing = !spotlightOpen

  const stop = (): void => {
    if (streamIdRef.current) {
      void window.api.ai.abort(streamIdRef.current)
      streamIdRef.current = null // freeze the partial answer: ignore any further/late deltas
    }
  }

  const openHit = (hit: NoteSourceHit): void => {
    const st = useStore.getState()
    if (hit.kind === 'note' && hit.noteId != null) st.selectNote(hit.noteId)
    else if (hit.kind === 'memo' && hit.memoId != null) void st.openMemoAt(hit.memoId, {})
    else if (hit.kind === 'pdf' && hit.pdfId != null) {
      if (hit.memoId != null) void st.openMemoAt(hit.memoId, { pdfId: hit.pdfId, page: 1 })
      else if (hit.folderId != null)
        void st.openFolderView(hit.folderId).then(() => {
          const pdf = useStore.getState().folderPdfs.find((p) => p.id === hit.pdfId)
          if (pdf) useStore.getState().setFolderPreview({ kind: 'pdf', pdf, page: 1, nonce: Date.now() })
        })
    }
    closeSpotlight()
  }

  // open a referenced-source chip (shown under a finished AI answer)
  const openChip = (c: Chip): void => {
    const st = useStore.getState()
    if (c.kind === 'note') st.selectNote(c.id)
    else if (c.kind === 'memo') void st.openMemoAt(c.id, {})
    else if (c.memoId != null) void st.openMemoAt(c.memoId, { pdfId: c.id, page: 1 })
    else if (c.folderId != null)
      void st.openFolderView(c.folderId).then(() => {
        const pdf = useStore.getState().folderPdfs.find((p) => p.id === c.id)
        if (pdf) useStore.getState().setFolderPreview({ kind: 'pdf', pdf, page: 1, nonce: Date.now() })
      })
    closeSpotlight()
  }

  const attachHit = (hit: NoteSourceHit): void => {
    const id = hitId(hit)
    if (id == null) return
    setChips((cs) => (cs.some((c) => c.kind === hit.kind && c.id === id) ? cs : [...cs, { kind: hit.kind, id, title: hit.title, memoId: hit.memoId, folderId: hit.folderId ?? null, folderName: hit.folderName ?? null }]))
    setQuery((q) => q.slice(0, atIdx)) // strip the '@token'
    inputRef.current?.focus()
  }

  // No @ chips → auto-retrieve the most relevant notes/lectures/PDFs from the question's keywords.
  // A full sentence rarely matches as a substring, so we search per-token and rank sources, with a
  // strong bonus when a token appears in the source title/name.
  const gatherAutoContext = async (q: string): Promise<Chip[]> => {
    const tokens = Array.from(new Set(q.split(/[\s,.?!~()[\]{}"'·:;。、？！]+/).map((t) => t.trim()).filter((t) => t.length >= 2))).slice(0, 8)
    if (!tokens.length) return []
    const score = new Map<string, { hit: NoteSourceHit; pts: number }>()
    const lists = await Promise.all(tokens.map((t) => window.api.search.all(t).then((r) => ({ t, r })).catch(() => ({ t, r: [] as NoteSourceHit[] }))))
    for (const { t, r } of lists) {
      const tl = t.normalize('NFC').toLowerCase()
      for (const h of r) {
        const id = hitId(h)
        if (id == null) continue
        const key = `${h.kind}-${id}`
        const titleHit = h.title.normalize('NFC').toLowerCase().includes(tl)
        // a token that names the source's 과목(folder) is a strong signal it's relevant, even if the
        // transcript never says the folder name (fixes: "원가회계 강의…" not pulling that folder's notes)
        const folderHit = !!h.folderName && h.folderName.normalize('NFC').toLowerCase().includes(tl)
        const pts = t.length + (titleHit ? 10 : 0) + (folderHit ? 8 : 0) + (h.children.length ? 1 : 0)
        const e = score.get(key)
        if (e) e.pts += pts
        else score.set(key, { hit: h, pts })
      }
    }
    return [...score.values()]
      .sort((a, b) => b.pts - a.pts)
      .slice(0, 5)
      .map((e) => ({ kind: e.hit.kind, id: hitId(e.hit) as number, title: e.hit.title, memoId: e.hit.memoId, folderId: e.hit.folderId ?? null, folderName: e.hit.folderName ?? null }))
  }

  // ask the AI — multi-turn: the first question creates a persisted 'spotlight' chat session
  // (so it appears in the 채팅 tab and resumes later); follow-ups append to the same session.
  const askAI = async (): Promise<void> => {
    const q = query.trim()
    if (!q || busyRef.current) return // synchronous re-entry guard (setLoading is async)
    busyRef.current = true
    setQuery('')
    setLoading(true)
    const sid = `${Date.now()}_${Math.floor(Math.random() * 1e9)}`
    streamIdRef.current = sid
    setStreaming('')
    try {
      // first turn: resolve grounding sources (explicit @ chips, else auto-retrieved).
      // NOTHING is persisted yet — we only write to the DB once the answer completes, so an
      // aborted/closed turn never leaves an orphaned user message in the session.
      let sessionId = sessionIdRef.current
      if (sessionId == null && sourcesRef.current.length === 0) {
        const auto = chips.length ? [] : await gatherAutoContext(q)
        const sources = [...chips, ...auto].slice(0, 6)
        sourcesRef.current = sources
        setUsedSources(sources)
      }
      const history = convo.map((m) => ({ role: m.role, content: m.content }))
      setConvo((c) => [...c, { role: 'user', content: q }]) // optimistic; persisted only on success
      const content = await buildChatContent(q, sourcesRef.current, history)
      const answer = await window.api.ai.ask(sid, CHAT_INSTRUCTION, content, CHAT_SYSTEM_PROMPT, undefined, (full) => {
        if (streamIdRef.current === sid) setStreaming(full)
      })
      if (streamIdRef.current === sid) {
        // success → create the session on the first turn, then persist user + assistant together
        if (sessionId == null) {
          const sess = await window.api.chatSessions.create({
            kind: 'spotlight',
            sourcesJson: JSON.stringify(sourcesRef.current.map((c) => ({ kind: c.kind, id: c.id, title: c.title }))),
            title: q.slice(0, 40)
          })
          sessionId = sess.id
          sessionIdRef.current = sessionId
        }
        await window.api.chatSessions.append(sessionId, 'user', q)
        await window.api.chatSessions.append(sessionId, 'assistant', answer)
        setConvo((c) => [...c, { role: 'assistant', content: answer }])
        void useStore.getState().refreshChatSessions()
      } else {
        setConvo((c) => c.slice(0, -1)) // superseded/closed → drop the unpersisted user bubble
      }
    } catch (e) {
      const msg = (e as Error).message || ''
      const aborted = /abort/i.test(msg) || msg.includes('중단')
      if (streamIdRef.current === sid && !aborted) setConvo((c) => [...c, { role: 'assistant', content: `오류: ${msg}` }])
      else setConvo((c) => c.slice(0, -1)) // aborted → drop the unpersisted user bubble
    } finally {
      if (streamIdRef.current === sid) streamIdRef.current = null
      busyRef.current = false
      setLoading(false)
      setStreaming(null)
    }
  }

  const runAction = (a: Action | undefined): void => {
    if (!a) {
      if (aiShown) void askAI()
      return
    }
    if (a.type === 'open') openHit(a.hit)
    else if (a.type === 'attach') attachHit(a.hit)
    else void askAI()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Tab') {
      e.preventDefault() // keep focus inside the overlay (keyboard-driven via arrows)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (mentionActive) setQuery((q) => q.slice(0, atIdx))
      else closeSpotlight() // the conversation persists in the 채팅 tab
    } else if (chatActive) {
      // conversation mode: Enter (or ⌘↵) sends a follow-up; results/arrow-nav are hidden
      if (e.key === 'Enter') {
        if (e.nativeEvent.isComposing) return
        e.preventDefault()
        void askAI()
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(actions.length - 1, s + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(0, s - 1))
    } else if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return
      e.preventDefault()
      if (e.metaKey || e.ctrlKey) void askAI()
      else runAction(actions[sel])
    }
  }

  // render rows with kind-group headers; each selectable row maps to its index in `actions`
  let prevKind: string | null = null

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-start justify-center dictly-glass-backdrop ${closing ? 'dictly-backdrop-out pointer-events-none' : 'dictly-backdrop-in'}`}
      style={{ paddingTop: '13vh' }}
      onMouseDown={closeSpotlight}
    >
      <div
        className={`dictly-glass w-[640px] max-w-[92vw] overflow-hidden rounded-[28px] ${closing ? 'dictly-spotlight-out' : 'dictly-spotlight-in'}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* input — magnifier becomes a spinner + the field locks while the AI answers */}
        <div className="flex items-center gap-3 px-5 py-4">
          {loading ? <SpiralLoader size={26} /> : <Search size={18} className="shrink-0 text-subtle" />}
          <input
            ref={inputRef}
            value={query}
            readOnly={loading}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="무엇이든 물어보세요"
            className={`flex-1 bg-transparent text-[17px] text-ink placeholder:text-subtle/70 outline-none ${loading ? 'cursor-default opacity-70' : ''}`}
          />
          {loading ? (
            <button onClick={stop} className="shrink-0 rounded-full p-1.5 text-subtle hover:bg-black/10" title="생성 중단">
              <Square size={15} className="fill-current" />
            </button>
          ) : (
            <button onClick={closeSpotlight} className="shrink-0 rounded-full p-1.5 text-subtle hover:bg-black/10" title="닫기 (Esc)">
              <X size={16} />
            </button>
          )}
        </div>

        {/* attached source chips */}
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-5 pb-2.5">
            {chips.map((c) => {
              const { Icon } = KIND_META[c.kind]
              return (
                <span key={`${c.kind}-${c.id}`} className="dictly-glass-chip flex max-w-[220px] items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] text-ink">
                  <Icon size={13} className="shrink-0 text-accent" />
                  <span className="truncate">{c.title}</span>
                  <button onClick={() => setChips((cs) => cs.filter((x) => !(x.kind === c.kind && x.id === c.id)))} className="shrink-0 rounded-full p-0.5 hover:bg-black/10">
                    <X size={11} />
                  </button>
                </span>
              )
            })}
          </div>
        )}

        {/* results / mention picker (hidden during a conversation, or when there's nothing yet) */}
        {!chatActive && (actions.length > 0 || mentionActive) && (
          <div ref={listRef} className="max-h-[42vh] overflow-y-auto border-t border-white/40 px-2 py-2">
            {mentionActive && <div className="px-3 pb-1 pt-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-subtle/70">자료 인용 — 선택해서 첨부</div>}
            {actions.map((a, i) => {
              if (a.type === 'ai') {
                return (
                  <button
                    key="ai"
                    data-idx={i}
                    onMouseEnter={() => setSel(i)}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      void askAI()
                    }}
                    className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left ${i === sel ? 'bg-accent/15' : 'hover:bg-black/5'}`}
                  >
                    <Sparkles size={17} className="shrink-0 text-accent" />
                    <span className="min-w-0 flex-1 truncate text-[15px] text-ink">
                      AI에게 질문: <span className="text-subtle">{query.trim()}</span>
                    </span>
                    <CornerDownLeft size={14} className="shrink-0 text-subtle/60" />
                  </button>
                )
              }
              const hit = a.hit
              const meta = KIND_META[hit.kind]
              const showHeader = hit.kind !== prevKind
              prevKind = hit.kind
              const preview = hit.children[0]?.text
              return (
                <div key={`${hit.kind}-${hitId(hit)}-${i}`}>
                  {showHeader && <div className="px-3 pb-0.5 pt-2 text-[11.5px] font-semibold uppercase tracking-wide text-subtle/60">{meta.label}</div>}
                  <button
                    data-idx={i}
                    onMouseEnter={() => setSel(i)}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      runAction(a)
                    }}
                    className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left ${i === sel ? 'bg-accent/15' : 'hover:bg-black/5'}`}
                  >
                    <meta.Icon size={17} className="shrink-0 text-subtle" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium text-ink">{hit.title}</span>
                      {preview && <span className="block truncate text-[13px] text-subtle">{preview}</span>}
                    </span>
                  </button>
                </div>
              )
            })}
            {mentionActive && actions.length === 0 && <div className="px-4 py-5 text-center text-[12.5px] text-subtle">일치하는 자료가 없어요</div>}
          </div>
        )}

        {/* AI conversation — multi-turn; persists in the 채팅 tab. Type to ask a follow-up. */}
        {chatActive && (
          <div ref={convoRef} className="max-h-[46vh] space-y-3 overflow-y-auto border-t border-white/40 px-5 py-3.5">
            {/* referenced sources used to ground the conversation; click to open */}
            {usedSources.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-subtle/70">참고</span>
                {usedSources.map((c) => {
                  const { Icon } = KIND_META[c.kind]
                  return (
                    <button
                      key={`${c.kind}-${c.id}`}
                      onClick={() => openChip(c)}
                      title={c.title}
                      className="dictly-glass-chip flex max-w-[200px] items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] text-ink transition hover:bg-accent/10"
                    >
                      <Icon size={12} className="shrink-0 text-accent" />
                      <span className="truncate">{c.title}</span>
                    </button>
                  )
                })}
              </div>
            )}
            {convo.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-accent/10 px-3.5 py-2 text-[14px] text-ink">{m.content}</div>
                </div>
              ) : (
                <MarkdownMath key={i} className="!text-[15px]">
                  {m.content}
                </MarkdownMath>
              )
            )}
            {streaming != null && <MarkdownMath className="!text-[15px]">{streaming || '…'}</MarkdownMath>}
          </div>
        )}
      </div>
    </div>
  )
}
