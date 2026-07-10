import { useEffect, useRef, useState } from 'react'
import { Copy, Download, Loader2, MoreVertical, Search, Sparkles } from 'lucide-react'
import { useStore, type Tab } from '../store/useStore'
import { RecordBar } from './RecordBar'
import { TranscriptTab } from './tabs/TranscriptTab'
import { StructuredTab } from './tabs/StructuredTab'
import { RawTab } from './tabs/RawTab'
import { BookmarksTab } from './tabs/BookmarksTab'
import { buildHtmlDoc, stripMarkdown } from '../lib/exportContent'
import { copyHtml } from '../lib/clipboard'
import { buildScript } from '../lib/structure'
import type { ExportFormat } from '../../../shared/types'

const BASE_TABS: { id: Tab; label: string }[] = [
  { id: 'transcript', label: '전사문' },
  { id: 'structured', label: '정리' },
  { id: 'raw', label: '원문' }
]

/** Middle column: transcript tab row + per-view actions (PDF toggle, copy, export) + body
 *  + floating record pill. Returns inner content; the caller wraps it in a section card. */
export function TranscriptArea(): JSX.Element {
  const memo = useStore((s) => s.memo)
  const activeTab = useStore((s) => s.activeTab)
  const setTab = useStore((s) => s.setTab)
  const outlineMemo = useStore((s) => s.outlineMemo)
  const busy = useStore((s) => s.busy)
  const aiReady = useStore((s) => s.aiReady)
  const isRecording = useStore((s) => s.rec.isRecording)
  const recordingMemoId = useStore((s) => s.recordingMemoId)
  const [exportOpen, setExportOpen] = useState(false)
  const [mp4Saving, setMp4Saving] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)

  // 북마크 tab only exists while the note has bookmarked chunks (no count badge — just the label)
  const bookmarkCount = memo?.bookmarks?.length ?? 0
  const tabs = bookmarkCount > 0 ? [...BASE_TABS, { id: 'bookmarks' as Tab, label: '북마크' }] : BASE_TABS

  // close the in-transcript search when leaving the transcript tab or switching notes
  useEffect(() => {
    if (activeTab !== 'transcript') setSearchOpen(false)
  }, [activeTab])
  useEffect(() => {
    setSearchOpen(false)
  }, [memo?.id])

  useEffect(() => {
    const h = (e: MouseEvent): void => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // if the last bookmark is removed while viewing the 북마크 tab, fall back to 전사문
  useEffect(() => {
    if (activeTab === 'bookmarks' && bookmarkCount === 0) setTab('transcript')
  }, [activeTab, bookmarkCount, setTab])

  const currentMarkdown = (): string => {
    if (!memo) return ''
    if (activeTab === 'structured') return memo.structuredMd
    if (activeTab === 'raw') return buildScript(memo.segments)
    if (activeTab === 'bookmarks') {
      const set = new Set(memo.bookmarks)
      return buildScript(memo.segments.filter((s) => set.has(s.tStart)))
    }
    return memo.transcriptMd
  }

  const doCopy = async (): Promise<void> => {
    if (!memo) return
    const md = currentMarkdown()
    await copyHtml(buildHtmlDoc(memo.title, md), md)
  }
  const doMp4 = async (): Promise<void> => {
    if (!memo?.audioPath || mp4Saving) return
    setMp4Saving(true)
    try {
      const res = await window.api.recordings.exportMp4(memo.audioPath, memo.title)
      if (!res.canceled) useStore.getState().showToast('MP4로 저장했어요')
    } catch (e) {
      useStore.getState().showToast(`MP4 저장 실패: ${(e as Error).message}`)
    } finally {
      setMp4Saving(false)
    }
  }
  const doExport = async (format: ExportFormat): Promise<void> => {
    setExportOpen(false)
    if (!memo) return
    const md = currentMarkdown()
    let data = md
    if (format === 'text') data = stripMarkdown(md)
    else if (format === 'html' || format === 'pdf') data = buildHtmlDoc(memo.title, md)
    await window.api.export.memo({ title: memo.title, format, data })
  }

  const transcriptHasContent = !!memo && (memo.segments.length > 0 || memo.transcriptMd.trim().length > 0)
  const outlineLive = isRecording && recordingMemoId != null && memo?.id === recordingMemoId

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 px-3 pb-2 pt-2.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
              activeTab === t.id ? 'bg-black/[0.06] text-ink' : 'text-subtle hover:bg-black/[0.04]'
            }`}
          >
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        {/* right-aligned action group: 검색 · 목차 · 더보기(복사·MP4·내보내기) */}
        {activeTab === 'transcript' && (
          <button
            onClick={() => setSearchOpen((v) => !v)}
            className={`rounded-lg p-1.5 transition hover:bg-black/5 ${searchOpen ? 'bg-black/[0.06] text-accent' : 'text-subtle'}`}
            title="전사문에서 검색"
          >
            <Search size={16} />
          </button>
        )}
        {activeTab === 'transcript' && (
          <div className="group/oc relative">
            <button
              onClick={() => void outlineMemo()}
              disabled={busy.outline || !transcriptHasContent || outlineLive || !aiReady}
              className="flex items-center gap-1 rounded-lg px-1.5 py-1.5 text-[11px] text-subtle hover:bg-black/5 disabled:opacity-40"
            >
              {busy.outline ? <Loader2 size={16} className="animate-spin text-subtle" /> : <Sparkles size={16} />}
              <span>목차</span>
            </button>
            <div className="pointer-events-none absolute right-0 top-full z-30 mt-1 hidden w-[210px] rounded-lg bg-ink px-2.5 py-1.5 text-[11.5px] font-normal leading-snug text-white shadow-lg group-hover/oc:block">
              목차 나누기 — 전사문 내용은 그대로 두고 맥락 단위로 목차(부제목)만 삽입해요
            </div>
          </div>
        )}
        <div className="relative" ref={exportRef}>
          <button onClick={() => setExportOpen((v) => !v)} className="rounded-lg p-1.5 text-subtle hover:bg-black/5" title="더보기 (복사 · MP4 · 내보내기)">
            <MoreVertical size={16} />
          </button>
          {exportOpen && (
            <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-xl border border-black/10 bg-white py-1 shadow-lg">
              <button
                onClick={() => {
                  setExportOpen(false)
                  void doCopy()
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-black/5"
              >
                <Copy size={14} className="text-subtle" /> 클립보드 복사
              </button>
              {memo?.audioPath && (
                <button
                  onClick={() => {
                    setExportOpen(false)
                    void doMp4()
                  }}
                  disabled={mp4Saving}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-black/5 disabled:opacity-50"
                >
                  {mp4Saving ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} className="text-subtle" />} 녹음 MP4로 저장
                </button>
              )}
              <div className="my-1 border-t border-black/5" />
              <div className="px-3 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-subtle/70">내보내기</div>
              {(['markdown', 'text', 'html', 'pdf'] as ExportFormat[]).map((f) => (
                <button
                  key={f}
                  onClick={() => doExport(f)}
                  className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-black/5"
                >
                  {f === 'markdown' ? 'Markdown (.md)' : f === 'text' ? '텍스트 (.txt)' : f === 'html' ? 'HTML (.html)' : 'PDF (.pdf)'}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-x-0 top-0 bottom-[88px] overflow-hidden">
          {activeTab === 'transcript' && <TranscriptTab searchOpen={searchOpen} onCloseSearch={() => setSearchOpen(false)} />}
          {activeTab === 'structured' && <StructuredTab />}
          {activeTab === 'raw' && <RawTab />}
          {activeTab === 'bookmarks' && <BookmarksTab />}
        </div>
        <RecordBar />
      </div>
    </div>
  )
}
