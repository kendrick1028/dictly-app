import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { getStroke } from 'perfect-freehand'
import { Pencil, Play, Trash2, AudioLines, Minus, Plus } from 'lucide-react'
import { useStore } from '../store/useStore'
import { MarkdownMath } from './MarkdownMath'
import type { PDFDocumentProxy } from '../pdf/pdfjs-setup'
import type { Annotation, NPoint, StrokeData, UnderlineData, MemoData, TextData } from '../../../shared/types'

// ---- helpers ----
function getSvgPathFromStroke(stroke: number[][]): string {
  if (!stroke.length) return ''
  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length]
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
      return acc
    },
    ['M', ...stroke[0], 'Q'] as (string | number)[]
  )
  d.push('Z')
  return d.join(' ')
}

function captureTSec(): number | null {
  const s = useStore.getState()
  const recordingThis = s.recordingMemoId != null && s.recordingMemoId === s.memo?.id
  if (recordingThis) {
    const live = s.rec.liveSegments
    const last = live[live.length - 1]
    return last ? last.tStart : s.rec.elapsedSec || null
  }
  if (s.audioPlaying) {
    const t = s.audioCurrentTime
    const seg = (s.memo?.segments ?? []).find((g) => t >= g.tStart && t < g.tEnd)
    return seg ? seg.tStart : t
  }
  return null
}

function seekTo(tSec: number | null): void {
  if (tSec == null) return
  const st = useStore.getState()
  st.setTab('transcript')
  st.requestAudioSeek(tSec)
}

function pointSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function pointInPoly(px: number, py: number, poly: NPoint[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x
    const yi = poly[i].y
    const xj = poly[j].x
    const yj = poly[j].y
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** snap end to a 10° increment (computed in pixel space for visual correctness) */
function snap10(start: NPoint, end: NPoint, pageW: number, pageH: number): NPoint {
  const dx = (end.x - start.x) * pageW
  const dy = (end.y - start.y) * pageH
  const len = Math.hypot(dx, dy)
  const step = Math.PI / 18
  const ang = Math.round(Math.atan2(dy, dx) / step) * step
  return { x: start.x + (len * Math.cos(ang)) / pageW, y: start.y + (len * Math.sin(ang)) / pageH }
}

/** distance (px) from p to the nearest segment of a stroke's polyline */
function distToStroke(p: NPoint, pts: NPoint[], pageW: number, pageH: number): number {
  if (pts.length === 1) return Math.hypot((p.x - pts[0].x) * pageW, (p.y - pts[0].y) * pageH)
  let best = Infinity
  for (let i = 1; i < pts.length; i++) {
    const d = pointSegDist(p.x * pageW, p.y * pageH, pts[i - 1].x * pageW, pts[i - 1].y * pageH, pts[i].x * pageW, pts[i].y * pageH)
    if (d < best) best = d
  }
  return best
}

type Drag =
  | { mode: 'draw' }
  | { mode: 'erase' }
  | { mode: 'underline' }
  | { mode: 'lasso' }
  | { mode: 'lassoMove'; start: NPoint; base: Record<string, NPoint[]> }
  | { mode: 'endpoint'; id: string; which: number; base: NPoint[] }
  | { mode: 'strokeMove'; id: string; start: NPoint; base: NPoint[] }
  | null

interface Props {
  doc: PDFDocumentProxy
  pdfId: number
  page: number
  pageW: number
  pageH: number
}

export function PdfAnnotationLayer({ doc, pdfId, page, pageW, pageH }: Props): JSX.Element {
  const all = useStore((s) => s.annotations)
  const tool = useStore((s) => s.annTool)
  const color = useStore((s) => s.annColor)
  const width = useStore((s) => s.annWidth)
  const textSize = useStore((s) => s.annTextSize)
  const ruler = useStore((s) => s.annRuler)
  const focusedPdfId = useStore((s) => s.focusedPdfId)
  const addAnn = useStore((s) => s.addAnnotationLocal)
  const updateAnn = useStore((s) => s.updateAnnotationLocal)
  const deleteAnn = useStore((s) => s.deleteAnnotationLocal)

  const anns = useMemo(() => all.filter((a) => a.pdfId === pdfId && a.page === page), [all, pdfId, page])
  const focused = focusedPdfId === pdfId
  const drawing = focused && tool !== 'none'

  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<Drag>(null)
  const [draft, setDraft] = useState<NPoint[] | null>(null)
  const [ulDrag, setUlDrag] = useState<{ start: NPoint; end: NPoint } | null>(null)
  const [lasso, setLasso] = useState<NPoint[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editSel, setEditSel] = useState<string | null>(null) // pen/highlighter stroke under edit
  const [editId, setEditId] = useState<string | null>(null) // memo being edited
  // LOCAL preview of stroke points during move/resize drags — committed to the store (and DB) once
  // on pointerup, so a 120Hz drag doesn't re-render every layer / re-persist on every event
  const [preview, setPreview] = useState<Record<string, NPoint[]> | null>(null)

  // clear selections when tool changes
  useEffect(() => {
    setEditSel(null)
    setSelected(new Set())
  }, [tool])

  const ptOf = (e: { clientX: number; clientY: number }): NPoint => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }

  const eraseAt = (p: NPoint): void => {
    const thr = Math.max(8, width * pageW * 3)
    for (const a of anns) {
      if (a.type === 'pen' || a.type === 'highlighter') {
        if (distToStroke(p, (a.data as StrokeData).points, pageW, pageH) < thr) deleteAnn(a.id)
      } else if (a.type === 'underline') {
        for (const r of (a.data as UnderlineData).rects) {
          if (p.x >= r.x - 0.01 && p.x <= r.x + r.w + 0.01 && p.y >= r.y - 0.01 && p.y <= r.y + r.h + 0.01) {
            deleteAnn(a.id)
            break
          }
        }
      }
    }
  }

  const commitUnderline = async (start: NPoint, end: NPoint): Promise<void> => {
    const pageObj = await doc.getPage(page)
    const vw = pageObj.getViewport({ scale: 1 })
    const uw = vw.width
    const uh = vw.height
    const tc = await pageObj.getTextContent()
    const x0 = Math.min(start.x, end.x) * uw
    const x1 = Math.max(start.x, end.x) * uw
    const dragPdfY = uh - ((start.y + end.y) / 2) * uh
    // 1) build glyph boxes; 2) find the text LINE nearest the drag y (group by baseline — robust to
    //    per-item baseline jitter); 3) span one CONTINUOUS bar across the drag's x-range on that line.
    const glyphs = (tc.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number }>)
      .filter((it) => Array.isArray(it.transform) && typeof it.str === 'string' && it.str.trim().length > 0)
      .map((it) => {
        const t = it.transform as number[]
        const gh = Math.hypot(t[2], t[3]) || it.height || 10
        return { x: t[4], y: t[5], w: it.width as number, h: gh }
      })
    let nearest: { x: number; y: number; w: number; h: number } | null = null
    let nd = Infinity
    for (const g of glyphs) {
      const d = Math.abs(g.y + g.h * 0.35 - dragPdfY)
      if (d < nd) {
        nd = d
        nearest = g
      }
    }
    // forgiving line match (OCR'd PDFs have jittery baselines/heights)
    if (nearest && nd < Math.max(nearest.h * 2, 14)) {
      const fL = nearest.y
      const ghL = nearest.h
      const line = glyphs.filter((g) => Math.abs(g.y - fL) < ghL * 0.7 && g.x + g.w >= x0 && g.x <= x1)
      if (line.length) {
        const minX = Math.min(...line.map((g) => g.x))
        const maxX = Math.max(...line.map((g) => g.x + g.w))
        // HIGHLIGHT the text itself (translucent box over the glyph run), not a thin underline bar
        const padY = ghL * 0.12
        const rect = { x: minX / uw, y: (uh - (fL + ghL) - padY) / uh, w: (maxX - minX) / uw, h: (ghL + padY * 2) / uh }
        addAnn({ pdfId, page, type: 'underline', data: { rects: [rect], color, mode: 'highlight' } as UnderlineData, tSec: captureTSec() })
        return
      }
    }
    {
      // image PDF (no text) → straight highlight line along the drag
      const y = (start.y + end.y) / 2
      addAnn({
        pdfId,
        page,
        type: 'underline',
        data: { rects: [{ x: Math.min(start.x, end.x), y: y - 0.006, w: Math.abs(end.x - start.x), h: 0.012 }], color, mode: 'highlight' } as UnderlineData,
        tSec: captureTSec()
      })
    }
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (!drawing) return
    if (tool === 'memo') return // memo created on double-click only
    if (tool === 'text') {
      // text tool: a click on empty page places a text box and starts typing
      e.preventDefault()
      const p = ptOf(e)
      const id = addAnn({ pdfId, page, type: 'text', data: { x: p.x, y: p.y, text: '', size: textSize, color } as TextData, tSec: captureTSec() })
      setEditId(id)
      return
    }
    e.preventDefault()
    svgRef.current?.setPointerCapture(e.pointerId)
    const p = ptOf(e)
    if (tool === 'pen' || tool === 'highlighter') {
      // editing an already-selected stroke? check endpoint handles first
      const sel = editSel ? anns.find((a) => a.id === editSel) : null
      if (sel && (sel.type === 'pen' || sel.type === 'highlighter')) {
        const pts = (sel.data as StrokeData).points
        const ends = [pts[0], pts[pts.length - 1]]
        for (let i = 0; i < ends.length; i++) {
          if (Math.hypot((p.x - ends[i].x) * pageW, (p.y - ends[i].y) * pageH) < 15) {
            dragRef.current = { mode: 'endpoint', id: sel.id, which: i === 0 ? 0 : pts.length - 1, base: pts }
            return
          }
        }
      }
      // click on an existing stroke → select + start moving it (hit zone matches the visual width,
      // so thick highlighters are selectable across their whole band)
      const hit = anns.find((a) => {
        if (a.type !== 'pen' && a.type !== 'highlighter') return false
        const sd = a.data as StrokeData
        const thr = a.type === 'highlighter' ? Math.max(10, sd.width * pageW * 2 + 4) : 10
        return distToStroke(p, sd.points, pageW, pageH) < thr
      })
      if (hit) {
        setEditSel(hit.id)
        dragRef.current = { mode: 'strokeMove', id: hit.id, start: p, base: (hit.data as StrokeData).points }
        return
      }
      // empty → start a new stroke
      setEditSel(null)
      setDraft([p])
      dragRef.current = { mode: 'draw' }
    } else if (tool === 'eraser') {
      dragRef.current = { mode: 'erase' }
      eraseAt(p)
    } else if (tool === 'underline') {
      dragRef.current = { mode: 'underline' }
      setUlDrag({ start: p, end: p })
    } else if (tool === 'lasso') {
      if (selected.size && pointInPoly(p.x, p.y, lassoBBox())) {
        const base: Record<string, NPoint[]> = {}
        anns.forEach((a) => {
          if (selected.has(a.id) && (a.type === 'pen' || a.type === 'highlighter')) base[a.id] = (a.data as StrokeData).points
        })
        dragRef.current = { mode: 'lassoMove', start: p, base }
      } else {
        setSelected(new Set())
        setLasso([p])
        dragRef.current = { mode: 'lasso' }
      }
    }
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const d = dragRef.current
    if (!d) return
    const p = ptOf(e)
    const straight = e.shiftKey || ruler
    if (d.mode === 'draw') {
      // functional updates → no stale closure when events outpace renders
      if (straight) {
        setDraft((cur) => {
          if (!cur?.length) return [p]
          return [cur[0], e.shiftKey ? snap10(cur[0], p, pageW, pageH) : p]
        })
      } else setDraft((cur) => (cur ? [...cur, p] : [p]))
    } else if (d.mode === 'erase') eraseAt(p)
    else if (d.mode === 'underline') setUlDrag((u) => (u ? { ...u, end: p } : { start: p, end: p }))
    else if (d.mode === 'lasso') setLasso((l) => (l ? [...l, p] : [p]))
    else if (d.mode === 'lassoMove') {
      const dx = p.x - d.start.x
      const dy = p.y - d.start.y
      const next: Record<string, NPoint[]> = {}
      for (const id of Object.keys(d.base)) next[id] = d.base[id].map((q) => ({ x: q.x + dx, y: q.y + dy }))
      setPreview(next)
    } else if (d.mode === 'endpoint') {
      // scale+rotate the WHOLE stroke so the dragged end follows the cursor, anchored at the other
      // end → intuitive extend/shorten for both straight lines and freehand. (pixel space, then back)
      const anchor = d.base[d.which === 0 ? d.base.length - 1 : 0]
      const np = e.shiftKey ? snap10(anchor, p, pageW, pageH) : p
      const ox = (d.base[d.which].x - anchor.x) * pageW
      const oy = (d.base[d.which].y - anchor.y) * pageH
      const nx = (np.x - anchor.x) * pageW
      const ny = (np.y - anchor.y) * pageH
      const denom = ox * ox + oy * oy || 1
      const fr = (nx * ox + ny * oy) / denom // similarity transform real/imag parts (o → n)
      const fi = (ny * ox - nx * oy) / denom
      const pts = d.base.map((q) => {
        const qx = (q.x - anchor.x) * pageW
        const qy = (q.y - anchor.y) * pageH
        return { x: anchor.x + (qx * fr - qy * fi) / pageW, y: anchor.y + (qx * fi + qy * fr) / pageH }
      })
      setPreview({ [d.id]: pts })
    } else if (d.mode === 'strokeMove') {
      const dx = p.x - d.start.x
      const dy = p.y - d.start.y
      setPreview({ [d.id]: d.base.map((q) => ({ x: q.x + dx, y: q.y + dy })) })
    }
  }

  /** commit local drag previews to the store/DB (single write at drag end) */
  const commitPreview = (pv: Record<string, NPoint[]> | null): void => {
    if (!pv) return
    for (const id of Object.keys(pv)) {
      const a = anns.find((x) => x.id === id)
      if (a) updateAnn(id, { data: { ...(a.data as StrokeData), points: pv[id] } }, true)
    }
    setPreview(null)
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    const d = dragRef.current
    dragRef.current = null
    if (!d) return
    if (d.mode === 'draw' && draft) {
      const straight = e.shiftKey || ruler
      const pts = straight && draft.length > 1 ? [draft[0], draft[draft.length - 1]] : draft
      if (pts.length > 1) addAnn({ pdfId, page, type: tool as 'pen' | 'highlighter', data: { points: pts, color, width, ruler: straight } as StrokeData, tSec: captureTSec() })
      setDraft(null)
    } else if (d.mode === 'underline' && ulDrag) {
      const { start, end } = ulDrag
      setUlDrag(null)
      void commitUnderline(start, end)
    } else if (d.mode === 'lasso' && lasso) {
      if (lasso.length > 2) {
        const sel = new Set<string>()
        anns.forEach((a) => {
          if ((a.type === 'pen' || a.type === 'highlighter') && (a.data as StrokeData).points.some((q) => pointInPoly(q.x, q.y, lasso))) sel.add(a.id)
        })
        setSelected(sel)
      }
      setLasso(null)
    } else if (d.mode === 'lassoMove' || d.mode === 'endpoint' || d.mode === 'strokeMove') {
      commitPreview(preview)
    }
  }

  const lassoBBox = (): NPoint[] => {
    let minX = 1
    let minY = 1
    let maxX = 0
    let maxY = 0
    anns.forEach((a) => {
      if (!selected.has(a.id) || (a.type !== 'pen' && a.type !== 'highlighter')) return
      ;(a.data as StrokeData).points.forEach((q) => {
        minX = Math.min(minX, q.x)
        minY = Math.min(minY, q.y)
        maxX = Math.max(maxX, q.x)
        maxY = Math.max(maxY, q.y)
      })
    })
    return [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY }
    ]
  }

  const cursorClass = drawing
    ? tool === 'eraser'
      ? 'cursor-cell'
      : tool === 'lasso'
        ? 'cursor-crosshair'
        : tool === 'text'
          ? 'cursor-text'
          : 'dictly-cursor-pen'
    : ''

  const memos = anns.filter((a) => a.type === 'memo')
  const texts = anns.filter((a) => a.type === 'text')
  const strokes = anns.filter((a) => a.type !== 'memo' && a.type !== 'text')
  const editStroke = editSel ? anns.find((a) => a.id === editSel) : null
  const editPts =
    editStroke && (editStroke.type === 'pen' || editStroke.type === 'highlighter')
      ? (preview?.[editStroke.id] ?? (editStroke.data as StrokeData).points)
      : null

  // anchor (first point / first rect) for the linked-chunk sound badge — tracks the drag preview
  const anchorOf = (a: Annotation): NPoint | null => {
    if (a.type === 'pen' || a.type === 'highlighter') {
      const pts = preview?.[a.id] ?? (a.data as StrokeData).points
      return pts[0] ?? null
    }
    if (a.type === 'underline') {
      const r = (a.data as UnderlineData).rects[0]
      return r ? { x: r.x, y: r.y } : null
    }
    return null
  }

  return (
    <div data-annlayer="" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <svg
        ref={svgRef}
        width={pageW}
        height={pageH}
        className={cursorClass}
        style={{ position: 'absolute', inset: 0, pointerEvents: drawing ? 'auto' : 'none', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => {
          if (focused && tool === 'memo') {
            const p = ptOf(e)
            const id = addAnn({ pdfId, page, type: 'memo', data: { x: p.x, y: p.y, markdown: '' } as MemoData, tSec: captureTSec() })
            setEditId(id)
          }
        }}
      >
        {strokes.map((a) => (
          <AnnShape
            key={a.id}
            a={a}
            overridePts={preview?.[a.id] ?? null}
            pageW={pageW}
            pageH={pageH}
            interactive={tool === 'none'}
            selected={editSel === a.id || selected.has(a.id)}
          />
        ))}
        {draft && (tool === 'pen' || tool === 'highlighter') && (
          <DraftShape pts={draft} pageW={pageW} pageH={pageH} color={color} width={width} highlighter={tool === 'highlighter'} />
        )}
        {ulDrag && (
          <line
            x1={ulDrag.start.x * pageW}
            y1={ulDrag.start.y * pageH}
            x2={ulDrag.end.x * pageW}
            y2={ulDrag.end.y * pageH}
            stroke={color}
            strokeWidth={2}
            strokeDasharray="4 3"
            opacity={0.6}
          />
        )}
        {lasso && lasso.length > 1 && (
          <polygon points={lasso.map((p) => `${p.x * pageW},${p.y * pageH}`).join(' ')} style={{ fill: 'rgb(var(--accent) / 0.08)', stroke: 'rgb(var(--accent))' }} strokeWidth={1} strokeDasharray="4 3" />
        )}
        {/* endpoint handles for the selected stroke (pen/highlighter edit) */}
        {editPts && [editPts[0], editPts[editPts.length - 1]].map((pt, i) => (
          <circle key={i} cx={pt.x * pageW} cy={pt.y * pageH} r={7} fill="#fff" style={{ stroke: 'rgb(var(--accent))' }} strokeWidth={2.5} />
        ))}
      </svg>

      {/* linked-chunk sound badges (distinguish linked annotations; click seeks in select tool) */}
      {strokes
        .filter((a) => a.tSec != null)
        .map((a) => {
          const an = anchorOf(a)
          if (!an) return null
          return (
            <button
              key={`snd-${a.id}`}
              onClick={() => tool === 'none' && seekTo(a.tSec)}
              title={tool === 'none' ? '이 시점 재생' : '녹음 연결됨'}
              data-memobadge=""
              style={{ position: 'absolute', left: an.x * pageW, top: an.y * pageH, transform: 'translate(-120%,-50%)', pointerEvents: tool === 'none' ? 'auto' : 'none' }}
              className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-white shadow ring-1 ring-white"
            >
              <AudioLines size={9} />
            </button>
          )
        })}

      {/* free text boxes */}
      {texts.map((a) => (
        <TextBox
          key={a.id}
          a={a}
          tool={tool}
          pageW={pageW}
          pageH={pageH}
          editing={editId === a.id}
          onEdit={() => setEditId(a.id)}
          onEditDone={() => setEditId(null)}
          onChange={(text) => updateAnn(a.id, { data: { ...(a.data as TextData), text } })}
          onMove={(x, y) => updateAnn(a.id, { data: { ...(a.data as TextData), x, y } }, true)}
          onResize={(size) => updateAnn(a.id, { data: { ...(a.data as TextData), size } })}
          onDelete={() => deleteAnn(a.id)}
        />
      ))}

      {/* memo badges */}
      {memos.map((a) => (
        <MemoBadge
          key={a.id}
          a={a}
          tool={tool}
          pageW={pageW}
          pageH={pageH}
          editing={editId === a.id}
          onEdit={() => setEditId(a.id)}
          onEditDone={() => setEditId(null)}
          onChange={(md) => updateAnn(a.id, { data: { ...(a.data as MemoData), markdown: md } })}
          onMove={(x, y) => updateAnn(a.id, { data: { ...(a.data as MemoData), x, y } }, true)}
          onDelete={() => deleteAnn(a.id)}
          onSeek={() => seekTo(a.tSec)}
        />
      ))}
    </div>
  )
}

// ---- saved stroke/underline ----
// memoized: pen drawing / drags re-render ONLY the affected shape (perfect-freehand path generation
// is the hot path — it must not run for every saved stroke on every input event)
const AnnShape = memo(function AnnShape({
  a,
  overridePts,
  pageW,
  pageH,
  interactive,
  selected
}: {
  a: Annotation
  /** local drag preview points (mid-drag) — overrides a.data.points */
  overridePts: NPoint[] | null
  pageW: number
  pageH: number
  interactive: boolean
  selected: boolean
}): JSX.Element | null {
  const stroke = a.type === 'pen' || a.type === 'highlighter' ? (a.data as StrokeData) : null
  const pts = overridePts ?? stroke?.points ?? null
  // streamline:0 + last:true → the rendered stroke reaches its actual first/last points, so the
  // endpoint handles sit exactly on the visible line ends (no gap).
  const penPath = useMemo(
    () =>
      a.type === 'pen' && pts && stroke
        ? getSvgPathFromStroke(
            getStroke(pts.map((p) => [p.x * pageW, p.y * pageH]), { size: Math.max(2, stroke.width * pageW), thinning: 0.5, smoothing: 0.5, streamline: 0, last: true })
          )
        : '',
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [a, pts, pageW, pageH]
  )
  const pe = interactive ? 'auto' : 'none'
  const cls = interactive && a.tSec != null ? 'dictly-ann cursor-pointer' : 'dictly-ann'
  const handlers = {
    style: { pointerEvents: pe } as React.CSSProperties,
    className: cls,
    onClick: interactive ? () => seekTo(a.tSec) : undefined
  }
  if (a.type === 'pen' && stroke) {
    return (
      <path
        d={penPath}
        fill={stroke.color}
        strokeWidth={selected ? 1 : undefined}
        {...handlers}
        style={{ ...handlers.style, ...(selected ? { stroke: 'rgb(var(--accent))' } : {}) }}
      />
    )
  }
  if (a.type === 'highlighter' && stroke && pts) {
    return (
      <polyline
        points={pts.map((p) => `${p.x * pageW},${p.y * pageH}`).join(' ')}
        fill="none"
        stroke={stroke.color}
        strokeWidth={Math.max(6, stroke.width * pageW * 4)}
        strokeOpacity={selected ? 0.5 : 0.35}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...handlers}
      />
    )
  }
  if (a.type === 'underline') {
    const d = a.data as UnderlineData
    return (
      <g {...handlers}>
        {d.rects.map((r, i) =>
          d.mode === 'highlight' ? (
            <rect key={i} x={r.x * pageW} y={r.y * pageH} width={r.w * pageW} height={r.h * pageH} fill={d.color} opacity={0.32} />
          ) : (
            <rect key={i} x={r.x * pageW} y={(r.y + r.h) * pageH - Math.max(1.5, r.h * pageH * 0.08)} width={r.w * pageW} height={Math.max(1.5, r.h * pageH * 0.08)} fill={d.color} />
          )
        )}
      </g>
    )
  }
  return null
})

function DraftShape({
  pts,
  pageW,
  pageH,
  color,
  width,
  highlighter
}: {
  pts: NPoint[]
  pageW: number
  pageH: number
  color: string
  width: number
  highlighter: boolean
}): JSX.Element {
  if (highlighter) {
    return (
      <polyline
        points={pts.map((p) => `${p.x * pageW},${p.y * pageH}`).join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={Math.max(6, width * pageW * 4)}
        strokeOpacity={0.35}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    )
  }
  const path = getSvgPathFromStroke(getStroke(pts.map((p) => [p.x * pageW, p.y * pageH]), { size: Math.max(2, width * pageW), thinning: 0.6, smoothing: 0.5, streamline: 0.5 }))
  return <path d={path} fill={color} />
}

// ---- memo badge ----
const TEXT_MIN = 0.008
const TEXT_MAX = 0.08

/** free text on the page: type in place, drag to move, A−/A+ to resize (per box) */
function TextBox({
  a,
  tool,
  pageW,
  pageH,
  editing,
  onEdit,
  onEditDone,
  onChange,
  onMove,
  onResize,
  onDelete
}: {
  a: Annotation
  tool: string
  pageW: number
  pageH: number
  editing: boolean
  onEdit: () => void
  onEditDone: () => void
  onChange: (text: string) => void
  onMove: (x: number, y: number) => void
  onResize: (size: number) => void
  onDelete: () => void
}): JSX.Element {
  const d = a.data as TextData
  const [draft, setDraft] = useState(d.text)
  const [hovered, setHovered] = useState(false)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const movedRef = useRef(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => setDraft(d.text), [d.text, editing])
  const fontPx = Math.max(8, d.size * pageW)
  const interactive = tool === 'none' || tool === 'text' || tool === 'eraser'

  // auto-grow the editor to its content
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
    const longest = Math.max(4, ...draft.split('\n').map((l) => l.length))
    el.style.width = Math.min(pageW * 0.9, Math.max(120, longest * fontPx * 0.62 + 16)) + 'px'
  }, [draft, editing, fontPx, pageW])

  const onDown = (e: React.PointerEvent): void => {
    if (tool === 'eraser') {
      onDelete()
      return
    }
    if (tool !== 'none' && tool !== 'text') return
    e.stopPropagation()
    movedRef.current = false
    const layerEl = (e.currentTarget as HTMLElement).closest('[data-annlayer]') as HTMLElement | null
    if (!layerEl) return
    const parent = layerEl.getBoundingClientRect()
    const off = { x: e.clientX - parent.left - d.x * parent.width, y: e.clientY - parent.top - d.y * parent.height }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    let last: { x: number; y: number } | null = null
    const move = (ev: PointerEvent): void => {
      movedRef.current = true
      last = {
        x: Math.max(0, Math.min(1, (ev.clientX - parent.left - off.x) / parent.width)),
        y: Math.max(0, Math.min(1, (ev.clientY - parent.top - off.y) / parent.height))
      }
      setDragPos(last)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (last) onMove(last.x, last.y)
      setDragPos(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const finish = (): void => {
    const t = draft.trim()
    if (!t) onDelete() // empty box → gone (also cleans up a mis-click)
    else if (t !== d.text) onChange(draft)
    onEditDone()
  }
  const step = (dir: 1 | -1): void => onResize(Math.max(TEXT_MIN, Math.min(TEXT_MAX, d.size * (dir > 0 ? 1.2 : 1 / 1.2))))

  return (
    <div
      data-memobadge=""
      className="absolute"
      style={{ left: (dragPos?.x ?? d.x) * pageW, top: (dragPos?.y ?? d.y) * pageH, pointerEvents: interactive ? 'auto' : 'none' }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {/* per-box size + delete controls (while editing or hovered with the text tool) */}
      {(editing || (hovered && tool === 'text')) && (
        <div className="absolute -top-7 left-0 z-[60] flex items-center gap-0.5 rounded-lg border border-black/10 bg-white px-1 py-0.5 shadow-lg" onPointerDown={(e) => e.stopPropagation()}>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => step(-1)} className="rounded p-0.5 text-subtle hover:bg-black/5" title="글자 작게">
            <Minus size={11} />
          </button>
          <span className="w-9 text-center text-[10px] tabular-nums text-subtle">{Math.round(fontPx)}px</span>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => step(1)} className="rounded p-0.5 text-subtle hover:bg-black/5" title="글자 크게">
            <Plus size={11} />
          </button>
          <span className="mx-0.5 h-3 w-px bg-black/10" />
          <button onMouseDown={(e) => e.preventDefault()} onClick={onDelete} className="rounded p-0.5 text-subtle hover:bg-red-50 hover:text-red-500" title="삭제">
            <Trash2 size={11} />
          </button>
        </div>
      )}
      {editing ? (
        <textarea
          ref={taRef}
          value={draft}
          autoFocus
          rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={finish}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return
            if (e.key === 'Escape') {
              e.preventDefault()
              finish()
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder="텍스트 입력"
          style={{ fontSize: fontPx, color: d.color, lineHeight: 1.3 }}
          className="block resize-none overflow-hidden rounded bg-white/85 px-1 py-0.5 font-sans outline-none ring-1 ring-accent"
        />
      ) : (
        <div
          onPointerDown={onDown}
          onClick={() => {
            if (movedRef.current) return
            if (tool === 'text') onEdit()
          }}
          onDoubleClick={() => tool === 'none' && onEdit()}
          style={{ fontSize: fontPx, color: d.color, lineHeight: 1.3, whiteSpace: 'pre-wrap', maxWidth: pageW * 0.9 }}
          className={`select-none rounded px-1 py-0.5 ${tool === 'text' ? 'cursor-move ring-1 ring-dashed ring-accent/40 hover:ring-accent' : tool === 'none' ? 'cursor-move' : ''}`}
          title={tool === 'none' ? '드래그로 이동 · 더블클릭으로 편집' : '클릭해서 편집 · 드래그로 이동'}
        >
          {d.text}
        </div>
      )}
    </div>
  )
}

function MemoBadge({
  a,
  tool,
  pageW,
  pageH,
  editing,
  onEdit,
  onEditDone,
  onChange,
  onMove,
  onDelete,
  onSeek
}: {
  a: Annotation
  tool: string
  pageW: number
  pageH: number
  editing: boolean
  onEdit: () => void
  onEditDone: () => void
  onChange: (md: string) => void
  onMove: (x: number, y: number) => void
  onDelete: () => void
  onSeek: () => void
}): JSX.Element {
  const d = a.data as MemoData
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [draft, setDraft] = useState(d.markdown)
  // local position while dragging — committed via onMove ONCE on pointerup (no store/DB churn)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const movedRef = useRef(false)
  useEffect(() => setDraft(d.markdown), [d.markdown, editing])

  const open = hovered || pinned || editing
  const showHover = (): void => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    setHovered(true)
  }
  const scheduleHide = (): void => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setHovered(false), 320) // forgiving delay
  }

  const onDown = (e: React.PointerEvent): void => {
    if (tool === 'eraser') {
      onDelete()
      return
    }
    e.stopPropagation()
    movedRef.current = false
    const layerEl = (e.currentTarget as HTMLElement).closest('[data-annlayer]') as HTMLElement | null
    if (!layerEl) return
    const parent = layerEl.getBoundingClientRect()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    let last: { x: number; y: number } | null = null
    const move = (ev: PointerEvent): void => {
      movedRef.current = true
      last = {
        x: Math.max(0, Math.min(1, (ev.clientX - parent.left) / parent.width)),
        y: Math.max(0, Math.min(1, (ev.clientY - parent.top) / parent.height))
      }
      setDragPos(last)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (last) onMove(last.x, last.y) // single store/DB commit at drag end
      setDragPos(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onClick = (): void => {
    if (movedRef.current) return // was a drag
    if (tool === 'memo') setPinned((v) => !v) // memo tool: click toggles open
    else if (tool === 'none' && a.tSec != null) onSeek() // select tool: click plays
  }

  return (
    <div
      data-memobadge=""
      className="group/memo absolute"
      style={{ left: (dragPos?.x ?? d.x) * pageW, top: (dragPos?.y ?? d.y) * pageH, transform: 'translate(-50%,-50%)', pointerEvents: 'auto' }}
      onPointerEnter={showHover}
      onPointerLeave={scheduleHide}
    >
      <button
        onPointerDown={onDown}
        onClick={onClick}
        className="relative flex h-5 w-5 cursor-grab items-center justify-center rounded-full bg-amber-400 text-[10px] font-bold text-white shadow ring-2 ring-white active:cursor-grabbing"
        title="메모"
      >
        ✎
        {a.tSec != null && (
          <span className="absolute -right-1 -top-1 flex h-3 w-3 items-center justify-center rounded-full bg-accent ring-1 ring-white">
            <AudioLines size={7} className="text-white" />
          </span>
        )}
      </button>
      {open && (
        <div
          className="absolute left-1/2 top-full z-[60] mt-1 w-60 -translate-x-1/2 rounded-lg border border-black/10 bg-white p-2 shadow-xl"
          onPointerEnter={showHover}
          onPointerLeave={scheduleHide}
        >
          {editing ? (
            <textarea
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                onChange(draft)
                onEditDone()
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return // IME: don't save mid-composition
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  onChange(draft)
                  onEditDone()
                } else if (e.key === 'Escape') {
                  onChange(draft)
                  onEditDone()
                }
              }}
              rows={4}
              placeholder="메모 (Enter 저장 · Shift+Enter 줄바꿈 · Markdown/$LaTeX$)"
              className="w-full resize-none rounded border border-black/10 px-2 py-1 text-[12px] outline-none focus:border-accent"
            />
          ) : (
            <div>
              <div className="min-h-[1em] text-[12px] text-ink">
                {d.markdown.trim() ? <MarkdownMath>{d.markdown}</MarkdownMath> : <span className="text-subtle">빈 메모 — 편집하세요</span>}
              </div>
              <div className="mt-1.5 flex items-center gap-1 border-t border-black/5 pt-1.5 text-subtle">
                <button onClick={onEdit} className="rounded p-1 hover:bg-black/5" title="편집">
                  <Pencil size={12} />
                </button>
                {a.tSec != null && (
                  <button onClick={onSeek} className="rounded p-1 text-accent hover:bg-accent/10" title="이 시점 재생">
                    <Play size={12} />
                  </button>
                )}
                <div className="flex-1" />
                <button onClick={onDelete} className="rounded p-1 hover:bg-red-50 hover:text-red-500" title="삭제">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
