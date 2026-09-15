import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MousePointer2, Pen, Highlighter, Eraser, Underline, StickyNote, Lasso, Ruler, Undo2, Redo2, Type, PanelLeft, PanelTop } from 'lucide-react'
import { useStore } from '../store/useStore'

type Tool = 'none' | 'pen' | 'highlighter' | 'eraser' | 'underline' | 'memo' | 'lasso' | 'text'
const TOOLS: { id: Tool; Icon: typeof Pen; label: string }[] = [
  { id: 'none', Icon: MousePointer2, label: '선택/이동' },
  { id: 'pen', Icon: Pen, label: '펜' },
  { id: 'highlighter', Icon: Highlighter, label: '형광펜' },
  { id: 'eraser', Icon: Eraser, label: '지우개' },
  { id: 'underline', Icon: Underline, label: '밑줄' },
  { id: 'text', Icon: Type, label: '텍스트 (클릭한 곳에 입력)' },
  { id: 'memo', Icon: StickyNote, label: '메모' },
  { id: 'lasso', Icon: Lasso, label: '올가미' }
]
const TEXT_SIZES: { v: number; label: string }[] = [
  { v: 0.012, label: '작게' },
  { v: 0.018, label: '보통' },
  { v: 0.026, label: '크게' },
  { v: 0.036, label: '아주 크게' }
]
const POS_KEY = 'dictly.annToolbarPos'
const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#6366f1', '#ec4899', '#6b7280', '#111827']
const WIDTHS: { v: number; label: string }[] = [
  { v: 0.0012, label: '아주 얇게' },
  { v: 0.002, label: '얇게' },
  { v: 0.003, label: '보통' },
  { v: 0.0045, label: '굵게' },
  { v: 0.007, label: '아주 굵게' }
]

/** Floating pill annotation toolbar (overlaid on the PDF, not fixed to the title bar). */
export function PdfAnnotationToolbar({ pdfId }: { pdfId: number }): JSX.Element {
  const tool = useStore((s) => s.annTool)
  const setTool = useStore((s) => s.setAnnTool)
  const color = useStore((s) => s.annColor)
  const setColor = useStore((s) => s.setAnnColor)
  const annWidth = useStore((s) => s.annWidth)
  const setWidth = useStore((s) => s.setAnnWidth)
  const ruler = useStore((s) => s.annRuler)
  const toggleRuler = useStore((s) => s.toggleAnnRuler)
  const undo = useStore((s) => s.undoAnnotation)
  const redo = useStore((s) => s.redoAnnotation)
  const canUndo = useStore((s) => (s.annUndo[pdfId]?.length ?? 0) > 0)
  const canRedo = useStore((s) => (s.annRedo[pdfId]?.length ?? 0) > 0)
  const textSize = useStore((s) => s.annTextSize)
  const setTextSize = useStore((s) => s.setAnnTextSize)
  // where the pill docks: top (horizontal, default) or left (vertical) — remembered
  const [pos, setPos] = useState<'top' | 'left'>(() => (localStorage.getItem(POS_KEY) === 'left' ? 'left' : 'top'))
  const togglePos = (): void => {
    const next = pos === 'top' ? 'left' : 'top'
    localStorage.setItem(POS_KEY, next)
    setPos(next)
    setPop(null)
  }
  const vertical = pos === 'left'

  // dropdowns render in a body portal at fixed coords (the pill clips absolute children)
  const [pop, setPop] = useState<{ kind: 'color' | 'width' | 'text'; x: number; y: number } | null>(null)
  const popRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!pop) return
    const h = (e: MouseEvent): void => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setPop(null)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [pop])

  const openPop = (kind: 'color' | 'width' | 'text', e: React.MouseEvent): void => {
    if (pop?.kind === kind) {
      setPop(null)
      return
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    // top dock: below the button, centered · left dock: to the right of the button
    setPop(vertical ? { kind, x: r.right + 8, y: r.top } : { kind, x: r.left + r.width / 2, y: r.bottom })
  }

  const showStyle = tool === 'pen' || tool === 'highlighter' || tool === 'underline' || tool === 'text'
  const Divider = (): JSX.Element => <div className={`shrink-0 bg-black/10 ${vertical ? 'my-0.5 h-px w-4' : 'mx-0.5 h-4 w-px'}`} />

  return (
    // pill: horizontal row along the top, or a vertical column docked at the left
    <div
      className={`dictly-anim-in absolute z-30 flex items-center justify-center gap-0 rounded-full border border-black/10 bg-white/95 shadow-lg backdrop-blur ${
        vertical ? 'left-2 top-10 max-h-[85%] flex-col overflow-y-auto px-1 py-1.5 dictly-no-scrollbar' : 'left-0 right-0 top-10 mx-auto w-fit max-w-[98%] overflow-x-auto px-1.5 py-1'
      }`}
    >
      {TOOLS.map(({ id, Icon, label }) => (
        <button
          key={id}
          onClick={() => setTool(id === tool ? 'none' : id)}
          title={label}
          className={`shrink-0 rounded-full p-1 transition ${tool === id ? 'bg-accent/15 text-accent' : 'text-subtle hover:bg-black/5'}`}
        >
          <Icon size={14} />
        </button>
      ))}
      <Divider />
      <button onClick={toggleRuler} title="자 (직선)" className={`shrink-0 rounded-full p-1 transition ${ruler ? 'bg-accent/15 text-accent' : 'text-subtle hover:bg-black/5'}`}>
        <Ruler size={14} />
      </button>
      {tool === 'text' && (
        <button onClick={(e) => openPop('text', e)} className="flex shrink-0 items-center rounded-full px-1.5 py-1 text-[11px] font-semibold text-subtle hover:bg-black/5" title="글자 크기 (새 텍스트 기본값)">
          Aa
        </button>
      )}

      <div className={`flex shrink-0 items-center gap-0 ${vertical ? 'flex-col' : ''}`}>
        <button onClick={(e) => openPop('color', e)} className={`flex items-center rounded-full p-1 hover:bg-black/5 ${showStyle ? '' : 'opacity-40'}`} title="색">
          <span className="h-3.5 w-3.5 rounded-full ring-1 ring-black/15" style={{ background: color }} />
        </button>
        <button
          onClick={(e) => openPop('width', e)}
          className={`flex h-6 w-5 items-center justify-center rounded-full hover:bg-black/5 ${showStyle ? '' : 'opacity-40'}`}
          title="굵기"
        >
          <span className="rounded-full bg-ink" style={{ width: Math.max(3, annWidth * 700), height: Math.max(3, annWidth * 700) }} />
        </button>
      </div>
      {pop &&
        createPortal(
          <div
            ref={popRef}
            style={vertical ? { position: 'fixed', left: pop.x, top: pop.y } : { position: 'fixed', left: pop.x, top: pop.y + 6, transform: 'translateX(-50%)' }}
            className="dictly-anim-in z-[70]"
          >
            {pop.kind === 'text' ? (
              <div className="flex flex-col rounded-xl border border-black/10 bg-white py-1 shadow-xl">
                {TEXT_SIZES.map((t) => (
                  <button
                    key={t.v}
                    onClick={() => {
                      setTextSize(t.v)
                      setPop(null)
                    }}
                    className={`flex items-baseline gap-2.5 px-3 py-1.5 text-left hover:bg-black/5 ${textSize === t.v ? 'text-accent' : 'text-ink'}`}
                  >
                    <span style={{ fontSize: 10 + t.v * 400 }} className="font-semibold leading-none">
                      Aa
                    </span>
                    <span className="text-[12px]">{t.label}</span>
                  </button>
                ))}
              </div>
            ) : pop.kind === 'color' ? (
              <div className="grid w-[150px] grid-cols-5 gap-1.5 rounded-xl border border-black/10 bg-white p-2 shadow-xl">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      setColor(c)
                      setPop(null)
                    }}
                    className={`h-5 w-5 rounded-full ring-1 ring-black/15 ${color === c ? 'ring-2 ring-accent' : ''}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col rounded-xl border border-black/10 bg-white py-1 shadow-xl">
                {WIDTHS.map((w) => (
                  <button
                    key={w.v}
                    onClick={() => {
                      setWidth(w.v)
                      setPop(null)
                    }}
                    className={`flex items-center gap-2.5 px-3 py-1.5 text-left text-[12px] hover:bg-black/5 ${annWidth === w.v ? 'text-accent' : 'text-ink'}`}
                  >
                    <span className="rounded-full bg-current" style={{ width: Math.max(3, w.v * 900), height: Math.max(3, w.v * 900) }} />
                    {w.label}
                  </button>
                ))}
              </div>
            )}
          </div>,
          document.body
        )}

      <Divider />
      <button onClick={() => undo(pdfId)} disabled={!canUndo} title="실행 취소 (⌘Z)" className="shrink-0 rounded-full p-1 text-subtle hover:bg-black/5 disabled:opacity-30">
        <Undo2 size={14} />
      </button>
      <button onClick={() => redo(pdfId)} disabled={!canRedo} title="다시 실행 (⌘⇧Z)" className="shrink-0 rounded-full p-1 text-subtle hover:bg-black/5 disabled:opacity-30">
        <Redo2 size={14} />
      </button>
      <Divider />
      <button onClick={togglePos} title={vertical ? '툴바를 위쪽에 두기' : '툴바를 왼쪽에 세우기'} className="shrink-0 rounded-full p-1 text-subtle hover:bg-black/5">
        {vertical ? <PanelTop size={14} /> : <PanelLeft size={14} />}
      </button>
    </div>
  )
}
