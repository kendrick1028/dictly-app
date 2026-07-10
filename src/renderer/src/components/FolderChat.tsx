import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Quote, X, FolderSearch } from 'lucide-react'
import { useStore } from '../store/useStore'
import { ModelMenu } from './ModelSelect'
import { MarkdownMath } from './MarkdownMath'
import { segmentsToMarkdown } from '../math/koMathRules'
import { parseChatSources } from '../lib/chatSources'
import { useAutoGrow } from '../lib/useAutoGrow'

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

export function FolderChat(): JSX.Element | null {
  const { folderChatId, folders, agents, claudeModel, aiReady, setFolderChat, jumpToSource } = useStore()
  const [notes, setNotes] = useState<{ id: number; title: string; content: string }[]>([])
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  useAutoGrow(taRef, input)

  const folder = folders.find((f) => f.id === folderChatId)

  useEffect(() => {
    setMsgs([])
    setNotes([])
    if (folderChatId == null) return
    ;(async () => {
      const summaries = await window.api.memos.listByFolder(folderChatId)
      const full = await Promise.all(
        summaries.map(async (s) => {
          const m = await window.api.memos.get(s.id)
          if (!m) return null
          const agent = agents.find((a) => a.id === (m.agentId ?? null))
          const content = (m.transcriptMd || segmentsToMarkdown(m.segments, agent?.mathRules ?? {}, agent?.replacements ?? {})).slice(0, 6000)
          return { id: m.id, title: m.title, content }
        })
      )
      setNotes(full.filter((n): n is { id: number; title: string; content: string } => !!n && n.content.trim().length > 0))
    })()
  }, [folderChatId, agents])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, sending])

  if (folderChatId == null) return null

  const send = async (): Promise<void> => {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    const history = msgs
    setMsgs((m) => [...m, { role: 'user', content: text }])
    setSending(true)
    try {
      const answer = await window.api.claude.folderChat(notes, history, text, claudeModel)
      setMsgs((m) => [...m, { role: 'assistant', content: answer }])
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: `오류: ${(e as Error).message}` }])
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center gap-2 px-4 pt-1">
        <FolderSearch size={16} className="text-accent" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{folder?.name ?? '폴더'} · AI 검색</div>
        </div>
        <button onClick={() => setFolderChat(null)} className="rounded-lg p-1.5 text-subtle hover:bg-black/5" title="닫기">
          <X size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {msgs.length === 0 && (
          <div className="mt-10 text-center text-subtle">
            <p className="text-[14px]">이 폴더의 모든 노트({notes.length}개)에서 검색해 답합니다</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {['이 폴더에서 WACC 관련 내용 정리해줘', '가장 중요한 핵심 개념 3가지는?', '시험에 나올 만한 부분 알려줘'].map((s) => (
                <button key={s} onClick={() => setInput(s)} className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-[12px] text-subtle hover:bg-black/5">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => {
          if (m.role === 'user') {
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl bg-accent px-3.5 py-2 text-[14px] text-white">{m.content}</div>
              </div>
            )
          }
          const { body, sources } = parseChatSources(m.content)
          return (
            <div key={i} className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl bg-white px-3.5 py-2 text-[14px] shadow-sm">
                <MarkdownMath>{body}</MarkdownMath>
                {sources.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5 border-t border-black/5 pt-2">
                    {sources.map((s, si) => (
                      <button
                        key={si}
                        onClick={() => s.memoId != null && jumpToSource(s.memoId, s.quote)}
                        className="flex max-w-[220px] items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] text-accent hover:bg-accent/20"
                        title={s.quote}
                      >
                        <Quote size={10} className="shrink-0" />
                        <span className="truncate">{s.title || s.quote}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {sending && (
          <div className="flex items-center gap-2 text-[13px] text-subtle">
            폴더 전체를 살펴보는 중
            <span className="inline-flex items-center gap-1">
              <span className="dictly-dot" style={{ animationDelay: '0s' }} />
              <span className="dictly-dot" style={{ animationDelay: '0.18s' }} />
              <span className="dictly-dot" style={{ animationDelay: '0.36s' }} />
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-black/5 p-3">
        {!aiReady && <div className="mb-2 text-[12px] text-red-500">AI 미연결 — 상단 “연결”에서 설정하세요</div>}
        <div className="rounded-2xl border border-black/10 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition focus-within:border-accent/40 focus-within:shadow-[0_2px_10px_rgba(0,0,0,0.08)]">
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return // IME: don't fire mid-composition
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            rows={1}
            placeholder={`${folder?.name ?? '폴더'} 전체에 질문하기…`}
            className="block max-h-40 w-full resize-none overflow-y-auto bg-transparent px-3.5 pt-3 pb-1.5 text-[14px] text-ink outline-none placeholder:text-subtle/50"
          />
          <div className="flex items-center gap-1 px-1.5 pb-1.5 pt-0.5">
            <ModelMenu />
            <div className="flex-1" />
            <button
              onClick={send}
              disabled={sending || !input.trim()}
              title="보내기"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent text-white transition hover:bg-accent/90 active:scale-95 disabled:opacity-30"
            >
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
