import { memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Pause, Play, Loader2, Wand2, Bold, Underline, Highlighter, FileText, Bookmark, ChevronUp, ChevronDown, X, Search, History, ExternalLink, Trash2 } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { MarkdownMath } from '../MarkdownMath'
import { applyMathRules, segmentsToMarkdown } from '../../math/koMathRules'
import { fmtClock, fmtRange } from '../../lib/time'
import { addRuntimeReplacement, markLiveEdited } from '../../audio/recorderController'
import { isHeading } from '../../lib/structure'
import { useStickToBottom, JumpToLatest } from '../../lib/useStickToBottom'
import type { Segment } from '../../../../shared/types'

function TypingDots(): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <span className="dictly-dot" style={{ animationDelay: '0s' }} />
      <span className="dictly-dot" style={{ animationDelay: '0.18s' }} />
      <span className="dictly-dot" style={{ animationDelay: '0.36s' }} />
    </span>
  )
}

// stable empty refs so React.memo on SegMarkdown isn't broken by a fresh `{}` each render
const EMPTY_RULES: Record<string, string> = {}
// correction sweep duration (s); kept in sync with the @keyframes in index.css
const CORR_DUR = 3.2

/**
 * Live preview line, isolated in its own component that subscribes ONLY to rec.partial (and
 * recording/paused). The preview updates ~2x/s; keeping it here means those updates re-render
 * just this one line, not the whole (potentially huge) segment list above it.
 */
function LivePreviewLine({ show, follow }: { show: boolean; follow: RefObject<boolean> }): JSX.Element | null {
  const partial = useStore((s) => s.rec.partial)
  const isRecording = useStore((s) => s.rec.isRecording)
  const paused = useStore((s) => s.rec.paused)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // instant (not 'smooth'): repeated smooth scrollIntoView on every partial piles up
    // animations that starve the waveform's rAF and make the preview flicker.
    // `follow` is false while the user has scrolled up to read — never yank them back down.
    if (partial && follow.current) ref.current?.scrollIntoView({ block: 'end' })
  }, [partial, follow])
  if (!show || !isRecording || paused) return null
  return (
    // dots on their OWN line (not inline after the text) so they stay fixed at the bottom-left
    // and don't slide sideways as the preview text grows
    <div ref={ref} className="py-1 text-subtle">
      {partial && <div className="text-[15px] leading-relaxed">{partial}</div>}
      <div className="mt-1">
        <TypingDots />
      </div>
    </div>
  )
}

/**
 * Memoized per-segment renderer. Markdown+KaTeX parsing is expensive, so without this
 * EVERY segment re-parses on every `rec.partial` tick (~1/s while recording) — with
 * hundreds of segments that saturates the main thread and freezes the whole UI (buttons
 * stop responding, new transcript stops painting). memo skips segments whose props are
 * unchanged, so a partial update only re-renders the live line, not the entire backlog.
 */
function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
/** wrap case-insensitive occurrences of `q` in a <mark> — yellow normally, orange for the active match.
 *  $…$ / $$…$$ math spans are left untouched so injected HTML never corrupts KaTeX parsing. */
function highlightText(text: string, q: string, active: boolean): string {
  if (!q) return text
  const cls = active ? 'dictly-search-hl dictly-search-hl-active' : 'dictly-search-hl'
  const wrap = (s: string): string => s.replace(new RegExp(escapeReg(q), 'gi'), (m) => `<mark class="${cls}">${m}</mark>`)
  // split keeping math delimiters: odd indices are math spans (verbatim), even indices get highlighted
  return text
    .split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g)
    .map((part, i) => (i % 2 === 1 ? part : wrap(part)))
    .join('')
}

const SegMarkdown = memo(function SegMarkdown({
  text,
  mathRules,
  replacements,
  highlight,
  active
}: {
  text: string
  mathRules: Record<string, string>
  replacements: Record<string, string>
  highlight?: string
  active?: boolean
}): JSX.Element {
  const body = applyMathRules(text, mathRules, replacements)
  return <MarkdownMath className="!text-[15px] [&_p]:!my-0">{highlight ? highlightText(body, highlight, !!active) : body}</MarkdownMath>
})

export function TranscriptTab({ searchOpen = false, onCloseSearch }: { searchOpen?: boolean; onCloseSearch?: () => void }): JSX.Element {
  // fine-grained selectors: this component re-renders only when these specific fields change,
  // NOT on every setRec (partial/elapsed tick) — those are isolated into leaf components.
  const memo = useStore((s) => s.memo)
  const agents = useStore((s) => s.agents)
  const activeAgentId = useStore((s) => s.activeAgentId)
  const recordingMemoId = useStore((s) => s.recordingMemoId)
  const saveTranscript = useStore((s) => s.saveTranscript)
  const scrollTarget = useStore((s) => s.scrollTarget)
  const setScrollTarget = useStore((s) => s.setScrollTarget)
  const toggleBookmark = useStore((s) => s.toggleBookmark)
  const bookmarks = memo?.bookmarks ?? []
  // PDF sync: badge click opens + jumps the viewer; marker click (from a PDF page) seeks audio here
  const audioSeekTarget = useStore((s) => s.audioSeekTarget)
  const clearAudioSeek = useStore((s) => s.clearAudioSeek)
  const openPdf = useStore((s) => s.openPdf)
  const setFocusedPdf = useStore((s) => s.setFocusedPdf)
  const setCurrentPdfPage = useStore((s) => s.setCurrentPdfPage)
  const pdfSectionOpen = useStore((s) => s.pdfSectionOpen)
  const setPdfSectionOpen = useStore((s) => s.setPdfSectionOpen)
  const isRecording = useStore((s) => s.rec.isRecording)
  const finalizing = useStore((s) => s.rec.finalizing)
  const liveSegments = useStore((s) => s.rec.liveSegments)
  const correctingIdx = useStore((s) => s.rec.correctingIdx)
  const correctingSet = useMemo(() => new Set(correctingIdx), [correctingIdx])
  // a single phase value applied to all sweeping segments this render → they animate in unison
  const corrDelay = `${-((performance.now() / 1000) % CORR_DUR)}s`
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [editSel, setEditSel] = useState<{ start: number; end: number; x: number; y: number } | null>(null)
  // a selection made by dragging over a (non-editing) segment, applied to the
  // textarea once it mounts — so a single drag selects + opens the toolbar.
  const [pendingSel, setPendingSel] = useState<{ start: number; end: number } | null>(null)
  const [bulkTo, setBulkTo] = useState('')
  const [flashIdx, setFlashIdx] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  // auto-follow new chunks; pauses when the user scrolls up, resumes via the ↓ button / bottom
  const { following, followRef, scrollToBottom } = useStickToBottom(contentRef)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [curTime, setCurTime] = useState(0)
  // in-transcript search (toggled from the toolbar 돋보기)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchActive, setSearchActive] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  // audio playback speed (persisted)
  const [rate, setRate] = useState(() => Number(localStorage.getItem('dictly.audioRate')) || 1)

  const agent = useMemo(
    () => agents.find((a) => a.id === (memo?.agentId ?? activeAgentId)),
    [agents, memo?.agentId, activeAgentId]
  )
  const mathRules = agent?.mathRules ?? EMPTY_RULES
  const replacements = agent?.replacements ?? EMPTY_RULES

  useEffect(() => {
    let revoked: string | null = null
    setAudioUrl(null)
    useStore.getState().setAudioPlayback(0, false)
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

  // Only overlay live segments on the memo the recording is actually writing to,
  // so navigating to other memos mid-recording never shows/saves on the wrong note.
  const isRecordingThis = recordingMemoId != null && memo?.id === recordingMemoId
  const live = (isRecording || finalizing) && isRecordingThis
  const memoCount = memo ? memo.segments.length : 0
  const segments: Segment[] = memo ? (live ? [...memo.segments, ...liveSegments] : memo.segments) : []

  // in-transcript search: segment indices containing the query (case-insensitive)
  const matchIdxs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    const out: number[] = []
    segments.forEach((s, i) => {
      if (s.text.toLowerCase().includes(q)) out.push(i)
    })
    return out
  }, [segments, searchQuery])
  const matchSet = useMemo(() => new Set(matchIdxs), [matchIdxs])
  const activeMatchSeg = matchIdxs.length ? matchIdxs[Math.min(searchActive, matchIdxs.length - 1)] : -1

  const scrollToSegment = (idx: number): void => {
    const c = contentRef.current
    const row = c?.querySelector(`[data-seg-idx="${idx}"]`) as HTMLElement | null
    if (!c || !row) return
    const cr = c.getBoundingClientRect()
    const rr = row.getBoundingClientRect()
    c.scrollTo({ top: c.scrollTop + (rr.top - cr.top) - c.clientHeight / 2 + rr.height / 2, behavior: 'smooth' })
  }

  // focus the search field when opened; clear the query when closed
  useEffect(() => {
    if (searchOpen) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 20)
      return () => clearTimeout(t)
    }
    setSearchQuery('')
    return undefined
  }, [searchOpen])
  useEffect(() => setSearchActive(0), [searchQuery])
  // scroll the active match into view
  useEffect(() => {
    if (searchQuery && activeMatchSeg >= 0) scrollToSegment(activeMatchSeg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchActive, searchQuery, matchIdxs.length])
  // apply audio playback speed (persisted)
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate
  }, [rate, audioUrl])

  useEffect(() => {
    // scroll on NEW segments only (partial-driven scrolling lives in LivePreviewLine, so it
    // no longer thrashes layout on every preview tick)
    if (live && editIdx === null && followRef.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [segments.length, live, editIdx, followRef])

  // jump to a cited source — by quote (folder-chat badges) or by time (studio citation chips) — and flash it
  useEffect(() => {
    if (!scrollTarget || !memo || scrollTarget.memoId !== memo.id) return
    let idx = -1
    if (scrollTarget.quote) {
      const q = scrollTarget.quote.replace(/\s+/g, '').slice(0, 16)
      idx = segments.findIndex((s) => s.text.replace(/\s+/g, '').includes(q))
    } else if (scrollTarget.t != null) {
      const t = scrollTarget.t
      idx = segments.findIndex((s) => t >= s.tStart && t < s.tEnd)
      if (idx < 0) {
        // nearest segment within 30s (AI may cite a merged-block start time)
        let best = -1
        let bd = 30
        segments.forEach((s, i) => {
          const d = Math.abs(s.tStart - t)
          if (d < bd) {
            bd = d
            best = i
          }
        })
        idx = best
      }
    }
    setScrollTarget(null)
    if (idx < 0) return
    setFlashIdx(idx)
    // NOTE: setScrollTarget(null) re-runs this effect immediately, so a cleanup would cancel any
    // timer before it fires (scroll never happened, flash never cleared). Use detached one-shots:
    // double-rAF lets the layout settle (tab switch / fullscreen exit), then center manually.
    let tries = 0
    const center = (): void => {
      const c = contentRef.current
      const row = c?.querySelector(`[data-seg-idx="${idx}"]`) as HTMLElement | null
      if (!c) return
      if (!row) {
        if (tries++ < 10) requestAnimationFrame(center) // rows may still be mounting
        return
      }
      const cr = c.getBoundingClientRect()
      const rr = row.getBoundingClientRect()
      c.scrollTo({ top: c.scrollTop + (rr.top - cr.top) - c.clientHeight / 2 + rr.height / 2, behavior: 'smooth' })
    }
    requestAnimationFrame(() => requestAnimationFrame(center))
    setTimeout(() => setFlashIdx((cur) => (cur === idx ? null : cur)), 2400)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTarget, memo?.id, segments.length])

  // seek audio when a PDF-page chunk marker is clicked (mirrors the scrollTarget bridge)
  useEffect(() => {
    if (!audioSeekTarget) return
    const a = audioRef.current
    if (a) {
      a.currentTime = audioSeekTarget.t
      void a.play()
    }
    clearAudioSeek()
  }, [audioSeekTarget, clearAudioSeek])

  // autosize editor + focus
  useEffect(() => {
    if (editIdx !== null && taRef.current) {
      taRef.current.style.height = 'auto'
      taRef.current.style.height = taRef.current.scrollHeight + 'px'
    }
  }, [editIdx, editText])

  const commitEdit = async (): Promise<void> => {
    if (editIdx === null || !memo) return
    const idx = editIdx
    const text = editText
    setEditIdx(null)
    setEditSel(null)
    const mc = memo.segments.length
    if (idx < mc) {
      if (memo.segments[idx]?.text !== text) {
        const newSegs = memo.segments.map((s, i) => (i === idx ? { ...s, text } : s))
        await saveTranscript(segmentsToMarkdown(newSegs, mathRules, replacements), newSegs)
      }
    } else {
      const liveIdx = idx - mc
      markLiveEdited(liveIdx)
      useStore.getState().updateLiveSegment(liveIdx, text)
    }
  }

  // commit when clicking outside the editor + toolbar
  useEffect(() => {
    if (editIdx === null) return
    const h = (e: MouseEvent): void => {
      const t = e.target as Node
      if (taRef.current?.contains(t) || toolbarRef.current?.contains(t)) return
      void commitEdit()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editIdx, editText])

  if (!memo) return <div />

  const hasContent = segments.length > 0 || memo.transcriptMd.trim().length > 0
  const activeIdx = playing ? segments.findIndex((s) => curTime >= s.tStart && curTime < s.tEnd) : -1

  const seek = (t: number): void => {
    if (audioRef.current) {
      audioRef.current.currentTime = t
      audioRef.current.play()
    }
  }
  // open the PDF section + this PDF and jump it to the linked page (forward sync from a chunk)
  const openPdfToPage = (pdfId: number, page: number): void => {
    if (!pdfSectionOpen) setPdfSectionOpen(true)
    openPdf(pdfId)
    setFocusedPdf(pdfId)
    setCurrentPdfPage(pdfId, page)
  }
  // p.N badge dropdown: jump / re-tag this chunk to another page / clear the tag
  const [pageMenu, setPageMenu] = useState<{ idx: number; left: number; top: number } | null>(null)
  const pageMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!pageMenu) return
    const h = (e: MouseEvent): void => {
      if (pageMenuRef.current && !pageMenuRef.current.contains(e.target as Node)) setPageMenu(null)
    }
    const k = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPageMenu(null)
    }
    document.addEventListener('mousedown', h)
    window.addEventListener('keydown', k)
    return () => {
      document.removeEventListener('mousedown', h)
      window.removeEventListener('keydown', k)
    }
  }, [pageMenu])
  const retagSegment = async (idx: number, page: number | null): Promise<void> => {
    if (!memo) return
    const seg = segments[idx]
    if (!seg) return
    const mc = memo.segments.length
    if (idx < mc) {
      const newSegs = memo.segments.map((x, i) => (i === idx ? { ...x, pdfPage: page, pdfId: page == null ? null : x.pdfId } : x))
      await saveTranscript(segmentsToMarkdown(newSegs, mathRules, replacements), newSegs)
    } else {
      useStore.getState().setLiveSegmentPage(idx - mc, page == null ? null : (seg.pdfId ?? null), page)
    }
  }
  const togglePlay = (): void => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) a.play()
    else a.pause()
  }
  const gotoMatch = (delta: number): void => {
    const n = matchIdxs.length
    if (!n) return
    setSearchActive((a) => (((a + delta) % n) + n) % n)
  }

  const startEdit = (i: number): void => {
    setEditIdx(i)
    setEditText(segments[i].text)
    setEditSel(null)
  }

  // Mouse-up on a rendered segment: if the user dragged a selection, carry it into
  // edit mode (so the drag isn't lost); a plain click just enters edit mode.
  const onViewMouseUp = (i: number): void => {
    const selText = window.getSelection()?.toString() ?? ''
    if (selText.trim()) {
      const src = segments[i].text
      const start = src.indexOf(selText)
      if (start >= 0) setPendingSel({ start, end: start + selText.length })
    }
    startEdit(i)
  }

  // once the textarea mounts, re-apply the dragged selection + show the toolbar
  useEffect(() => {
    if (editIdx === null || !pendingSel) return
    const ta = taRef.current
    if (!ta) return
    ta.focus()
    ta.setSelectionRange(pendingSel.start, pendingSel.end)
    const r = ta.getBoundingClientRect()
    setBulkTo(editText.slice(pendingSel.start, pendingSel.end))
    setEditSel({ start: pendingSel.start, end: pendingSel.end, x: r.left + r.width / 2, y: r.top })
    setPendingSel(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editIdx, pendingSel])

  const onSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>): void => {
    const ta = e.currentTarget
    const start = ta.selectionStart
    const end = ta.selectionEnd
    if (start !== end) {
      const r = ta.getBoundingClientRect()
      setBulkTo(editText.slice(start, end))
      setEditSel({ start, end, x: r.left + r.width / 2, y: r.top })
    } else {
      setEditSel(null)
    }
  }

  const applyFmt = (wrap: (t: string) => string): void => {
    if (!editSel) return
    const { start, end } = editSel
    setEditText(editText.slice(0, start) + wrap(editText.slice(start, end)) + editText.slice(end))
    setEditSel(null)
    taRef.current?.focus()
  }

  const applyBulkEdit = async (): Promise<void> => {
    if (!editSel || !memo) return
    const from = editText.slice(editSel.start, editSel.end).trim()
    const to = bulkTo.trim()
    setEditSel(null)
    if (!from || from === to) return
    const repl = (t: string): string => t.split(from).join(to)
    setEditText(repl(editText))
    const mc = memo.segments.length
    const newSegs = memo.segments.map((s, i) => (i === editIdx ? s : { ...s, text: repl(s.text) }))
    await saveTranscript(segmentsToMarkdown(newSegs, mathRules, replacements), newSegs)
    useStore.getState().rec.liveSegments.forEach((s, j) => {
      if (mc + j === editIdx) return
      const nt = repl(s.text)
      if (nt !== s.text) {
        markLiveEdited(j)
        useStore.getState().updateLiveSegment(j, nt)
      }
    })
    addRuntimeReplacement(from, to)
    // agent self-improvement: feed repeated batch corrections into the agent's term/math rules
    const st = useStore.getState()
    const agent = st.agents.find((a) => a.id === memo.agentId)
    if (agent?.selfImprove) {
      const kind: 'term' | 'math' = /[$\\^_]/.test(from + to) ? 'math' : 'term'
      void window.api.agents.recordCorrection(agent.id, from, to, kind).then((res) => {
        if (res?.applied) {
          st.showToast(`규칙 자동 추가: ${res.from} → ${res.to}`)
          void st.refreshAgents()
        }
      })
    }
    taRef.current?.focus()
  }

  const noDrag = (e: React.MouseEvent): void => e.preventDefault()

  return (
    <div className="flex h-full flex-col">
      {audioUrl && (
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
          <select
            value={rate}
            onChange={(e) => {
              const r = Number(e.target.value)
              setRate(r)
              localStorage.setItem('dictly.audioRate', String(r))
            }}
            className="w-[52px] shrink-0 cursor-pointer rounded-md bg-transparent px-1 py-0.5 text-center text-[11.5px] font-medium tabular-nums text-subtle outline-none hover:bg-black/10"
            title="재생 속도"
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
          <audio
            ref={audioRef}
            src={audioUrl}
            onTimeUpdate={(e) => {
              const a = e.target as HTMLAudioElement
              setCurTime(a.currentTime)
              useStore.getState().setAudioPlayback(a.currentTime, !a.paused)
            }}
            onPlay={(e) => {
              setPlaying(true)
              useStore.getState().setAudioPlayback((e.target as HTMLAudioElement).currentTime, true)
            }}
            onPause={(e) => {
              setPlaying(false)
              useStore.getState().setAudioPlayback((e.target as HTMLAudioElement).currentTime, false)
            }}
            hidden
          />
        </div>
      )}

      {/* in-transcript search — always mounted, slides down/up via max-height transition */}
      <div className={`overflow-hidden transition-all duration-200 ease-out ${searchOpen ? 'max-h-14 border-b border-black/5 opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="flex items-center gap-2 px-4 py-2">
          <Search size={15} className="shrink-0 text-subtle" />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                onCloseSearch?.()
                return
              }
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') {
                e.preventDefault()
                gotoMatch(e.shiftKey ? -1 : 1)
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                gotoMatch(1)
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                gotoMatch(-1)
              }
            }}
            placeholder="전사문에서 검색  ·  ↑↓ 결과 이동"
            className="flex-1 bg-transparent text-[14px] text-ink placeholder:text-subtle/60 outline-none"
          />
          <span className="shrink-0 text-[12px] tabular-nums text-subtle">
            {matchIdxs.length ? `${Math.min(searchActive, matchIdxs.length - 1) + 1}/${matchIdxs.length}` : '0/0'}
          </span>
          <button onClick={() => gotoMatch(-1)} disabled={!matchIdxs.length} className="shrink-0 rounded-md p-1 text-subtle hover:bg-black/10 disabled:opacity-40" title="이전 (↑ · Shift+Enter)">
            <ChevronUp size={15} />
          </button>
          <button onClick={() => gotoMatch(1)} disabled={!matchIdxs.length} className="shrink-0 rounded-md p-1 text-subtle hover:bg-black/10 disabled:opacity-40" title="다음 (↓ · Enter)">
            <ChevronDown size={15} />
          </button>
          <button onClick={() => onCloseSearch?.()} className="shrink-0 rounded-md p-1 text-subtle hover:bg-black/10" title="닫기 (Esc)">
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
      {/* extra bottom padding: the floating recording pill overlaps the last lines otherwise */}
      <div ref={contentRef} className="absolute inset-0 overflow-y-auto px-4 pb-28">
        {isRecordingThis && finalizing && (
          <div className="sticky top-0 z-10 mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-700 shadow-sm">
            <Loader2 size={14} className="animate-spin" /> 남은 음성 전사·교정 마무리 중…
          </div>
        )}
        {!hasContent && !live && (
          <div className="mt-16 text-center text-subtle">
            <p className="text-[14px]">아직 전사된 내용이 없습니다</p>
            <p className="mt-1 text-[13px]">아래 녹음 버튼을 눌러 음성인식을 시작하세요</p>
          </div>
        )}

        <div className="space-y-3 pt-1">
          {segments.map((s, i) => {
            const editing = editIdx === i
            if (!s.text.trim() && !editing) return null
            const liveIdx = i - memoCount
            const isCorrecting = live && liveIdx >= 0 && correctingSet.has(liveIdx) && !editing
            const heading = isHeading(s.text) && !editing
            return (
              <div
                key={i}
                data-seg-idx={i}
                className={`${heading ? 'group pt-2' : 'group'} ${i === flashIdx ? 'dictly-flash-seg' : ''}`}
              >
                {!heading && (
                  <div className="mb-0.5 flex items-center gap-2">
                    <button onClick={() => seek(s.tStart)} className="clock text-[11px] text-subtle hover:text-accent">
                      {fmtRange(s.tStart, s.tEnd)}
                    </button>
                    {s.pdfId != null && s.pdfPage != null && (
                      // left half jumps the PDF to the page; the ⌄ opens the re-tag dropdown
                      <span className={`inline-flex items-stretch overflow-hidden rounded text-[10px] text-accent ${pageMenu?.idx === i ? 'bg-accent/20' : 'bg-accent/10'}`}>
                        <button
                          onClick={() => openPdfToPage(s.pdfId as number, s.pdfPage as number)}
                          className="flex items-center gap-0.5 pl-1.5 pr-1 hover:bg-accent/20"
                          title={`${memo.pdfs.find((p) => p.id === s.pdfId)?.name ?? 'PDF'} · p.${s.pdfPage} — 클릭하면 이 페이지로 이동`}
                        >
                          <FileText size={9} /> p.{s.pdfPage}
                        </button>
                        <button
                          onClick={(e) => {
                            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                            setPageMenu((cur) => (cur?.idx === i ? null : { idx: i, left: r.left - 60, top: r.bottom + 4 }))
                          }}
                          className="flex items-center border-l border-accent/20 px-1 hover:bg-accent/20"
                          title="페이지 바꾸기"
                        >
                          <ChevronDown size={9} className="opacity-70" />
                        </button>
                      </span>
                    )}
                    <div className="flex-1" />
                    {s.origText && s.origText !== s.text && (
                      <span className="group/orig relative inline-flex">
                        <button
                          className="flex shrink-0 items-center rounded p-0.5 text-subtle opacity-0 transition hover:bg-black/5 hover:text-accent group-hover:opacity-100"
                          title="교정 전 원문 보기"
                        >
                          <History size={12} />
                        </button>
                        <span className="pointer-events-none absolute right-0 top-full z-[70] mt-1 hidden w-64 max-w-[80vw] whitespace-normal break-words rounded-md bg-white px-2.5 py-1.5 text-left text-[12px] font-normal leading-relaxed text-ink shadow-lg ring-1 ring-black/10 group-hover/orig:block">
                          <span className="mb-0.5 block text-[10px] font-medium text-subtle">교정 전 원문</span>
                          {s.origText}
                        </span>
                      </span>
                    )}
                    <button
                      onClick={() => void toggleBookmark(s.tStart)}
                      title={bookmarks.includes(s.tStart) ? '북마크 해제' : '나중에 다시 볼 부분으로 북마크'}
                      className={`shrink-0 rounded p-0.5 transition ${
                        bookmarks.includes(s.tStart)
                          ? 'text-accent'
                          : 'text-subtle opacity-0 hover:bg-black/5 hover:text-accent group-hover:opacity-100'
                      }`}
                    >
                      <Bookmark size={13} className={bookmarks.includes(s.tStart) ? 'fill-current' : ''} />
                    </button>
                  </div>
                )}
                {editing ? (
                  <textarea
                    ref={taRef}
                    value={editText}
                    autoFocus
                    onChange={(e) => setEditText(e.target.value)}
                    onSelect={onSelect}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault()
                        void commitEdit()
                      } else if (e.key === 'Escape') {
                        // cancel edit (discard) — do NOT save; ⌘/Ctrl+Enter or click-away saves
                        setEditIdx(null)
                        setEditSel(null)
                      }
                    }}
                    className="block w-full resize-none overflow-hidden bg-transparent text-[15px] leading-relaxed text-ink outline-none"
                    style={{ border: 'none', padding: 0, margin: 0, fontFamily: 'inherit' }}
                  />
                ) : (
                  <div
                    onMouseUp={() => onViewMouseUp(i)}
                    className={`cursor-text rounded ${isCorrecting ? 'dictly-correcting' : ''} ${i === activeIdx ? 'playing-seg' : ''}`}
                    style={isCorrecting ? ({ '--corr-delay': corrDelay } as React.CSSProperties) : undefined}
                    title="클릭하여 수정 · 드래그하여 선택"
                  >
                    <SegMarkdown
                      text={s.text}
                      mathRules={mathRules}
                      replacements={replacements}
                      highlight={searchOpen && searchQuery.trim() && matchSet.has(i) ? searchQuery.trim() : undefined}
                      active={i === activeMatchSeg}
                    />
                    {s.translation && (
                      // Korean translation of a foreign-language chunk (from live correction) — shown under the original
                      <div className="mt-1 border-l-2 border-accent/30 pl-2.5 text-[13.5px] leading-relaxed text-subtle">
                        <MarkdownMath className="!text-[13.5px] [&_p]:!my-0">{s.translation}</MarkdownMath>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          <LivePreviewLine show={isRecordingThis} follow={followRef} />
          <div ref={bottomRef} />
        </div>
      </div>
      {live && !following && <JumpToLatest onClick={scrollToBottom} />}
      </div>

      {/* p.N badge dropdown */}
      {pageMenu &&
        (() => {
          const seg = segments[pageMenu.idx]
          if (!seg || seg.pdfId == null) return null
          const pdf = memo.pdfs.find((p) => p.id === seg.pdfId)
          const count = pdf?.pageCount ?? 0
          const W = 224
          const left = Math.max(8, Math.min(window.innerWidth - W - 8, pageMenu.left))
          const top = Math.min(window.innerHeight - 300, pageMenu.top)
          return createPortal(
            <div ref={pageMenuRef} className="dictly-pop-in fixed z-[80] w-56 rounded-xl border border-black/10 bg-white py-1.5 shadow-xl" style={{ left, top }}>
              <div className="truncate px-3 pb-1 text-[10.5px] text-subtle" title={pdf?.name}>
                {pdf?.name ?? 'PDF'} · 이 청크의 교안 페이지
              </div>
              <button
                onClick={() => {
                  openPdfToPage(seg.pdfId as number, seg.pdfPage as number)
                  setPageMenu(null)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-ink hover:bg-black/5"
              >
                <ExternalLink size={12} className="text-accent" /> p.{seg.pdfPage}로 이동
              </button>
              <div className="my-1 h-px bg-black/5" />
              <div className="px-3 pb-1 text-[10.5px] text-subtle">페이지 바꾸기</div>
              <div className="mx-2 grid max-h-40 grid-cols-6 gap-1 overflow-y-auto pb-1">
                {Array.from({ length: Math.max(count, seg.pdfPage ?? 1) }, (_, k) => k + 1).map((pg) => (
                  <button
                    key={pg}
                    onClick={() => {
                      void retagSegment(pageMenu.idx, pg)
                      setPageMenu(null)
                    }}
                    className={`rounded-md py-1 text-[11px] tabular-nums ${pg === seg.pdfPage ? 'bg-accent font-semibold text-white' : 'bg-black/[0.04] text-ink hover:bg-accent/15 hover:text-accent'}`}
                  >
                    {pg}
                  </button>
                ))}
              </div>
              <div className="my-1 h-px bg-black/5" />
              <button
                onClick={() => {
                  void retagSegment(pageMenu.idx, null)
                  setPageMenu(null)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-red-500 hover:bg-red-50"
              >
                <Trash2 size={12} /> 페이지 태그 지우기
              </button>
            </div>,
            document.body
          )
        })()}

      {/* edit-mode selection toolbar */}
      {editIdx !== null && editSel && (
        <div
          ref={toolbarRef}
          style={{ position: 'fixed', left: editSel.x, top: Math.max(8, editSel.y - 46), transform: 'translateX(-50%)', zIndex: 50 }}
          className="flex items-center gap-1 rounded-xl border border-black/10 bg-white px-1.5 py-1 shadow-xl"
        >
          <button onMouseDown={noDrag} onClick={() => applyFmt((t) => `**${t}**`)} className="rounded-md p-1.5 hover:bg-black/5" title="굵게">
            <Bold size={14} />
          </button>
          <button onMouseDown={noDrag} onClick={() => applyFmt((t) => `<u>${t}</u>`)} className="rounded-md p-1.5 hover:bg-black/5" title="밑줄">
            <Underline size={14} />
          </button>
          <button onMouseDown={noDrag} onClick={() => applyFmt((t) => `<mark>${t}</mark>`)} className="rounded-md p-1.5 hover:bg-black/5" title="하이라이트">
            <Highlighter size={14} />
          </button>
          <div className="mx-0.5 h-4 w-px bg-black/10" />
          <Wand2 size={13} className="text-accent" />
          <input
            value={bulkTo}
            onChange={(e) => setBulkTo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void applyBulkEdit()
              else if (e.key === 'Escape') setEditSel(null)
            }}
            placeholder="올바른 표기"
            className="w-28 rounded-md border border-black/10 px-2 py-1 text-[13px] outline-none focus:border-accent"
          />
          <button onMouseDown={noDrag} onClick={applyBulkEdit} className="rounded-md bg-accent px-2 py-1 text-[12px] font-medium text-white hover:bg-accent/90" title="메모 전체에서 교정">
            전체 교정
          </button>
        </div>
      )}
    </div>
  )
}
