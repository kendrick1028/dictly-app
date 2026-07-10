// The 채팅 tab's center view: a conversation LIST (left) + the open conversation (right).
// Selecting a conversation is LOCAL state here — it never selects a sidebar note/folder.
// Two backends are unified: Spotlight search sessions (chat_session_messages) and existing
// per-lecture chats (chat_messages). Both are grounded by a source MANIFEST and answered via
// studio.chatStream, so answers carry inline citation chips and the SAME composer + slash commands
// as the note chat. AI answers render inline (no bubble).
import { useEffect, useRef, useState } from 'react'
import { ArrowUp, AudioLines, Copy, MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, Quote, Sparkles, Square, Trash2, X } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { CitedMarkdown } from '../studio/cite/CitedMarkdown'
import { ModelMenu } from '../ModelSelect'
import { parseChatSources } from '../../lib/chatSources'
import { copyText } from '../../lib/clipboard'
import { buildSessionManifest, type ManifestResult } from '../../lib/studioManifest'
import { useAutoGrow } from '../../lib/useAutoGrow'
import { matchSlash, exactSlash, groupMatches, SLASH_COMMANDS, type SlashCommand } from '../../lib/slashCommands'
import type { ChatMessage, Memo } from '../../../../shared/types'

type Active = { kind: 'session'; id: number; title: string } | { kind: 'memo'; memoId: number; title: string }
type Src = { kind: 'note' | 'memo' | 'pdf'; id: number; title: string }
interface Msg {
  role: 'user' | 'assistant'
  content: string
}

/** a memo conversation grounds on the memo's transcript + its attached PDFs */
function memoSources(m: Memo): Src[] {
  return [{ kind: 'memo', id: m.id, title: m.title }, ...m.pdfs.map((p) => ({ kind: 'pdf' as const, id: p.id, title: p.name }))]
}

/** A sent user message: a leading slash command shows as plain colored text (no chip), rest normal. */
function UserBubbleText({ text }: { text: string }): JSX.Element {
  const m = text.match(/^(\/[^\s]+)(\s+([\s\S]*))?$/)
  const isCmd = m && SLASH_COMMANDS.some((c) => c.aliases.includes(m[1].toLowerCase()))
  if (!isCmd || !m) return <>{text}</>
  return (
    <>
      <span className="font-semibold text-blue-600">{m[1]}</span>
      {m[3] ? <span> {m[3]}</span> : null}
    </>
  )
}

function Dots(): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <span className="dictly-dot" style={{ animationDelay: '0s' }} />
      <span className="dictly-dot" style={{ animationDelay: '0.18s' }} />
      <span className="dictly-dot" style={{ animationDelay: '0.36s' }} />
    </span>
  )
}

export function ChatView(): JSX.Element {
  const sessions = useStore((s) => s.chatSessions)
  const memoChats = useStore((s) => s.memoChats)
  const refreshChatSessions = useStore((s) => s.refreshChatSessions)
  const requestConfirm = useStore((s) => s.requestConfirm)
  const agents = useStore((s) => s.agents)
  const activeAgentId = useStore((s) => s.activeAgentId)
  const claudeModel = useStore((s) => s.claudeModel)
  const aiReady = useStore((s) => s.aiReady)

  const [active, setActive] = useState<Active | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [manifest, setManifest] = useState<ManifestResult | null>(null)
  const [convMemo, setConvMemo] = useState<Memo | null>(null) // memo conv: for agent prompt + PDF attach
  const [input, setInput] = useState('')
  const [streamText, setStreamText] = useState('')
  const [sending, setSending] = useState(false)
  const [quoted, setQuoted] = useState<string | null>(null) // 인용: an answer excerpt to ask a follow-up on
  const [slashIdx, setSlashIdx] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)
  const [listCollapsed, setListCollapsed] = useState(() => localStorage.getItem('dictly.chatListCollapsed') === '1')
  const toggleList = (): void =>
    setListCollapsed((v) => {
      const n = !v
      localStorage.setItem('dictly.chatListCollapsed', n ? '1' : '0')
      return n
    })
  const streamIdRef = useRef<string | null>(null)
  const busyRef = useRef(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  useAutoGrow(taRef, input)

  // load the chosen conversation + build its grounding manifest (no sidebar/note side effects)
  useEffect(() => {
    let cancelled = false
    setManifest(null)
    setConvMemo(null)
    setQuoted(null)
    if (!active) {
      setMessages([])
      return
    }
    void (async () => {
      if (active.kind === 'session') {
        const s = await window.api.chatSessions.get(active.id)
        if (cancelled || !s) return
        setMessages(s.messages.map((m) => ({ role: m.role, content: m.content })))
        let srcs: Src[] = []
        try {
          srcs = JSON.parse(s.sourcesJson)
        } catch {
          srcs = []
        }
        const man = await buildSessionManifest(srcs)
        if (!cancelled) setManifest(man)
      } else {
        const memo = await window.api.memos.get(active.memoId)
        const list = await window.api.chat.list(active.memoId)
        if (cancelled) return
        setConvMemo(memo)
        setMessages(list.map((m) => ({ role: m.role, content: m.content })))
        const man = memo ? await buildSessionManifest(memoSources(memo)) : null
        if (!cancelled) setManifest(man)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [active])

  // auto-scroll to newest only when already near the bottom (so the user can scroll up to read)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, streamText])

  const sources = manifest?.sources ?? null
  const systemPrompt = convMemo ? (agents.find((a) => a.id === (convMemo.agentId ?? activeAgentId))?.systemPrompt ?? '') : ''

  // Send a free-text question (cmd undefined) OR run a slash command (specialized grounded instruction).
  const send = async (cmd?: SlashCommand, extraArg?: string): Promise<void> => {
    if (busyRef.current || !active || !manifest) return
    const conv = active
    let display: string
    let forAI: string
    let command: string | undefined
    if (cmd) {
      const extra = (extraArg ?? '').trim()
      const en = cmd.aliases[0]
      display = extra ? `${en} ${extra}` : en
      forAI = extra || cmd.label
      command = cmd.id
    } else {
      const text = input.trim()
      if (!text) return
      display = text
      forAI = quoted ? `이전 답변의 다음 부분을 인용합니다:\n"${quoted}"\n\n이에 대한 추가 질문: ${text}` : text
      command = undefined
    }
    busyRef.current = true
    setInput('')
    setQuoted(null)
    setSlashDismissed(false)
    const history: ChatMessage[] = messages.map((m) => ({ memoId: 0, role: m.role, content: m.content, createdAt: 0 }))
    setMessages((c) => [...c, { role: 'user', content: display }]) // optimistic; persisted only on success
    const sid = `${Date.now()}_${Math.floor(Math.random() * 1e9)}`
    streamIdRef.current = sid
    setSending(true)
    setStreamText('')
    try {
      const answer = await window.api.studio.chatStream(
        sid,
        manifest.text,
        history,
        forAI,
        manifest.sources.pdfs.length > 0,
        true, // both kinds use the [t:메모번호:초] manifest format
        systemPrompt,
        claudeModel,
        (full) => {
          if (streamIdRef.current === sid) setStreamText(full)
        },
        command
      )
      if (streamIdRef.current === sid) {
        // success → persist user + assistant together (never an orphaned user turn on abort)
        if (conv.kind === 'session') {
          await window.api.chatSessions.append(conv.id, 'user', display)
          await window.api.chatSessions.append(conv.id, 'assistant', answer)
        } else {
          await window.api.chat.add(conv.memoId, 'user', display)
          await window.api.chat.add(conv.memoId, 'assistant', answer)
        }
        setMessages((c) => [...c, { role: 'assistant', content: answer }])
        void refreshChatSessions()
        // /일정·/할일 → extract items and confirm before registering to Home (success-only)
        if (command === 'schedule' || command === 'todo') {
          window.api.home
            .extractSchedule(manifest.text)
            .then((items) => {
              if (items.length) useStore.getState().requestScheduleConfirm(items, conv.kind === 'memo' ? conv.memoId : null, conv.kind === 'memo' ? (convMemo?.folderId ?? null) : null)
            })
            .catch(() => {})
        }
      } else {
        setMessages((c) => c.slice(0, -1)) // superseded → drop the unpersisted user bubble
      }
    } catch (e) {
      const msg = (e as Error).message || ''
      const aborted = /abort/i.test(msg) || msg.includes('중단')
      if (streamIdRef.current === sid && !aborted) setMessages((c) => [...c, { role: 'assistant', content: `오류: ${msg}` }])
      else setMessages((c) => c.slice(0, -1)) // aborted → drop the unpersisted user bubble
    } finally {
      if (streamIdRef.current === sid) streamIdRef.current = null
      busyRef.current = false
      setSending(false)
      setStreamText('')
    }
  }
  const stop = (): void => {
    if (streamIdRef.current) {
      void window.api.ai.abort(streamIdRef.current)
      streamIdRef.current = null
    }
  }
  const delSession = (id: number, title: string): void => {
    requestConfirm(`'${title}' 대화를 삭제할까요?`, async () => {
      await window.api.chatSessions.delete(id)
      if (active?.kind === 'session' && active.id === id) setActive(null)
      await refreshChatSessions()
    })
  }
  // 인용: an abbreviated front excerpt of an answer (cite tokens + markdown stripped)
  const quoteAnswer = (content: string): void => {
    const clean = parseChatSources(content)
      .body.replace(/\[[tp]:[^\]]*\]/g, '')
      .replace(/[#*`>_~-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    setQuoted(clean.length > 240 ? clean.slice(0, 240).trim() + '…' : clean)
    taRef.current?.focus()
  }
  // attach a PDF to a memo conversation (rebuilds the manifest)
  const attachPdf = async (): Promise<void> => {
    if (!convMemo) return
    const res = await window.api.pdfs.addToMemo(convMemo.id)
    if (!res.length) return
    const fresh = await window.api.memos.get(convMemo.id)
    setConvMemo(fresh)
    if (fresh) setManifest(await buildSessionManifest(memoSources(fresh)))
    useStore.getState().showToast(res.length === 1 ? `'${res[0].name}' 첨부됨` : `PDF ${res.length}개 첨부됨`)
  }

  const slash = matchSlash(input)
  const showPalette = !!slash && slash.matches.length > 0 && !sending && !slashDismissed
  const pickCommand = (cmd: SlashCommand): void => {
    const extra = (slash?.extra ?? '').trim()
    setInput(`${cmd.aliases[0]} ${extra}`.trimEnd() + ' ')
    setSlashDismissed(true)
    taRef.current?.focus()
  }
  const sendFromInput = (): void => {
    const ex = exactSlash(input)
    if (ex) void send(ex.cmd, ex.extra)
    else void send()
  }
  const inputIsCmd = input.startsWith('/') && (!!exactSlash(input) || (!!slash && slash.matches.length > 0))
  const empty = sessions.length === 0 && memoChats.length === 0

  return (
    <div className="flex h-full min-h-0">
      {/* conversation list — collapsible animated panel (width slides, content fades) */}
      <div className={`relative h-full shrink-0 overflow-hidden border-r border-black/5 transition-[width] duration-200 ease-in-out ${listCollapsed ? 'w-9' : 'w-60'}`}>
        <button
          onClick={toggleList}
          title="채팅 목록 펼치기"
          className={`absolute left-1 top-2 z-10 rounded-lg p-1.5 text-subtle transition-opacity duration-150 hover:bg-black/5 ${listCollapsed ? 'opacity-100 delay-150' : 'pointer-events-none opacity-0'}`}
        >
          <PanelLeftOpen size={16} />
        </button>
        <div className={`flex h-full w-60 flex-col transition-opacity duration-150 ${listCollapsed ? 'pointer-events-none opacity-0' : 'opacity-100 delay-75'}`}>
          <div className="flex items-center gap-2 px-3 py-2.5 text-[13px] font-semibold text-ink">
            <MessageSquare size={15} className="text-accent" />
            <span className="flex-1">채팅</span>
            <button onClick={toggleList} title="채팅 목록 접기" className="rounded-md p-1 text-subtle hover:bg-black/5">
              <PanelLeftClose size={15} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {empty && (
            <div className="px-2 py-3 text-[12px] leading-relaxed text-subtle">
              대화가 없어요.
              <br />
              검색창(⌘⇧F)에서 AI에게 물어보면 여기에 저장돼요.
            </div>
          )}
          {sessions.length > 0 && <div className="px-1.5 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-subtle/60">검색 대화</div>}
          {sessions.map((s) => (
            <div
              key={`s${s.id}`}
              className={`group/row flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] ${
                active?.kind === 'session' && active.id === s.id ? 'bg-black/[0.06] font-medium' : 'hover:bg-black/[0.04]'
              }`}
            >
              <button onClick={() => setActive({ kind: 'session', id: s.id, title: s.title || '대화' })} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                <Sparkles size={12} className="shrink-0 text-subtle/70" />
                <span className="truncate">{s.title || '대화'}</span>
              </button>
              <button
                onClick={() => delSession(s.id, s.title || '대화')}
                className="hidden shrink-0 rounded p-0.5 text-subtle hover:bg-black/10 hover:text-red-500 group-hover/row:block"
                title="대화 삭제"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          {memoChats.length > 0 && <div className="px-1.5 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-subtle/60">강의 채팅</div>}
          {memoChats.map((c) => (
            <button
              key={`m${c.memoId}`}
              onClick={() => setActive({ kind: 'memo', memoId: c.memoId, title: c.title || '강의' })}
              className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[13px] ${
                active?.kind === 'memo' && active.memoId === c.memoId ? 'bg-black/[0.06] font-medium' : 'hover:bg-black/[0.04]'
              }`}
            >
              <AudioLines size={12} className="shrink-0 text-subtle/70" />
              <span className="truncate">{c.title || '강의'}</span>
            </button>
          ))}
          </div>
        </div>
      </div>

      {/* the open conversation */}
      {!active ? (
        <div className="flex flex-1 items-center justify-center text-[13px] text-subtle">왼쪽에서 대화를 선택하세요</div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-black/5 px-4 py-2.5">
            {active.kind === 'session' ? <Sparkles size={14} className="text-accent" /> : <AudioLines size={14} className="text-accent" />}
            <span className="flex-1 truncate text-[14px] font-semibold text-ink">{active.title}</span>
          </div>
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="mx-auto max-w-[760px] space-y-4">
              {messages.length === 0 && (
                <div className="mt-12 text-center text-subtle">
                  <p className="text-[13px]">이 대화의 소스에서만 답해요 · 답변 속 인용 칩을 누르면 해당 위치로 이동해요</p>
                  <p className="mt-2 text-[12px]">
                    <span className="rounded-md bg-black/5 px-1.5 py-0.5 font-mono text-[11px] text-ink">/</span> 를 입력하면 요약·공식·일정 등 명령을 쓸 수 있어요
                  </p>
                </div>
              )}
              {messages.map((m, i) =>
                m.role === 'user' ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-accent/10 px-3.5 py-2 text-[14px] text-ink">
                      <UserBubbleText text={m.content} />
                    </div>
                  </div>
                ) : (
                  // AI answers render inline (no bubble), with citation chips
                  <div key={i} className="group px-0.5 text-[14px]">
                    <CitedMarkdown sources={sources}>{parseChatSources(m.content).body}</CitedMarkdown>
                    <div className="mt-1 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                      <button onClick={() => void copyText(parseChatSources(m.content).body)} title="복사" className="rounded-md p-1 text-subtle hover:bg-black/5 hover:text-ink">
                        <Copy size={13} />
                      </button>
                      <button onClick={() => quoteAnswer(m.content)} title="이 답변을 인용해 추가 질문" className="rounded-md p-1 text-subtle hover:bg-black/5 hover:text-ink">
                        <Quote size={13} />
                      </button>
                    </div>
                  </div>
                )
              )}
              {sending && <div className="px-0.5 text-[14px]">{streamText ? <CitedMarkdown sources={sources}>{parseChatSources(streamText).body}</CitedMarkdown> : <Dots />}</div>}
              <div ref={bottomRef} />
            </div>
          </div>

          <div className="relative shrink-0 p-3">
            {!aiReady && <div className="mb-2 text-[12px] text-red-500">AI 미연결 — 상단 “연결”에서 설정하세요</div>}

            {/* slash-command palette — grouped by purpose */}
            {showPalette && slash && (
              <div className="absolute inset-x-3 bottom-full mb-1 max-h-72 overflow-y-auto rounded-xl border border-black/10 bg-white py-1 shadow-lg">
                {groupMatches(slash.matches).map((grp) => (
                  <div key={grp.group}>
                    <div className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-subtle/60">{grp.group}</div>
                    {grp.items.map((c) => {
                      const i = slash.matches.indexOf(c)
                      return (
                        <button
                          key={c.id}
                          onMouseEnter={() => setSlashIdx(i)}
                          onClick={() => pickCommand(c)}
                          className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${i === Math.min(slashIdx, slash.matches.length - 1) ? 'bg-accent/10' : 'hover:bg-black/5'}`}
                        >
                          <span className="shrink-0 font-mono text-[11px] text-blue-600">{c.aliases[0]}</span>
                          <span className="shrink-0 text-[13px] font-medium text-ink">{c.label}</span>
                          <span className="min-w-0 flex-1 truncate text-[11.5px] text-subtle">{c.hint}</span>
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}

            {quoted && (
              <div className="mb-2 flex items-start gap-2 rounded-lg border-l-2 border-accent bg-black/[0.03] px-2.5 py-1.5">
                <Quote size={12} className="mt-0.5 shrink-0 text-accent" />
                <span className="min-w-0 flex-1 truncate text-[12px] text-subtle">인용: {quoted}</span>
                <button onClick={() => setQuoted(null)} className="shrink-0 text-subtle hover:text-ink" title="인용 취소">
                  <X size={13} />
                </button>
              </div>
            )}

            <div className="mx-auto max-w-[760px] rounded-2xl border border-black/10 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition focus-within:border-accent/40 focus-within:shadow-[0_2px_10px_rgba(0,0,0,0.08)]">
              <textarea
                ref={taRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  setSlashIdx(0)
                  setSlashDismissed(false)
                }}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return // IME guard
                  if (showPalette && slash) {
                    const n = slash.matches.length
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      setSlashIdx((i) => Math.min(i + 1, n - 1))
                      return
                    }
                    if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      setSlashIdx((i) => Math.max(i - 1, 0))
                      return
                    }
                    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                      e.preventDefault()
                      pickCommand(slash.matches[Math.min(slashIdx, n - 1)])
                      return
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      setSlashDismissed(true)
                      return
                    }
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendFromInput()
                  }
                }}
                rows={1}
                placeholder="이 대화의 소스에 대해 질문하기…  ·  '/' 로 명령"
                className={`block max-h-40 w-full resize-none overflow-y-auto bg-transparent px-3.5 pt-3 pb-1.5 text-[14px] outline-none placeholder:text-subtle/50 ${inputIsCmd ? 'font-mono font-medium text-blue-600' : 'text-ink'}`}
              />
              <div className="flex items-center gap-1 px-1.5 pb-1.5 pt-0.5">
                {active.kind === 'memo' && (
                  <button
                    onClick={() => void attachPdf()}
                    disabled={!convMemo}
                    title="PDF 첨부"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-subtle transition hover:bg-black/5 hover:text-ink active:scale-95 disabled:opacity-40"
                  >
                    <Plus size={18} />
                  </button>
                )}
                <ModelMenu />
                {!manifest && <span className="ml-0.5 text-[11px] text-subtle">소스 준비 중…</span>}
                <div className="flex-1" />
                {sending ? (
                  <button onClick={stop} title="생성 중단" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent text-white transition hover:bg-accent/90 active:scale-95">
                    <Square size={14} className="fill-current" />
                  </button>
                ) : (
                  <button
                    onClick={sendFromInput}
                    disabled={!input.trim() || !manifest}
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
      )}
    </div>
  )
}
