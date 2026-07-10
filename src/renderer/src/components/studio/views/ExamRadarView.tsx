// 시험 레이더 — concepts on a 중요도(X)×난이도(Y) quadrant map with concept edges and a
// 상위↔하위 decomposition slider. Positions are RELATIVE (percentile-ranked among the shown
// concepts) so they spread across the plane instead of clustering. Pure SVG + percent-positioned
// dots (no graph lib); position changes animate via CSS transitions.
import { useMemo, useState } from 'react'
import type { ExamRadarContent, ExamRadarNode, StudioItem } from '../../../../../shared/types'
import { stripCiteTokens } from '../../../lib/citations'
import { MarkdownMath } from '../../MarkdownMath'

interface Placed extends ExamRadarNode {
  x: number // 0..100 (importance, relative)
  y: number // 0..100 (top = hard, relative)
  r: number // dot radius px
  imp: number // 0..1 importance rank (size/label/colour)
  showLabel: boolean
}

/** fractional percentile rank in 0..1 (ties share the middle), so values spread evenly */
function pctRanks(vals: number[]): number[] {
  const n = vals.length
  return vals.map((v) => {
    let lt = 0
    let eq = 0
    for (const w of vals) {
      if (w < v) lt++
      else if (w === v) eq++
    }
    return n <= 1 ? 0.5 : (lt + (eq - 1) / 2) / (n - 1)
  })
}

// push overlapping dots apart in the 0..100 percent space (relaxation passes)
function separate(nodes: Placed[]): void {
  const MIN = 11
  for (let pass = 0; pass < 80; pass++) {
    let moved = false
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        let d = Math.hypot(dx, dy)
        if (d < 0.01) {
          dx = (i % 2 ? 1 : -1) * 0.6
          dy = (j % 2 ? 1 : -1) * 0.6
          d = 0.8
        }
        if (d < MIN) {
          const push = (MIN - d) / 2
          const ux = (dx / d) * push
          const uy = (dy / d) * push
          a.x = Math.max(4, Math.min(96, a.x - ux))
          a.y = Math.max(5, Math.min(95, a.y - uy))
          b.x = Math.max(4, Math.min(96, b.x + ux))
          b.y = Math.max(5, Math.min(95, b.y + uy))
          moved = true
        }
      }
    }
    if (!moved) break
  }
}

function Label({ text, size }: { text: string; size: string }): JSX.Element {
  return (
    <div className={`${size} text-center leading-tight text-ink [&_.katex]:text-[0.95em] [&_p]:!my-0`}>
      <MarkdownMath className="!text-inherit">{stripCiteTokens(text)}</MarkdownMath>
    </div>
  )
}

export function ExamRadarView({ item }: { item: StudioItem }): JSX.Element {
  const content = item.content as ExamRadarContent
  const nodes = content.nodes ?? []
  const edges = content.edges ?? []
  const maxLevel = useMemo(() => nodes.reduce((m, n) => Math.max(m, n.level || 0), 0), [nodes])
  const [level, setLevel] = useState(0)
  const [hover, setHover] = useState<string | null>(null)

  const hasChild = useMemo(() => {
    const s = new Set<string>()
    nodes.forEach((n) => n.parentId && s.add(n.parentId))
    return s
  }, [nodes])

  // decomposition frontier: at slider L show level-L nodes + shallower leaves (branches that
  // don't reach depth L stay). Increasing L "splits" a parent dot into its children.
  const placed = useMemo(() => {
    const visible = nodes.filter((n) => (n.level || 0) <= level && ((n.level || 0) === level || !hasChild.has(n.id)))
    const impR = pctRanks(visible.map((n) => n.importance))
    const diffR = pctRanks(visible.map((n) => n.difficulty))
    // de-clutter labels: always show the more important half; the rest reveal on hover.
    // with few nodes there's no clutter — show every label (labelCut = -1 ⇒ all pass).
    const impSorted = [...impR].sort((a, b) => b - a)
    const labelCut = visible.length <= 8 ? -1 : (impSorted[Math.min(impSorted.length - 1, Math.ceil(visible.length * 0.55))] ?? 0)
    const arr: Placed[] = visible.map((n, i) => ({
      ...n,
      imp: impR[i],
      x: 6 + impR[i] * 88,
      y: 6 + (1 - diffR[i]) * 88,
      r: 7 + impR[i] * 32 + Math.max(0, 2 - (n.level || 0)) * 4, // wide size variance
      showLabel: impR[i] >= labelCut
    }))
    separate(arr)
    return arr
  }, [nodes, level, hasChild])

  const posById = useMemo(() => {
    const m = new Map<string, Placed>()
    placed.forEach((p) => m.set(p.id, p))
    return m
  }, [placed])
  const visibleEdges = edges.filter((e) => posById.has(e.from) && posById.has(e.to))

  return (
    <div className="flex h-full flex-col">
      <div className="relative mx-3 mt-2 flex-1 overflow-hidden">
        {/* faint quadrant guides (no background fill / outline) + corner labels */}
        <div className="pointer-events-none absolute left-1/2 top-0 h-full w-px bg-black/[0.06]" />
        <div className="pointer-events-none absolute left-0 top-1/2 h-px w-full bg-black/[0.06]" />
        <div className="pointer-events-none absolute bottom-1 right-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700">
          지금 공부 (중요·쉬움)
        </div>
        <div className="pointer-events-none absolute right-1 top-1 text-[10.5px] text-subtle/60">고난도</div>
        <div className="pointer-events-none absolute bottom-1 left-1 text-[10.5px] text-subtle/60">저중요</div>

        {/* edges */}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {visibleEdges.map((e, i) => {
            const a = posById.get(e.from) as Placed
            const b = posById.get(e.to) as Placed
            const active = hover === e.from || hover === e.to
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={active ? 'rgb(var(--accent))' : 'rgb(var(--accent) / 0.32)'}
                strokeWidth={active ? 1.4 : 0.8}
                vectorEffect="non-scaling-stroke"
                className="transition-all duration-500"
              />
            )
          })}
        </svg>

        {/* dots */}
        {placed.map((n) => {
          const dim = hover && hover !== n.id
          return (
            <div
              key={n.id}
              className="absolute z-10 -translate-x-1/2 -translate-y-1/2 transition-all duration-500 ease-out"
              style={{ left: `${n.x}%`, top: `${n.y}%`, opacity: dim ? 0.55 : 1, zIndex: hover === n.id ? 40 : 10 }}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover((v) => (v === n.id ? null : v))}
            >
              <div
                className="dictly-pop-in rounded-full ring-2 ring-white"
                style={{
                  width: n.r,
                  height: n.r,
                  background: `rgb(var(--accent) / ${0.42 + n.imp * 0.55})`,
                  boxShadow: '0 1px 5px rgba(15,14,71,0.28)'
                }}
              />
              {(n.showLabel || hover === n.id) && (
                <div className="pointer-events-none absolute left-1/2 top-full mt-0.5 w-[132px] -translate-x-1/2">
                  <Label text={n.label} size="text-[10.5px]" />
                </div>
              )}
              {hover === n.id && (
                <div className="absolute left-1/2 top-full z-50 mt-5 w-56 -translate-x-1/2 rounded-xl border border-black/10 bg-white p-2.5 text-left shadow-xl">
                  <Label text={n.label} size="mb-1 text-[12.5px] font-semibold" />
                  {n.explanation && <div className="mb-1 text-[11.5px] leading-snug text-subtle">{stripCiteTokens(n.explanation)}</div>}
                  <div className="flex gap-2 text-[10.5px] text-subtle">
                    <span>중요도 {n.importance}</span>
                    <span>난이도 {n.difficulty}</span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* decomposition slider */}
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="shrink-0 text-[11.5px] font-medium text-subtle">상위개념</span>
        <input
          type="range"
          min={0}
          max={Math.max(0, maxLevel)}
          step={1}
          value={level}
          disabled={maxLevel === 0}
          onChange={(e) => setLevel(Number(e.target.value))}
          className="h-1 flex-1 accent-accent disabled:opacity-40"
        />
        <span className="shrink-0 text-[11.5px] font-medium text-subtle">하위개념</span>
        <span className="shrink-0 rounded-md bg-black/5 px-1.5 py-0.5 text-[11px] tabular-nums text-subtle">{placed.length}개</span>
      </div>
    </div>
  )
}
