import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2, X, Volume2, ChevronDown, Sparkles, Loader2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import { usePdfDoc } from '../pdf/usePdfDoc'
import { renderPagePng } from '../lib/pdfText'
import { PdfAnnotationLayer } from './PdfAnnotationLayer'
import { PdfAnnotationToolbar } from './PdfAnnotationToolbar'
import { fmtClock } from '../lib/time'
import type { PDFDocumentProxy } from '../pdf/pdfjs-setup'

const GAP = 12 // px between pages in the continuous scroll

/** Renders one page to a canvas; cancels the render task on unmount (virtualization churn). */
function PdfPageCanvas({
  doc,
  pageNum,
  scale,
  cssW,
  cssH
}: {
  doc: PDFDocumentProxy
  pageNum: number
  scale: number
  cssW: number
  cssH: number
}): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let cancelled = false
    let task: { cancel: () => void } | null = null
    void (async () => {
      try {
        const page = await doc.getPage(pageNum)
        if (cancelled) return
        const canvas = ref.current
        if (!canvas) return
        const dpr = window.devicePixelRatio || 1
        const viewport = page.getViewport({ scale: scale * dpr })
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        canvas.width = viewport.width
        canvas.height = viewport.height
        const rt = page.render({ canvasContext: ctx, viewport })
        task = rt
        await rt.promise
      } catch {
        /* RenderingCancelledException expected when scrolled out / rescaled */
      }
    })()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, pageNum, scale])
  return (
    <canvas
      ref={ref}
      style={{ width: cssW, height: cssH }}
      className="block rounded bg-white shadow-md ring-1 ring-black/5"
    />
  )
}

/** One PDF pane: light, continuous vertical scroll (virtualized), pinch/zoom, focus ring, and a
 *  per-page "녹음" dropdown (reverse sync) that seeks audio. */
export function PdfViewer({ pdfId, showFocus = false }: { pdfId: number; showFocus?: boolean }): JSX.Element {
  const meta = useStore((s) => s.memo?.pdfs.find((p) => p.id === pdfId) ?? null)
  const focusedPdfId = useStore((s) => s.focusedPdfId)
  const setFocusedPdf = useStore((s) => s.setFocusedPdf)
  const setCurrentPdfPage = useStore((s) => s.setCurrentPdfPage)
  const closePdf = useStore((s) => s.closePdf)
  const storePage = useStore((s) => s.currentPdfPage[pdfId])
  const setTab = useStore((s) => s.setTab)
  const requestAudioSeek = useStore((s) => s.requestAudioSeek)
  const undoAnnotation = useStore((s) => s.undoAnnotation)
  const redoAnnotation = useStore((s) => s.redoAnnotation)
  const annTool = useStore((s) => s.annTool)
  const panRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null)
  const [panning, setPanning] = useState(false)
  const segments = useStore((s) => s.memo?.segments)
  const liveSegments = useStore((s) => s.rec.liveSegments)
  const recordingThis = useStore((s) => s.recordingMemoId != null && s.recordingMemoId === s.memo?.id)

  const { doc, numPages, loading, error } = usePdfDoc(meta?.path ?? null)
  const [unit, setUnit] = useState<{ w: number; h: number } | null>(null)
  const [wrapW, setWrapW] = useState(0)
  const [scale, setScale] = useState<number | 'fit'>('fit')
  const [currentPage, setCurrentPage] = useState(storePage ?? 1)
  const [pageDraft, setPageDraft] = useState<string | null>(null) // raw input text while editing the page field
  const [range, setRange] = useState<[number, number]>([1, 3])
  const [markersOpen, setMarkersOpen] = useState(false)
  const [markersPos, setMarkersPos] = useState<{ top: number; right: number } | null>(null)
  const [extracting, setExtracting] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const markersRef = useRef<HTMLDivElement>(null)
  const markersBtnRef = useRef<HTMLButtonElement>(null)
  const markersPopRef = useRef<HTMLDivElement>(null)
  const lastFitRef = useRef(1)
  const curRef = useRef(currentPage)
  const rowHRef = useRef(0)
  const scaleRef = useRef<number | 'fit'>(scale)

  const focused = focusedPdfId === pdfId
  const total = numPages || meta?.pageCount || 0

  // page-1 size → uniform slot aspect (lecture PDFs are uniform; corrected per-canvas on render)
  useEffect(() => {
    if (!doc) return
    let cancelled = false
    void (async () => {
      const p = await doc.getPage(1)
      if (cancelled) return
      const v = p.getViewport({ scale: 1 })
      setUnit({ w: v.width, h: v.height })
    })()
    return () => {
      cancelled = true
    }
  }, [doc])

  useEffect(() => {
    if (numPages > 0 && meta && meta.pageCount === 0) void window.api.pdfs.setPageCount(pdfId, numPages)
  }, [numPages, meta, pdfId])

  // track container width (fit-width + panel resize)
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    setWrapW(wrap.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setWrapW(wrap.clientWidth))
    })
    ro.observe(wrap)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [doc])

  const fitScale = unit && wrapW ? Math.max(0.1, (wrapW - 24) / unit.w) : 1
  const effScale = scale === 'fit' ? fitScale : scale
  const pageW = unit ? unit.w * effScale : 0
  const pageH = unit ? unit.h * effScale : 0
  const rowH = pageH + GAP
  rowHRef.current = rowH

  // decouple LAYOUT scale (immediate — page boxes/annotations track the gesture) from the pdf.js
  // RENDER scale (debounced — the existing canvas is CSS-stretched during a pinch, then re-rendered
  // sharp once at gesture end instead of once per wheel tick)
  const [renderScale, setRenderScale] = useState(effScale)
  useEffect(() => {
    if (renderScale === effScale) return
    const t = setTimeout(() => setRenderScale(effScale), 160)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effScale])

  useEffect(() => {
    if (scale === 'fit') lastFitRef.current = fitScale
    scaleRef.current = scale
  }, [fitScale, scale])

  // trackpad pinch-zoom (Chromium maps pinch → ctrl+wheel); native non-passive listener so we
  // can preventDefault. Normal (non-ctrl) wheel keeps scrolling the pages continuously.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const base = scaleRef.current === 'fit' ? lastFitRef.current : scaleRef.current
      setScale(Math.min(5, Math.max(0.2, base * (1 - e.deltaY * 0.01))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // recompute the visible page range whenever layout changes
  useEffect(() => {
    const el = wrapRef.current
    if (!el || !rowH || !total) return
    const first = Math.max(1, Math.floor(el.scrollTop / rowH) + 1)
    const last = Math.min(total, Math.floor((el.scrollTop + el.clientHeight) / rowH) + 1)
    setRange([Math.max(1, first - 1), Math.min(total, last + 1)])
  }, [rowH, total])

  const onScroll = (): void => {
    const el = wrapRef.current
    const rh = rowHRef.current
    if (!el || !rh || !total) return
    const first = Math.max(1, Math.floor(el.scrollTop / rh) + 1)
    const last = Math.min(total, Math.floor((el.scrollTop + el.clientHeight) / rh) + 1)
    setRange([Math.max(1, first - 1), Math.min(total, last + 1)])
    if (first !== curRef.current) {
      curRef.current = first
      setCurrentPage(first)
      setCurrentPdfPage(pdfId, first)
      setMarkersOpen(false)
    }
  }

  useEffect(() => {
    if (doc) setCurrentPdfPage(pdfId, curRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc])

  // external page jump (transcript badge) → scroll to it
  useEffect(() => {
    if (!storePage || storePage === curRef.current) return
    const el = wrapRef.current
    if (el && rowHRef.current) {
      el.scrollTop = (storePage - 1) * rowHRef.current
      curRef.current = storePage
      setCurrentPage(storePage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storePage])

  // keep the current page anchored across zoom changes
  useEffect(() => {
    const el = wrapRef.current
    if (el && rowHRef.current) el.scrollTop = (curRef.current - 1) * rowHRef.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effScale])

  const go = (p: number): void => {
    const np = Math.min(Math.max(1, Math.round(p) || 1), total || p)
    const el = wrapRef.current
    if (el && rowHRef.current) el.scrollTop = (np - 1) * rowHRef.current
    curRef.current = np
    setCurrentPage(np)
    setCurrentPdfPage(pdfId, np)
  }

  const zoomIn = (): void => setScale((s) => Math.min(5, (s === 'fit' ? lastFitRef.current : s) * 1.2))
  const zoomOut = (): void => setScale((s) => Math.max(0.2, (s === 'fit' ? lastFitRef.current : s) / 1.2))

  // extract keywords from THIS PDF (text layer, or CLI vision for image/scanned PDFs) → merge
  // into the current agent's transcription keywords
  const extract = async (): Promise<void> => {
    if (!doc || !meta) return
    const st = useStore.getState()
    const agent = st.agents.find((a) => a.id === (st.memo?.agentId ?? st.activeAgentId))
    if (!agent) {
      st.showToast('에이전트를 먼저 선택하세요')
      return
    }
    setExtracting(true)
    try {
      const maxPages = Math.min(doc.numPages, 40)
      let text = ''
      for (let i = 1; i <= maxPages && text.length < 24000; i++) {
        const pg = await doc.getPage(i)
        const tc = await pg.getTextContent()
        text += tc.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n'
      }
      let raw: string
      if (text.trim().length >= 200) {
        raw = await window.api.claude.extractKeywords(text, agent.systemPrompt ?? '')
      } else {
        st.showToast('이미지 PDF 분석 중… (CLI 비전)')
        const images: Uint8Array[] = []
        const n = Math.min(doc.numPages, 4)
        for (let i = 1; i <= n; i++) {
          const png = await renderPagePng(doc, i)
          if (png) images.push(png)
        }
        if (!images.length) {
          st.showToast('PDF 페이지를 이미지로 변환하지 못했습니다')
          return
        }
        raw = await window.api.pdfs.extractKeywordsFromImages(images, agent.systemPrompt ?? '')
      }
      const extracted = raw
        .replace(/```/g, '')
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
      if (!extracted.length) {
        st.showToast('키워드를 추출하지 못했습니다')
        return
      }
      const merged = Array.from(new Set([...agent.keywords, ...extracted]))
      const added = merged.length - agent.keywords.length
      await window.api.agents.update(agent.id, {
        name: agent.name,
        keywords: merged,
        correctionKeywords: agent.correctionKeywords,
        mathRules: agent.mathRules,
        replacements: agent.replacements,
        systemPrompt: agent.systemPrompt
      })
      await st.refreshAgents()
      st.showToast(added > 0 ? `키워드 ${added}개를 '${agent.name}'에 추가했어요` : '새로 추가할 키워드가 없어요')
    } catch (e) {
      useStore.getState().showToast(`키워드 추출 실패: ${(e as Error).message}`)
    } finally {
      setExtracting(false)
    }
  }

  const pageMarkers = useMemo(() => {
    const all = [...(segments ?? []), ...(recordingThis ? liveSegments : [])]
    return all.filter((s) => s.pdfId === pdfId && s.pdfPage === currentPage && s.text.trim())
  }, [segments, liveSegments, recordingThis, pdfId, currentPage])

  useEffect(() => {
    if (!markersOpen) return
    const h = (e: MouseEvent): void => {
      const t = e.target as Node
      if (markersRef.current?.contains(t) || markersPopRef.current?.contains(t)) return
      setMarkersOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [markersOpen])

  // ⌘Z undo / ⌘⇧Z redo on the focused viewer
  useEffect(() => {
    if (!focused) return
    const h = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redoAnnotation(pdfId)
        else undoAnnotation(pdfId)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [focused, pdfId, undoAnnotation, redoAnnotation])

  const pages: number[] = []
  for (let i = range[0]; i <= range[1]; i++) pages.push(i)

  return (
    <div
      onMouseDown={() => setFocusedPdf(pdfId)}
      className="group relative flex h-full min-h-0 flex-col overflow-hidden bg-canvas"
    >
      {/* toolbar: filename (left) · 녹음 dropdown + page nav + close (right) */}
      <div className="flex shrink-0 items-center gap-1 border-b border-black/5 bg-panel px-2 py-1 text-subtle">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {showFocus && focused && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />}
          <span
            className={`min-w-0 flex-1 truncate text-[11px] ${showFocus && focused ? 'font-medium text-ink' : 'text-subtle/70'}`}
            title={meta?.name}
          >
            {meta?.name}
          </span>
        </div>

        <button
          onClick={extract}
          disabled={extracting}
          className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-50"
          title="이 PDF에서 키워드를 추출해 현재 에이전트에 추가 (이미지 PDF는 CLI 비전)"
        >
          {extracting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          키워드
        </button>

        {pageMarkers.length > 0 && (
          <div className="relative" ref={markersRef}>
            <button
              ref={markersBtnRef}
              onClick={() => {
                if (markersOpen) {
                  setMarkersOpen(false)
                  return
                }
                const r = markersBtnRef.current?.getBoundingClientRect()
                if (r) setMarkersPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) })
                setMarkersOpen(true)
              }}
              className="flex items-center gap-1 rounded-md bg-accent/10 px-2 py-0.5 text-[11px] text-accent hover:bg-accent/20"
              title="이 페이지에 연결된 녹음 구간"
            >
              <Volume2 size={11} /> 녹음 {pageMarkers.length}
              <ChevronDown size={11} className={`transition ${markersOpen ? 'rotate-180' : ''}`} />
            </button>
            {markersOpen &&
              markersPos &&
              createPortal(
                <div
                  ref={markersPopRef}
                  className="fixed z-[80] max-h-52 w-60 overflow-auto rounded-lg border border-black/10 bg-white py-1 shadow-lg"
                  style={{ top: markersPos.top, right: markersPos.right }}
                >
                  {pageMarkers.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setTab('transcript')
                        requestAudioSeek(s.tStart)
                        setMarkersOpen(false)
                      }}
                      className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left hover:bg-black/5"
                      title="이 청크 음성으로 이동"
                    >
                      <span className="mt-px shrink-0 tabular-nums text-[11px] font-medium text-accent">{fmtClock(s.tStart)}</span>
                      <span className="line-clamp-2 text-[11px] text-subtle">{s.text.replace(/[#*<>`]/g, '').trim().slice(0, 70)}</span>
                    </button>
                  ))}
                </div>,
                document.body,
              )}
          </div>
        )}

        <div className="mx-0.5 h-4 w-px bg-black/10" />
        <button onClick={() => go(currentPage - 1)} disabled={currentPage <= 1} className="rounded-md p-1 hover:bg-black/5 disabled:opacity-30">
          <ChevronLeft size={15} />
        </button>
        <input
          type="text"
          inputMode="numeric"
          value={pageDraft ?? String(currentPage)}
          onFocus={(e) => {
            setPageDraft(String(currentPage))
            e.currentTarget.select()
          }}
          onChange={(e) => setPageDraft(e.target.value.replace(/[^0-9]/g, ''))}
          onBlur={() => {
            if (pageDraft && pageDraft !== '') go(Number(pageDraft))
            setPageDraft(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            else if (e.key === 'Escape') {
              setPageDraft(null)
              e.currentTarget.blur()
            }
          }}
          className="w-12 rounded-md bg-black/[0.04] px-1 py-0.5 text-center text-[11px] tabular-nums text-ink outline-none focus:bg-black/[0.07]"
        />
        <span className="text-[11px] text-subtle">/ {total || '?'}</span>
        <button
          onClick={() => go(currentPage + 1)}
          disabled={total > 0 && currentPage >= total}
          className="rounded-md p-1 hover:bg-black/5 disabled:opacity-30"
        >
          <ChevronRight size={15} />
        </button>
        <button onClick={() => closePdf(pdfId)} className="rounded-md p-1 hover:bg-black/5" title="이 PDF 닫기">
          <X size={14} />
        </button>
      </div>

      <PdfAnnotationToolbar pdfId={pdfId} />

      {/* continuous scroll area (virtualized; ctrl+wheel / pinch zooms) */}
      <div
        ref={wrapRef}
        onScroll={onScroll}
        onPointerDown={(e) => {
          // pan with select tool; also pan when a draw tool is active but THIS pdf isn't focused
          // (its annotation layer is pass-through, so the drag would otherwise be dead)
          if (annTool !== 'none' && focused) return
          const tg = (e.target as Element).tagName.toLowerCase()
          if (['path', 'rect', 'polyline', 'circle', 'line'].includes(tg)) return // let strokes handle clicks
          if ((e.target as Element).closest('[data-memobadge]')) return
          const el = wrapRef.current
          if (!el) return
          panRef.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop }
          setPanning(true)
          el.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const pan = panRef.current
          const el = wrapRef.current
          if (!pan || !el) return
          el.scrollLeft = pan.sl - (e.clientX - pan.x)
          el.scrollTop = pan.st - (e.clientY - pan.y)
        }}
        onPointerUp={(e) => {
          if (panRef.current) {
            panRef.current = null
            setPanning(false)
            wrapRef.current?.releasePointerCapture(e.pointerId)
          }
        }}
        className={`min-h-0 flex-1 overflow-auto p-3 ${annTool === 'none' || !focused ? (panning ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
      >
        {(loading || (!unit && !error)) && <div className="pt-8 text-center text-[12px] text-subtle">PDF 불러오는 중…</div>}
        {error && <div className="pt-8 text-center text-[12px] text-red-500">{error}</div>}
        {doc && unit && total > 0 && (
          <div style={{ position: 'relative', width: pageW, height: Math.max(0, total * rowH - GAP), margin: '0 auto' }}>
            {pages.map((i) => (
              <div key={i} style={{ position: 'absolute', top: (i - 1) * rowH, left: 0, width: pageW, height: pageH }}>
                <PdfPageCanvas doc={doc} pageNum={i} scale={renderScale} cssW={pageW} cssH={pageH} />
                <PdfAnnotationLayer doc={doc} pdfId={pdfId} page={i} pageW={pageW} pageH={pageH} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* floating zoom toolbox — hidden until you hover the viewer (bottom-right) */}
      <div className="pointer-events-none absolute bottom-3 right-3 z-20 flex items-center gap-0.5 rounded-full border border-black/10 bg-white/95 px-1 py-1 opacity-0 shadow-lg backdrop-blur transition group-hover:pointer-events-auto group-hover:opacity-100">
        <button onClick={zoomOut} className="rounded-full p-1.5 text-subtle hover:bg-black/5" title="축소">
          <ZoomOut size={15} />
        </button>
        <button onClick={() => setScale('fit')} className="rounded-full p-1.5 text-subtle hover:bg-black/5" title="너비 맞춤">
          <Maximize2 size={14} />
        </button>
        <button onClick={zoomIn} className="rounded-full p-1.5 text-subtle hover:bg-black/5" title="확대">
          <ZoomIn size={15} />
        </button>
      </div>
    </div>
  )
}
