import { useEffect, useRef, useState } from 'react'
import { Panel, PanelGroup } from 'react-resizable-panels'
import { FileText, FolderOpen, ChevronDown, Check, Loader2, Plus, X } from 'lucide-react'
import { useStore } from '../store/useStore'
import { PdfViewer } from './PdfViewer'
import { ResizeHandle } from './ResizeHandle'

/** Top-of-left PDF section: PDF selector dropdown + attach + close. (Keyword extraction lives in
 *  each PdfViewer's own toolbar now — per-PDF.) */
export function PdfSection(): JSX.Element {
  const memoId = useStore((s) => s.memo?.id ?? null)
  const pdfs = useStore((s) => s.memo?.pdfs ?? [])
  const openPdfIds = useStore((s) => s.openPdfIds)
  const openPdf = useStore((s) => s.openPdf)
  const closePdf = useStore((s) => s.closePdf)
  const reloadMemo = useStore((s) => s.reloadMemo)
  const showToast = useStore((s) => s.showToast)
  const panelPdf2 = useStore((s) => s.panelSizes['memo.pdf2'])
  const setPanelSizes = useStore((s) => s.setPanelSizes)
  const focusedPdfId = useStore((s) => s.focusedPdfId)
  const setPdfSectionOpen = useStore((s) => s.setPdfSectionOpen)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const focusedName = pdfs.find((p) => p.id === (focusedPdfId ?? openPdfIds[0]))?.name

  const attach = async (): Promise<void> => {
    if (memoId == null || attaching) return
    setAttaching(true)
    try {
      const added = await window.api.pdfs.addToMemo(memoId)
      if (added.length) {
        await reloadMemo()
        added.forEach((p) => openPdf(p.id))
        showToast(added.length === 1 ? `'${added[0].name}' 첨부됨` : `PDF ${added.length}개 첨부됨`)
      }
    } catch (e) {
      showToast(`PDF 첨부 실패: ${(e as Error).message}`)
    } finally {
      setAttaching(false)
    }
  }

  useEffect(() => {
    if (!pickerOpen) return
    const h = (e: MouseEvent): void => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [pickerOpen])

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      {/* toolbar: PDF selector dropdown · 닫기 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-black/5 px-2 py-1.5">
        <div className="relative" ref={pickerRef}>
          <button
            onClick={() => setPickerOpen((v) => !v)}
            className="flex items-center gap-1 rounded-md bg-black/[0.05] px-2 py-1 text-[11px] text-ink hover:bg-black/10"
            title="PDF 선택"
          >
            <FileText size={12} className="text-subtle" />
            <span className="max-w-[150px] truncate">{focusedName ?? (pdfs.length ? 'PDF 선택' : 'PDF 없음')}</span>
            <ChevronDown size={11} className={`text-subtle transition ${pickerOpen ? 'rotate-180' : ''}`} />
          </button>
          {pickerOpen && (
            <div className="absolute left-0 z-30 mt-1 max-h-60 w-64 overflow-auto rounded-lg border border-black/10 bg-white py-1 shadow-lg">
              {pdfs.length === 0 && <div className="px-3 py-1.5 text-[11px] text-subtle">사이드바에서 노트·폴더에 PDF를 첨부하세요</div>}
              {pdfs.map((p) => {
                const open = openPdfIds.includes(p.id)
                return (
                  <button
                    key={p.id}
                    onClick={() => (open ? closePdf(p.id) : openPdf(p.id))}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-black/5"
                    title={p.inherited ? `폴더 PDF: ${p.name}` : p.name}
                  >
                    <Check size={13} className={open ? 'shrink-0 text-accent' : 'shrink-0 text-transparent'} />
                    {p.inherited ? <FolderOpen size={12} className="shrink-0 text-subtle" /> : <FileText size={12} className="shrink-0 text-subtle" />}
                    <span className="flex-1 truncate">{p.name}</span>
                  </button>
                )
              })}
              {pdfs.length > 0 && (
                <div className="mt-1 border-t border-black/5 px-3 pt-1 text-[10px] text-subtle">최대 2개까지 동시에 볼 수 있어요</div>
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => void attach()}
          disabled={attaching || memoId == null}
          className="flex items-center gap-0.5 rounded-md p-1 text-subtle hover:bg-black/5 disabled:opacity-40"
          title="이 노트에 새 PDF 첨부"
        >
          {attaching ? <Loader2 size={14} className="animate-spin" /> : <Plus size={15} />}
        </button>
        <div className="flex-1" />
        <button onClick={() => setPdfSectionOpen(false)} className="rounded-md p-1 text-subtle hover:bg-black/5" title="PDF 섹션 닫기">
          <X size={15} />
        </button>
      </div>

      {/* viewers */}
      {openPdfIds.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-[12px] text-subtle">
          {pdfs.length > 0 ? '위에서 PDF를 선택해 여세요 (최대 2개)' : '첨부된 PDF가 없습니다'}
        </div>
      ) : openPdfIds.length === 1 ? (
        <div className="min-h-0 flex-1">
          <PdfViewer pdfId={openPdfIds[0]} />
        </div>
      ) : (
        // two PDFs → distinct rounded cards stacked vertically on a gray gap
        <div className="min-h-0 flex-1 bg-canvas p-1.5">
          <PanelGroup direction="vertical" className="h-full" onLayout={(s) => setPanelSizes('memo.pdf2', s)}>
            <Panel defaultSize={panelPdf2?.[0] ?? 50} minSize={15} className="min-h-0">
              <div className="h-full overflow-hidden rounded-xl border border-black/5 shadow-sm">
                <PdfViewer pdfId={openPdfIds[0]} showFocus />
              </div>
            </Panel>
            <ResizeHandle dir="v" />
            <Panel defaultSize={panelPdf2?.[1] ?? 50} minSize={15} className="min-h-0">
              <div className="h-full overflow-hidden rounded-xl border border-black/5 shadow-sm">
                <PdfViewer pdfId={openPdfIds[1]} showFocus />
              </div>
            </Panel>
          </PanelGroup>
        </div>
      )}
    </div>
  )
}
