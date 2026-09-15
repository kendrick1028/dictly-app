// Viewer body (title · "소스 N개 보기" · per-kind view). The breadcrumb "스튜디오 › {kind}" and the
// item actions (⋮ · 닫기) live in the panel header — exported here as ViewerHeaderCrumb/Actions so
// the Studio panel can place them on its single header row (no duplicate "스튜디오" label).
import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Code2, Copy, FileDown, Image, Loader2, MoreVertical, Send, Trash2, Volume2 } from 'lucide-react'

/** "┘┌" corners-in glyph (NotebookLM-style close/collapse) */
function CornersIn({ size = 14 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 9h-6V3" />
      <path d="M3 15h6v6" />
    </svg>
  )
}
import { useStore } from '../../store/useStore'
import { stripCiteTokens } from '../../lib/citations'
import { downloadStudioImage, downloadStudioPdf, downloadStudioHtml } from '../../lib/studioExport'
import { exportStudioToNotion } from '../../lib/notionExport'
import type { PageSize } from '../../lib/studioHtml'
import { copyText } from '../../lib/clipboard'
import { studioKindLabel } from '../../lib/studioParse'
import { MarkdownMath } from '../MarkdownMath'
import { kindMeta } from './studioMeta'
import { SummaryView } from './views/SummaryView'
import { QuizView } from './views/QuizView'
import { MindmapView } from './views/MindmapView'
import { FlashcardsView } from './views/FlashcardsView'
import { TablesView } from './views/TablesView'
import { MnemonicView } from './views/MnemonicView'
import { FeynmanView } from './views/FeynmanView'
import { ExamRadarView } from './views/ExamRadarView'
import { TutorView } from './views/TutorView'
import { LiveTutorView } from './views/LiveTutorView'
import type { StudioItem, SummaryContent } from '../../../../shared/types'

function itemPlainText(item: StudioItem): string {
  if (item.kind === 'summary') return stripCiteTokens((item.content as SummaryContent).md)
  return stripCiteTokens(JSON.stringify(item.content, null, 2))
}

const goHub = (): void => {
  useStore.setState({ studioFullscreen: false })
  useStore.getState().setStudioView({ mode: 'hub' })
}

/** breadcrumb shown in the Studio panel header: "스튜디오 › {kind}" (스튜디오 → list). */
export function ViewerHeaderCrumb({ item }: { item: StudioItem }): JSX.Element {
  const meta = kindMeta(item.kind)
  return (
    <div className="flex min-w-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-wide">
      <button onClick={goHub} className="rounded px-0.5 text-subtle hover:text-ink" title="스튜디오 목록으로">
        스튜디오
      </button>
      <ChevronRight size={11} className="shrink-0 text-subtle/60" />
      <span className={`truncate ${meta.tint}`}>{studioKindLabel(item.kind)}</span>
    </div>
  )
}

/** item actions for the Studio panel header: ┘┌ close-to-list + ⋮ (download/copy/delete). */
export function ViewerHeaderActions({ item }: { item: StudioItem }): JSX.Element {
  const deleteStudioItemAction = useStore((s) => s.deleteStudioItemAction)
  const requestConfirm = useStore((s) => s.requestConfirm)
  const showToast = useStore((s) => s.showToast)
  const [menuOpen, setMenuOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [pageSize, setPageSize] = useState<PageSize>('a4')
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const h = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [menuOpen])

  const runExport = async (fn: (it: StudioItem) => Promise<void>, label: string): Promise<void> => {
    setMenuOpen(false)
    setExporting(true)
    try {
      await fn(item)
    } catch (e) {
      showToast(`${label} 실패: ${(e as Error).message}`)
    } finally {
      setExporting(false)
    }
  }

  const ItemBtn = ({ icon, label, danger, onClick }: { icon: JSX.Element; label: string; danger?: boolean; onClick: () => void }): JSX.Element => (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] ${danger ? 'text-red-500 hover:bg-red-50' : 'text-ink hover:bg-black/5'}`}
    >
      {icon} {label}
    </button>
  )

  return (
    <>
      <button
        onClick={() => void copyText(itemPlainText(item))}
        className="rounded p-1 text-subtle hover:bg-black/5"
        title="내용 복사"
      >
        <Copy size={14} />
      </button>
      <button onClick={goHub} className="rounded p-1 text-subtle hover:bg-black/5" title="스튜디오 메모 닫기 (목록으로)">
        <CornersIn size={14} />
      </button>
      <div className="relative" ref={menuRef}>
        <button onClick={() => setMenuOpen((v) => !v)} disabled={exporting} className="rounded p-1 text-subtle hover:bg-black/5 disabled:opacity-50" title="더보기">
          {exporting ? <Loader2 size={15} className="animate-spin" /> : <MoreVertical size={15} />}
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full z-30 mt-1 w-48 rounded-lg border border-black/10 bg-white py-1 shadow-lg">
            {/* paper size for PDF/HTML downloads */}
            <div className="flex items-center justify-between px-3 py-1.5">
              <span className="text-[11px] text-subtle">용지</span>
              <div className="flex overflow-hidden rounded-md border border-black/10">
                {(['a4', 'b5'] as PageSize[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setPageSize(s)}
                    className={`px-2 py-0.5 text-[11px] uppercase ${pageSize === s ? 'bg-accent text-white' : 'text-subtle hover:bg-black/5'}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="my-1 h-px bg-black/5" />
            <ItemBtn icon={<FileDown size={12} />} label="PDF로 다운로드" onClick={() => void runExport((it) => downloadStudioPdf(it, pageSize), 'PDF 저장')} />
            <ItemBtn icon={<Code2 size={12} />} label="HTML로 다운로드" onClick={() => void runExport((it) => downloadStudioHtml(it, pageSize), 'HTML 저장')} />
            <ItemBtn icon={<Image size={12} />} label="이미지로 다운로드" onClick={() => void runExport(downloadStudioImage, '이미지 저장')} />
            <div className="my-1 h-px bg-black/5" />
            <ItemBtn
              icon={<Send size={12} />}
              label="Notion으로 내보내기"
              onClick={() => void runExport(async (it) => void (await exportStudioToNotion(it)), 'Notion 내보내기')}
            />
            <div className="my-1 h-px bg-black/5" />
            <ItemBtn
              icon={<Copy size={12} />}
              label="내용 복사"
              onClick={() => {
                setMenuOpen(false)
                void copyText(itemPlainText(item))
              }}
            />
            <ItemBtn
              icon={<Trash2 size={12} />}
              label="삭제"
              danger
              onClick={() => {
                setMenuOpen(false)
                requestConfirm(`'${item.title}' 스튜디오 메모를 삭제할까요?`, () => void deleteStudioItemAction(item.id))
              }}
            />
          </div>
        )}
      </div>
    </>
  )
}

export function StudioMemoViewer({ itemId }: { itemId: number }): JSX.Element {
  const item = useStore((s) => s.studioItems.find((x) => x.id === itemId) ?? null)
  const setStudioView = useStore((s) => s.setStudioView)
  const [srcOpen, setSrcOpen] = useState(false)
  const srcRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!srcOpen) return
    const h = (e: MouseEvent): void => {
      if (srcRef.current && !srcRef.current.contains(e.target as Node)) setSrcOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [srcOpen])

  if (!item) {
    // deleted or memo switched — fall back to hub
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-subtle">
        <button onClick={() => setStudioView({ mode: 'hub' })} className="rounded-lg border border-black/10 bg-white px-3 py-1.5 hover:bg-black/5">
          스튜디오로 돌아가기
        </button>
      </div>
    )
  }

  const meta = kindMeta(item.kind)

  return (
    <div className="dictly-anim-in flex h-full min-h-0 flex-col">
      {/* title (+ ⋮·닫기, right-aligned) + sources chip — breadcrumb lives in the panel header */}
      <div className="shrink-0 px-3.5 pb-2 pt-1.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <MarkdownMath className="!text-[15px] font-semibold leading-snug text-ink [&_p]:!my-0">{stripCiteTokens(item.title)}</MarkdownMath>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <ViewerHeaderActions item={item} />
          </div>
        </div>
        <div className="relative mt-1.5" ref={srcRef}>
          <button
            onClick={() => setSrcOpen((v) => !v)}
            className="rounded-full border border-black/10 bg-white px-2.5 py-1 text-[11px] text-subtle hover:bg-black/5"
          >
            소스 {item.sources.sourceCount}개 보기
          </button>
          {srcOpen && (
            <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded-lg border border-black/10 bg-white py-1.5 shadow-lg">
              {item.sources.sourceCount - item.sources.pdfs.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-1 text-[11.5px] text-ink">
                  <Volume2 size={12} className="shrink-0 text-accent" /> 전사문 (녹음)
                </div>
              )}
              {item.sources.pdfs.map((p) => (
                <div key={p.index} className="flex items-center gap-2 px-3 py-1 text-[11.5px] text-ink">
                  <meta.Icon size={12} className="shrink-0 text-subtle" />
                  <span className="truncate">{p.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div data-studio-export className="min-h-0 flex-1 overflow-hidden border-t border-black/5">
        {item.kind === 'summary' && <SummaryView item={item} />}
        {item.kind === 'quiz' && <QuizView item={item} />}
        {item.kind === 'mindmap' && <MindmapView item={item} />}
        {item.kind === 'flashcards' && <FlashcardsView item={item} />}
        {item.kind === 'table' && <TablesView item={item} />}
        {item.kind === 'mnemonic' && <MnemonicView item={item} />}
        {item.kind === 'feynman' && <FeynmanView item={item} />}
        {item.kind === 'exam_radar' && <ExamRadarView item={item} />}
        {item.kind === 'tutor' && <TutorView item={item} />}
        {item.kind === 'live_tutor' && <LiveTutorView item={item} />}
      </div>
    </div>
  )
}
