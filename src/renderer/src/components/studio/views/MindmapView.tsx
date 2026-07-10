// Editable, collapsible tree mindmap — no deps.
// • working tree carries stable ids → edit/add/delete survive structural changes
// • node heights are MEASURED so multi-line nodes never overlap (cross-axis = height in horizontal
//   mode, fixed width in vertical mode); same-parent leaves tight, different-parent groups spaced
// • connectors are drawn ONCE per parent (stub + bus + child stubs) so overlapping strokes never
//   compound into a thick/dark trunk. Curved (bezier) or angular (elbow). Pinch/buttons zoom.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronsDownUp,
  ChevronsUpDown,
  MoveHorizontal,
  MoveVertical,
  Pencil,
  Plus,
  Spline,
  Trash2,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import html2canvas from 'html2canvas'
import { useStore } from '../../../store/useStore'
import { CitedMarkdown } from '../cite/CitedMarkdown'
import { setMindmapExporter } from '../../../lib/studioExport'
import type { MindmapContent, MindmapNode, StudioItem } from '../../../../../shared/types'

const COL_W = 255
const LEAF_GAP = 14 // gap between same-parent siblings
const GROUP_GAP = 20 // extra gap between sibling subtrees (different-parent separation)
const NODE_W = 210
const FALLBACK_H = 48 // assumed height before measurement
const PAD = 48

interface MNode {
  id: number
  label: string
  children: MNode[]
}

let _uid = 1
const nextId = (): number => _uid++

function assignIds(n: MindmapNode): MNode {
  return { id: nextId(), label: n.label, children: (n.children ?? []).map(assignIds) }
}
function toContent(n: MNode): MindmapNode {
  return n.children.length ? { label: n.label, children: n.children.map(toContent) } : { label: n.label }
}
function mapNode(n: MNode, id: number, fn: (n: MNode) => MNode): MNode {
  return n.id === id ? fn(n) : { ...n, children: n.children.map((c) => mapNode(c, id, fn)) }
}
function removeNode(n: MNode, id: number): MNode {
  return { ...n, children: n.children.filter((c) => c.id !== id).map((c) => removeNode(c, id)) }
}
function countDesc(n: MNode): number {
  return n.children.reduce((acc, c) => acc + 1 + countDesc(c), 0)
}
function initialCollapsed(root: MNode): Set<number> {
  const s = new Set<number>()
  const walk = (n: MNode, depth: number): void => {
    if (depth >= 1 && n.children.length) s.add(n.id)
    n.children.forEach((c) => walk(c, depth + 1))
  }
  walk(root, 0)
  return s
}
function allParentIds(root: MNode): number[] {
  const ids: number[] = []
  const walk = (n: MNode): void => {
    if (n.children.length) ids.push(n.id)
    n.children.forEach(walk)
  }
  walk(root)
  return ids
}

interface Laid {
  id: number
  node: MNode
  depth: number
  x: number // depth (main axis)
  y: number // cross-axis top
  h: number // measured height
  hasChildren: boolean
  hiddenCount: number
  parentId: number | null
}

/** layout over VISIBLE nodes. crossSize = the node's extent along the stacking axis. */
function layoutTree(root: MNode, collapsed: Set<number>, heightOf: (id: number) => number, horiz: boolean): Laid[] {
  const nodes: Laid[] = []
  const crossSize = (n: MNode): number => (horiz ? heightOf(n.id) : NODE_W)
  let cursor = 0
  const walk = (n: MNode, depth: number, parentId: number | null): number => {
    const kids = collapsed.has(n.id) ? [] : n.children
    let y: number
    if (!kids.length) {
      y = cursor
      cursor += crossSize(n) + LEAF_GAP
    } else {
      const centers: number[] = []
      kids.forEach((c, i) => {
        if (i > 0) {
          const prev = kids[i - 1]
          const prevHasKids = !collapsed.has(prev.id) && prev.children.length > 0
          const curHasKids = !collapsed.has(c.id) && c.children.length > 0
          if (prevHasKids || curHasKids) cursor += GROUP_GAP // separate sibling groups
        }
        const cy = walk(c, depth + 1, n.id)
        centers.push(cy + crossSize(c) / 2)
      })
      const mid = (Math.min(...centers) + Math.max(...centers)) / 2
      y = mid - crossSize(n) / 2
    }
    nodes.push({
      id: n.id,
      node: n,
      depth,
      x: depth * COL_W,
      y,
      h: heightOf(n.id),
      hasChildren: n.children.length > 0,
      hiddenCount: collapsed.has(n.id) ? countDesc(n) : 0,
      parentId
    })
    return y
  }
  walk(root, 0, null)
  return nodes
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** angular (elbow) connector glyph for the style toggle */
function ElbowIcon({ size = 14 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 5v7h7" />
      <path d="M12 12h7" />
    </svg>
  )
}

export function MindmapView({ item }: { item: StudioItem }): JSX.Element {
  const refreshStudioItems = useStore((s) => s.refreshStudioItems)
  const content = item.content as MindmapContent

  const [tree, setTree] = useState<MNode | null>(null)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [direction, setDirection] = useState<'horizontal' | 'vertical'>(content.direction ?? 'horizontal')
  const [connector, setConnector] = useState<'curved' | 'angular'>(content.connector ?? 'curved')
  const [scale, setScale] = useState(1)
  const [editId, setEditId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [measureTick, setMeasureTick] = useState(0)
  const heightsRef = useRef<Map<number, number>>(new Map())
  const scrollRef = useRef<HTMLDivElement>(null)
  const collapsedRef = useRef(collapsed)
  collapsedRef.current = collapsed

  useEffect(() => {
    const t = assignIds(content.root)
    heightsRef.current = new Map()
    setTree(t)
    setCollapsed(initialCollapsed(t))
    setDirection(content.direction ?? 'horizontal')
    setConnector(content.connector ?? 'curved')
    setScale(1)
    setEditId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  // trackpad pinch / ctrl+wheel zoom
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setScale((s) => clamp(+(s * (1 - e.deltaY * 0.01)).toFixed(3), 0.3, 2.5))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // publish an exporter: capture the FULL (expanded) tree, citation chips hidden, at natural 100%
  useEffect(() => {
    const exporter = async (): Promise<HTMLCanvasElement> => {
      const prev = collapsedRef.current
      setCollapsed(new Set()) // expand every node
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      await new Promise((r) => setTimeout(r, 160)) // let height-measurement re-layout settle
      const el = document.querySelector('[data-mm-canvas]') as HTMLElement | null
      if (!el) {
        setCollapsed(prev)
        throw new Error('마인드맵을 찾을 수 없습니다')
      }
      try {
        return await html2canvas(el, {
          backgroundColor: '#ffffff',
          scale: 2,
          width: el.offsetWidth,
          height: el.offsetHeight,
          onclone: (doc: Document) => {
            doc.querySelectorAll('[data-cite-chip]').forEach((c) => ((c as HTMLElement).style.display = 'none'))
            let p = doc.querySelector('[data-mm-canvas]')?.parentElement ?? null
            while (p) {
              if (p.style.transform) p.style.transform = 'none'
              p = p.parentElement
            }
          }
        })
      } finally {
        setCollapsed(prev) // restore the on-screen collapse state
      }
    }
    setMindmapExporter(exporter)
    return () => setMindmapExporter(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const horiz = direction === 'horizontal'
  const heightOf = (id: number): number => heightsRef.current.get(id) ?? FALLBACK_H

  const nodes = useMemo(
    () => (tree ? layoutTree(tree, collapsed, heightOf, horiz) : []),
    // measureTick forces re-layout once real heights are known
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tree, collapsed, horiz, measureTick]
  )

  // measure rendered node heights → re-layout if they differ (converges, then stops)
  useLayoutEffect(() => {
    const map = heightsRef.current
    let changed = false
    for (const n of nodes) {
      const el = document.querySelector(`[data-mm-node="${n.id}"]`) as HTMLElement | null
      if (!el) continue
      const h = el.offsetHeight || FALLBACK_H
      if (Math.abs((map.get(n.id) ?? 0) - h) > 0.5) {
        map.set(n.id, h)
        changed = true
      }
    }
    if (changed) setMeasureTick((t) => t + 1)
  })

  if (!tree) return <div className="h-full" />

  const px = (n: Laid): { left: number; top: number } => (horiz ? { left: PAD + n.x, top: PAD + n.y } : { left: PAD + n.y, top: PAD + n.x })
  const W = Math.max(0, ...nodes.map((n) => px(n).left + NODE_W)) + PAD
  const H = Math.max(0, ...nodes.map((n) => px(n).top + n.h)) + PAD
  const byId = new Map(nodes.map((n) => [n.id, n]))

  const persist = (t: MNode | null, dir = direction, conn = connector): void => {
    if (!t) return
    void window.api.studio.update(item.id, { content: { root: toContent(t), direction: dir, connector: conn } }).then(() => refreshStudioItems())
  }

  const toggle = (id: number, hasChildren: boolean): void => {
    if (!hasChildren) return
    setCollapsed((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const parentIds = allParentIds(tree)
  const anyExpanded = parentIds.some((id) => !collapsed.has(id))
  const toggleAll = (): void => setCollapsed(anyExpanded ? new Set(parentIds) : new Set())

  const switchDirection = (d: 'horizontal' | 'vertical'): void => {
    setDirection(d)
    persist(tree, d, connector)
  }
  const switchConnector = (c: 'curved' | 'angular'): void => {
    setConnector(c)
    persist(tree, direction, c)
  }

  const startEdit = (n: MNode): void => {
    setEditId(n.id)
    setDraft(n.label)
  }
  const commitEdit = (): void => {
    if (editId == null) return setEditId(null)
    const nt = mapNode(tree, editId, (node) => ({ ...node, label: draft }))
    setTree(nt)
    persist(nt)
    setEditId(null)
  }
  const addChild = (n: Laid): void => {
    const childId = nextId()
    const nt = mapNode(tree, n.id, (node) => ({ ...node, children: [...node.children, { id: childId, label: '새 노드', children: [] }] }))
    setTree(nt)
    persist(nt)
    setCollapsed((c) => {
      const s = new Set(c)
      s.delete(n.id)
      return s
    })
    setEditId(childId)
    setDraft('새 노드')
  }
  const del = (n: Laid): void => {
    if (n.id === tree.id) return
    const nt = removeNode(tree, n.id)
    setTree(nt)
    persist(nt)
    if (editId === n.id) setEditId(null)
  }

  // one connector group per parent — shared stub + bus, then a stub into each child (no overlap)
  const connectorPaths = (): { key: string; d: string }[] => {
    const out: { key: string; d: string }[] = []
    for (const p of nodes) {
      if (collapsed.has(p.id) || !p.node.children.length) continue
      const kids = nodes.filter((n) => n.parentId === p.id)
      if (!kids.length) continue
      const a = px(p)
      if (horiz) {
        const ax = a.left + NODE_W
        const ay = a.top + p.h / 2
        const childLeft = px(kids[0]).left
        const mx = (ax + childLeft) / 2
        const cys = kids.map((k) => px(k).top + k.h / 2)
        if (connector === 'angular') {
          out.push({ key: `${p.id}-stub`, d: `M ${ax} ${ay} H ${mx}` })
          out.push({ key: `${p.id}-bus`, d: `M ${mx} ${Math.min(ay, ...cys)} V ${Math.max(ay, ...cys)}` })
          kids.forEach((k, i) => out.push({ key: `${p.id}-${i}`, d: `M ${mx} ${cys[i]} H ${px(k).left}` }))
        } else {
          kids.forEach((k, i) => {
            const by = cys[i]
            const bx = px(k).left
            out.push({ key: `${p.id}-${i}`, d: `M ${ax} ${ay} C ${(ax + bx) / 2} ${ay}, ${(ax + bx) / 2} ${by}, ${bx} ${by}` })
          })
        }
      } else {
        const ax = a.left + NODE_W / 2
        const ay = a.top + p.h
        const childTop = px(kids[0]).top
        const my = (ay + childTop) / 2
        const cxs = kids.map((k) => px(k).left + NODE_W / 2)
        if (connector === 'angular') {
          out.push({ key: `${p.id}-stub`, d: `M ${ax} ${ay} V ${my}` })
          out.push({ key: `${p.id}-bus`, d: `M ${Math.min(ax, ...cxs)} ${my} H ${Math.max(ax, ...cxs)}` })
          kids.forEach((k, i) => out.push({ key: `${p.id}-${i}`, d: `M ${cxs[i]} ${my} V ${px(k).top}` }))
        } else {
          kids.forEach((k, i) => {
            const bx = cxs[i]
            const by = px(k).top
            out.push({ key: `${p.id}-${i}`, d: `M ${ax} ${ay} C ${ax} ${(ay + by) / 2}, ${bx} ${(ay + by) / 2}, ${bx} ${by}` })
          })
        }
      }
    }
    return out
  }

  const pillBtn = (active: boolean): string => `rounded-full p-1.5 transition ${active ? 'bg-accent/15 text-accent' : 'text-subtle hover:bg-black/5'}`

  return (
    <div className="relative h-full min-h-0">
      {/* top-right: direction · connector · expand/collapse-all */}
      <div className="absolute right-3 top-2 z-10 flex items-center gap-1">
        <div className="flex items-center gap-0.5 rounded-full border border-black/10 bg-white/95 p-0.5 shadow-sm">
          <button onClick={() => switchDirection('horizontal')} className={pillBtn(horiz)} title="가로 트리">
            <MoveHorizontal size={14} />
          </button>
          <button onClick={() => switchDirection('vertical')} className={pillBtn(!horiz)} title="세로 트리">
            <MoveVertical size={14} />
          </button>
        </div>
        <div className="flex items-center gap-0.5 rounded-full border border-black/10 bg-white/95 p-0.5 shadow-sm">
          <button onClick={() => switchConnector('curved')} className={pillBtn(connector === 'curved')} title="곡선 연결선">
            <Spline size={14} />
          </button>
          <button onClick={() => switchConnector('angular')} className={pillBtn(connector === 'angular')} title="각진 연결선">
            <ElbowIcon size={14} />
          </button>
        </div>
        <button
          onClick={toggleAll}
          className="rounded-full border border-black/10 bg-white/95 p-1.5 text-subtle shadow-sm transition hover:bg-black/5"
          title={anyExpanded ? '모두 접기' : '모두 펼치기'}
        >
          {anyExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
        </button>
      </div>

      {/* bottom-right: zoom out · 100% reset · zoom in */}
      <div className="absolute bottom-3 right-3 z-10 flex items-center gap-0.5 rounded-full border border-black/10 bg-white/95 p-0.5 shadow-sm">
        <button onClick={() => setScale((s) => clamp(+(s - 0.15).toFixed(3), 0.3, 2.5))} className="rounded-full p-1.5 text-subtle hover:bg-black/5" title="축소">
          <ZoomOut size={14} />
        </button>
        <button onClick={() => setScale(1)} className="min-w-[42px] rounded-full px-1 py-1 text-center text-[11px] font-medium tabular-nums text-subtle hover:bg-black/5" title="100%로 되돌리기">
          {Math.round(scale * 100)}%
        </button>
        <button onClick={() => setScale((s) => clamp(+(s + 0.15).toFixed(3), 0.3, 2.5))} className="rounded-full p-1.5 text-subtle hover:bg-black/5" title="확대">
          <ZoomIn size={14} />
        </button>
      </div>

      <div ref={scrollRef} className="h-full overflow-auto">
        <div style={{ width: W * scale, height: H * scale }}>
          <div style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }}>
            <div data-mm-canvas style={{ position: 'relative', width: W, height: H, background: '#fff' }}>
              <svg width={W} height={H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                {connectorPaths().map((c) => (
                  <path key={c.key} d={c.d} fill="none" style={{ stroke: 'rgb(var(--accent) / 0.5)' }} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
                ))}
              </svg>

              {nodes.map((n) => {
                const pos = px(n)
                const isRoot = n.depth === 0
                const collapsedHere = n.hiddenCount > 0
                const editing = editId === n.id
                return (
                  <div
                    key={n.id}
                    className="dictly-mm-in group/mm absolute"
                    style={{ left: pos.left, top: pos.top, width: NODE_W, transition: 'left .26s cubic-bezier(.4,0,.2,1), top .26s cubic-bezier(.4,0,.2,1)' }}
                  >
                    {!editing && (
                      <div className="absolute -top-3 right-1 z-10 hidden items-center gap-0.5 rounded-md border border-black/10 bg-white px-0.5 py-0.5 shadow-sm group-hover/mm:flex">
                        <button onClick={() => startEdit(n.node)} className="rounded p-0.5 text-subtle hover:bg-black/5 hover:text-accent" title="수정">
                          <Pencil size={11} />
                        </button>
                        <button onClick={() => addChild(n)} className="rounded p-0.5 text-subtle hover:bg-black/5 hover:text-accent" title="하위 노드 추가">
                          <Plus size={12} />
                        </button>
                        {!isRoot && (
                          <button onClick={() => del(n)} className="rounded p-0.5 text-subtle hover:bg-red-50 hover:text-red-500" title="노드 삭제">
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    )}

                    <div
                      data-mm-node={n.id}
                      onDoubleClick={() => !editing && startEdit(n.node)}
                      style={{ minHeight: 30 }}
                      className={`flex items-center gap-1 rounded-xl border-2 px-2.5 py-2 shadow-sm transition ${
                        isRoot ? 'border-accent/70 bg-accent/10' : 'border-black/20 bg-white'
                      } ${editing ? 'border-accent' : ''}`}
                      title={editing ? undefined : '더블클릭하여 수정'}
                    >
                      {editing ? (
                        <textarea
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={(e) => {
                            if (e.nativeEvent.isComposing || e.keyCode === 229) return
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault()
                              commitEdit()
                            } else if (e.key === 'Escape') setEditId(null)
                          }}
                          rows={1}
                          className="min-w-0 flex-1 resize-none bg-transparent text-[12px] leading-snug text-ink outline-none"
                        />
                      ) : (
                        <div className="min-w-0 flex-1" onClick={(e) => (e.target as HTMLElement).closest('button') && e.stopPropagation()}>
                          <CitedMarkdown sources={item.sources} className={`${isRoot ? '!text-[13px] font-semibold' : '!text-[12px]'} !leading-snug [&_p]:!my-0 [&_p]:!leading-snug`}>
                            {n.node.label}
                          </CitedMarkdown>
                        </div>
                      )}
                    </div>

                    {n.hasChildren && (
                      <button
                        onClick={() => toggle(n.id, true)}
                        title={collapsedHere ? `하위 ${n.hiddenCount}개 펼치기` : '하위 트리 접기'}
                        style={
                          horiz
                            ? { position: 'absolute', right: -10, top: n.h / 2, transform: 'translateY(-50%)' }
                            : { position: 'absolute', bottom: -10, left: '50%', transform: 'translateX(-50%)' }
                        }
                        className={`z-10 flex h-5 min-w-5 items-center justify-center rounded-full border-2 px-0.5 text-[11px] font-bold leading-none shadow-sm transition ${
                          collapsedHere ? 'border-accent bg-accent text-white' : 'border-black/20 bg-white text-subtle hover:border-accent hover:text-accent'
                        }`}
                      >
                        {collapsedHere ? `+${n.hiddenCount}` : '−'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
