// Grounded studio chat. Memo scope: answers from one note's transcript+PDFs, history persisted in
// chat_messages. Folder scope: answers from the 소스 pane's checked memos+PDFs (ephemeral history).
// Either way the answer carries inline [t:..]/[p:..] citation chips.
import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Copy, ImageOff, Loader2, Plus, Quote, RefreshCw, ScanText, Square, X } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { CitedMarkdown } from './cite/CitedMarkdown'
import { parseChatSources } from '../../lib/chatSources'
import { copyText } from '../../lib/clipboard'
import { buildStudioManifest, buildFolderManifest, type ManifestResult } from '../../lib/studioManifest'
import { ocrIndexPdf } from '../../lib/pdfText'
import { useAutoGrow } from '../../lib/useAutoGrow'
import { matchSlash, exactSlash, groupMatches, SLASH_COMMANDS, type SlashCommand } from '../../lib/slashCommands'
import { ModelMenu } from '../ModelSelect'
import type { ChatMessage, Memo } from '../../../../shared/types'

/** Render a sent user message: a leading slash command is shown as plain text in a distinct color
 *  (no chip/tag), the rest in normal color. */
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

export function StudioChat(): JSX.Element {
  const studioScope = useStore((s) => s.studioScope)
  const memo = useStore((s) => s.memo)
  const agents = useStore((s) => s.agents)
  const activeAgentId = useStore((s) => s.activeAgentId)
  const aiReady = useStore((s) => s.aiReady)
  const chat = useStore((s) => s.chat)
  const claudeModel = useStore((s) => s.claudeModel)
  const folderPdfs = useStore((s) => s.folderPdfs)
  const folderNotes = useStore((s) => s.folderNotes)
  const srcMemoIds = useStore((s) => s.folderSrcMemoIds)
  const srcPdfIds = useStore((s) => s.folderSrcPdfIds)
  const srcNoteIds = useStore((s) => s.folderSrcNoteIds)

  const folder = studioScope === 'folder'
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [manifest, setManifest] = useState<ManifestResult | null>(null)
  const [indexing, setIndexing] = useState<string | null>(null)
  const [localMsgs, setLocalMsgs] = useState<ChatMessage[]>([]) // folder scope (ephemeral)
  const [slashIdx, setSlashIdx] = useState(0) // highlighted command in the palette
  const [slashDismissed, setSlashDismissed] = useState(false) // Esc hides palette until next keystroke
  const [quoted, setQuoted] = useState<string | null>(null) // 인용: abbreviated excerpt of an answer to ask a follow-up on
  const [srcTick, setSrcTick] = useState(0) // bump to force a manifest rebuild after attaching a PDF
  const manifestKeyRef = useRef<string>('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  useAutoGrow(taRef, input)

  const agent = agents.find((a) => a.id === (memo?.agentId ?? activeAgentId))
  const msgs = folder ? localMsgs : chat

  // (re)build the source manifest: memo → one note; folder → checked sources
  useEffect(() => {
    const key = (folder ? `f:${srcMemoIds.join(',')}|${srcPdfIds.join(',')}|${srcNoteIds.join(',')}` : `m:${memo?.id ?? ''}`) + `:${srcTick}`
    if (manifestKeyRef.current === key && manifest) return
    manifestKeyRef.current = key
    setManifest(null)
    let cancelled = false
    const build = async (): Promise<ManifestResult | null> => {
      if (folder) {
        if (srcMemoIds.length === 0 && srcPdfIds.length === 0 && srcNoteIds.length === 0) return null
        const memos = (await Promise.all(srcMemoIds.map((id) => window.api.memos.get(id)))).filter((m): m is Memo => !!m)
        const pdfs = folderPdfs.filter((p) => srcPdfIds.includes(p.id))
        const notes = folderNotes.filter((n) => srcNoteIds.includes(n.id)).map((n) => ({ id: n.id, title: n.title }))
        return buildFolderManifest(memos, pdfs, notes)
      }
      return memo ? buildStudioManifest(memo) : null
    }
    void build().then((m) => {
      if (!cancelled && manifestKeyRef.current === key) setManifest(m)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, memo?.id, srcMemoIds, srcPdfIds, srcNoteIds, srcTick])

  // auto-scroll to the newest content ONLY when the user is already near the bottom — so they can
  // freely scroll up to read while a response is still streaming.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [msgs.length, streamText])

  // on first entering a conversation that already has messages, jump to the latest one
  const initScrollRef = useRef('')
  useEffect(() => {
    if (msgs.length === 0) return
    const key = folder ? `f:${srcMemoIds.join(',')}` : `m:${memo?.id ?? ''}`
    if (initScrollRef.current === key) return
    initScrollRef.current = key
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }))
  }, [msgs.length, folder, memo?.id, srcMemoIds])

  if (!folder && !memo) return <div />

  const runOcr = async (pdfId: number): Promise<void> => {
    const pdf = (folder ? folderPdfs : memo?.pdfs ?? []).find((p) => p.id === pdfId)
    if (!pdf) return
    setIndexing(pdf.name)
    try {
      await ocrIndexPdf(pdf, agent?.systemPrompt ?? '')
      manifestKeyRef.current = '' // force rebuild
      setManifest(null)
    } catch (e) {
      useStore.getState().showToast(`인덱싱 실패: ${(e as Error).message}`)
    } finally {
      setIndexing(null)
    }
  }

  // stream one grounded answer for a prepared instruction + history (shared by send & regenerate)
  const streamIdRef = useRef<string | null>(null)
  const streamAnswer = (forAI: string, command: string | undefined, history: ChatMessage[]): Promise<string> => {
    const sid = `${Date.now()}_${Math.floor(Math.random() * 1e9)}`
    streamIdRef.current = sid
    return window.api.studio
      .chatStream(
        sid,
        manifest!.text,
        history,
        forAI,
        manifest!.sources.pdfs.length > 0,
        (manifest!.sources.memos?.length ?? 0) > 1,
        agent?.systemPrompt ?? '',
        claudeModel,
        (full) => setStreamText(full),
        command
      )
      .finally(() => {
        if (streamIdRef.current === sid) streamIdRef.current = null
      })
  }
  const stop = (): void => {
    if (streamIdRef.current) void window.api.ai.abort(streamIdRef.current)
  }

  // Send a free-text question (cmd undefined) OR run a slash command (specialized grounded instruction).
  const send = async (cmd?: SlashCommand, extraArg?: string): Promise<void> => {
    let display: string
    let forAI: string
    let command: string | undefined
    if (cmd) {
      const extra = (extraArg ?? '').trim()
      const en = cmd.aliases[0] // english command, e.g. "/summary"
      display = extra ? `${en} ${extra}` : en
      forAI = extra || cmd.label
      command = cmd.id
    } else {
      const text = input.trim()
      if (!text) return
      display = text
      // a quoted excerpt (인용) is passed to the AI as context but kept out of the visible bubble
      forAI = quoted ? `이전 답변의 다음 부분을 인용합니다:\n"${quoted}"\n\n이에 대한 추가 질문: ${text}` : text
      command = undefined
    }
    if (sending || !manifest) return
    setInput('')
    setQuoted(null)
    setSlashDismissed(false)
    setSending(true)
    setStreamText('')
    try {
      if (folder) {
        const history = [...localMsgs]
        setLocalMsgs((m) => [...m, { memoId: 0, role: 'user', content: display, createdAt: Date.now() }])
        const answer = await streamAnswer(forAI, command, history)
        setLocalMsgs((m) => [...m, { memoId: 0, role: 'assistant', content: answer, createdAt: Date.now() }])
      } else if (memo) {
        await window.api.chat.add(memo.id, 'user', display)
        useStore.setState({ chat: await window.api.chat.list(memo.id) })
        const history: ChatMessage[] = useStore.getState().chat.slice(0, -1)
        const answer = await streamAnswer(forAI, command, history)
        await window.api.chat.add(memo.id, 'assistant', answer)
        useStore.setState({ chat: await window.api.chat.list(memo.id) })
      }
    } catch (e) {
      const msg = (e as Error).message
      if (!msg.includes('중단') && !/abort/i.test(msg)) {
        const err = `오류: ${msg}`
        if (folder) setLocalMsgs((m) => [...m, { memoId: 0, role: 'assistant', content: err, createdAt: Date.now() }])
        else if (memo) {
          await window.api.chat.add(memo.id, 'assistant', err)
          useStore.setState({ chat: await window.api.chat.list(memo.id) })
        }
      }
    } finally {
      setSending(false)
      setStreamText('')
    }
    // /일정·/할일 → extract items and ask the user to confirm before registering to Home
    if ((command === 'schedule' || command === 'todo') && manifest) {
      window.api.home
        .extractSchedule(manifest.text)
        .then((items) => {
          if (items.length)
            useStore.getState().requestScheduleConfirm(items, folder ? null : memo?.id ?? null, folder ? null : memo?.folderId ?? null)
        })
        .catch(() => {})
    }
  }

  // Re-run the user turn that produced an answer (drops that answer + anything after it).
  const regenerate = async (assistantIndex: number): Promise<void> => {
    if (sending || !manifest) return
    const userMsg = msgs[assistantIndex - 1]
    if (!userMsg || userMsg.role !== 'user') return
    const ex = exactSlash(userMsg.content)
    const forAI = ex ? ex.extra || ex.cmd.label : userMsg.content
    const command = ex ? ex.cmd.id : undefined
    setSending(true)
    setStreamText('')
    try {
      if (folder) {
        const history = localMsgs.slice(0, assistantIndex - 1)
        setLocalMsgs(localMsgs.slice(0, assistantIndex)) // drop the old answer, keep the user turn
        const answer = await streamAnswer(forAI, command, history)
        setLocalMsgs((m) => [...m, { memoId: 0, role: 'assistant', content: answer, createdAt: Date.now() }])
      } else if (memo) {
        const aId = msgs[assistantIndex].id
        if (typeof aId === 'number') await window.api.chat.deleteFrom(aId)
        useStore.setState({ chat: await window.api.chat.list(memo.id) })
        const history = useStore.getState().chat.slice(0, -1)
        const answer = await streamAnswer(forAI, command, history)
        await window.api.chat.add(memo.id, 'assistant', answer)
        useStore.setState({ chat: await window.api.chat.list(memo.id) })
      }
    } catch (e) {
      const msg = (e as Error).message
      if (!msg.includes('중단') && !/abort/i.test(msg)) {
        const err = `오류: ${msg}`
        if (folder) setLocalMsgs((m) => [...m, { memoId: 0, role: 'assistant', content: err, createdAt: Date.now() }])
        else if (memo) {
          await window.api.chat.add(memo.id, 'assistant', err)
          useStore.setState({ chat: await window.api.chat.list(memo.id) })
        }
      }
    } finally {
      setSending(false)
      setStreamText('')
    }
  }

  // 인용: take an abbreviated front excerpt of an answer (cite tokens + markdown stripped) to quote
  const quoteAnswer = (content: string): void => {
    const clean = parseChatSources(content)
      .body.replace(/\[[tp]:[^\]]*\]/g, '')
      .replace(/[#*`>_~-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    setQuoted(clean.length > 240 ? clean.slice(0, 240).trim() + '…' : clean)
    taRef.current?.focus()
  }

  const slash = matchSlash(input)
  const showPalette = !!slash && slash.matches.length > 0 && !sending && !slashDismissed
  // Picking a command just FILLS the input (english command + space) — the user reviews/edits and
  // presses Enter to send. It does not send immediately.
  const pickCommand = (cmd: SlashCommand): void => {
    const extra = (slash?.extra ?? '').trim()
    setInput(`${cmd.aliases[0]} ${extra}`.trimEnd() + ' ')
    setSlashDismissed(true)
    taRef.current?.focus()
  }
  const inputIsCmd = input.startsWith('/') && (!!exactSlash(input) || (!!slash && slash.matches.length > 0))
  const sources = manifest?.sources ?? null
  const noSel = folder && srcMemoIds.length === 0 && srcPdfIds.length === 0 && srcNoteIds.length === 0

  // attach a PDF as a chat source (folder scope → folder + auto-select; note scope → this note)
  const attachSource = async (): Promise<void> => {
    const st = useStore.getState()
    if (folder) {
      if (st.selectedFolderId == null) return
      const res = await window.api.pdfs.addToFolder(st.selectedFolderId)
      if (!res.length) return
      await st.refreshFolderPdfs()
      // auto-select each newly attached PDF as a chat source (read fresh state per toggle)
      for (const p of res) if (!useStore.getState().folderSrcPdfIds.includes(p.id)) st.toggleFolderSrcPdf(p.id)
      st.showToast(res.length === 1 ? `'${res[0].name}' 첨부됨` : `PDF ${res.length}개 첨부됨`)
    } else {
      if (!memo) return
      const res = await window.api.pdfs.addToMemo(memo.id)
      if (!res.length) return
      await st.reloadMemo()
      setSrcTick((t) => t + 1)
      st.showToast(res.length === 1 ? `'${res[0].name}' 첨부됨` : `PDF ${res.length}개 첨부됨`)
    }
  }

  return (
    <div className="dictly-anim-in flex h-full flex-col">
      {manifest && manifest.excluded.length > 0 && (
        <div className="shrink-0 space-y-1 border-b border-black/5 px-3 py-2">
          {manifest.excluded.map(({ pdf, reason }) => (
            <div key={pdf.id} className="flex items-center gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5">
              <ImageOff size={12} className="shrink-0 text-amber-600" />
              <span className="min-w-0 flex-1 truncate text-[11px] text-amber-800">{pdf.name} — 인덱싱 전(인용 제외)</span>
              {reason === 'needsOcr' &&
                (indexing === pdf.name ? (
                  <Loader2 size={12} className="animate-spin text-amber-600" />
                ) : (
                  <button
                    onClick={() => void runOcr(pdf.id)}
                    disabled={indexing != null}
                    className="flex shrink-0 items-center gap-1 rounded-md bg-amber-600 px-2 py-0.5 text-[10.5px] font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    <ScanText size={10} /> 인덱싱
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {msgs.length === 0 && (
          <div className="mt-12 text-center text-subtle">
            <p className="text-[14px]">{folder ? '선택한 소스에서만 답해요' : '이 노트의 전사문과 PDF에서만 답해요'}</p>
            <p className="mt-1 text-[11.5px]">{noSel ? '왼쪽 소스에서 전사문·PDF·노트를 체크하세요' : '답변 속 인용 칩을 클릭하면 해당 위치로 이동해요'}</p>
            {!noSel && (
              <p className="mt-3 text-[12px] text-subtle">
                <span className="rounded-md bg-black/5 px-1.5 py-0.5 font-mono text-[11px] text-ink">/</span> 를 입력하면 요약·공식·일정 등 명령을 쓸 수 있어요
              </p>
            )}
          </div>
        )}
        {msgs.map((m, i) => {
          if (m.role === 'user') {
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-black/[0.06] px-3.5 py-2 text-[14px] text-ink">
                  <UserBubbleText text={m.content} />
                </div>
              </div>
            )
          }
          // AI answers render inline (no bubble) for easier reading
          const { body } = parseChatSources(m.content)
          const isLast = i === msgs.length - 1
          return (
            <div key={i} className="group px-0.5 text-[14px]">
              <CitedMarkdown sources={sources}>{body}</CitedMarkdown>
              <div className="mt-1 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                <button onClick={() => void copyText(body)} title="복사" className="rounded-md p-1 text-subtle hover:bg-black/5 hover:text-ink">
                  <Copy size={13} />
                </button>
                {isLast && (
                  <button
                    onClick={() => void regenerate(i)}
                    disabled={sending}
                    title="응답 재생성"
                    className="rounded-md p-1 text-subtle hover:bg-black/5 hover:text-ink disabled:opacity-40"
                  >
                    <RefreshCw size={13} />
                  </button>
                )}
                <button onClick={() => quoteAnswer(m.content)} title="이 답변을 인용해 추가 질문" className="rounded-md p-1 text-subtle hover:bg-black/5 hover:text-ink">
                  <Quote size={13} />
                </button>
              </div>
            </div>
          )
        })}
        {sending && (
          <div className="px-0.5 text-[14px]">
            {streamText ? <CitedMarkdown sources={sources}>{parseChatSources(streamText).body}</CitedMarkdown> : <Dots />}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="relative shrink-0 border-t border-black/5 p-3">
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
        <div className="rounded-2xl border border-black/10 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition focus-within:border-accent/40 focus-within:shadow-[0_2px_10px_rgba(0,0,0,0.08)]">
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
                const ex = exactSlash(input)
                if (ex) void send(ex.cmd, ex.extra)
                else void send()
              }
            }}
            rows={1}
            placeholder={noSel ? '소스를 먼저 선택하세요…' : '소스 내용에 대해 질문하기…'}
            className={`block max-h-40 w-full resize-none overflow-y-auto bg-transparent px-3.5 pt-3 pb-1.5 text-[14px] text-ink outline-none placeholder:text-subtle/50 ${inputIsCmd ? 'font-mono font-medium text-blue-600' : ''}`}
          />
          <div className="flex items-center gap-1 px-1.5 pb-1.5 pt-0.5">
            <button
              onClick={() => void attachSource()}
              disabled={folder ? false : !memo}
              title="PDF 첨부"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-subtle transition hover:bg-black/5 hover:text-ink active:scale-95 disabled:opacity-40"
            >
              <Plus size={18} />
            </button>
            <ModelMenu />
            {!manifest && !noSel && <span className="ml-0.5 text-[11px] text-subtle">소스 준비 중…</span>}
            <div className="flex-1" />
            {sending ? (
              <button
                onClick={stop}
                title="생성 중단"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent text-white transition hover:bg-accent/90 active:scale-95"
              >
                <Square size={14} className="fill-current" />
              </button>
            ) : (
              <button
                onClick={() => void send()}
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
  )
}
