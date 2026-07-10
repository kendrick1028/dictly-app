import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { CitedMarkdown } from '../cite/CitedMarkdown'
import type { StudioItem, TablesContent } from '../../../../../shared/types'

/** one table at a time with a pager (KaTeX + citation chips per cell) */
export function TablesView({ item }: { item: StudioItem }): JSX.Element {
  const tables = (item.content as TablesContent).tables
  const [idx, setIdx] = useState(0)

  useEffect(() => setIdx(0), [item.id])

  // ←/→ arrow keys page through tables (ignored while typing in a field)
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        setIdx((i) => Math.min(tables.length - 1, i + 1))
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setIdx((i) => Math.max(0, i - 1))
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [tables.length])

  const t = tables[idx]
  if (!t) return <div className="p-4 text-[13px] text-subtle">표가 없습니다</div>

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        <div className="mb-2 text-[13.5px] font-semibold text-ink">{t.title}</div>
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              {t.headers.map((h, i) => (
                <th key={i} className="border border-black/10 bg-black/[0.04] px-2 py-1.5 text-left font-semibold text-ink">
                  <CitedMarkdown sources={item.sources} className="!text-[12.5px] [&_p]:!my-0">
                    {h}
                  </CitedMarkdown>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((row, ri) => (
              <tr key={ri} className={ri % 2 ? 'bg-black/[0.015]' : ''}>
                {row.map((cell, ci) => (
                  <td key={ci} className="border border-black/10 px-2 py-1.5 align-top">
                    <CitedMarkdown sources={item.sources} className="!text-[12.5px] [&_p]:!my-0">
                      {cell}
                    </CitedMarkdown>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {tables.length > 1 && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-t border-black/5 py-2">
          <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0} className="rounded-full p-1.5 text-subtle hover:bg-black/5 disabled:opacity-30">
            <ChevronLeft size={15} />
          </button>
          <div className="flex items-center gap-1.5">
            {tables.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-4 bg-accent' : 'w-1.5 bg-black/15 hover:bg-black/25'}`}
                title={tables[i].title}
              />
            ))}
          </div>
          <button
            onClick={() => setIdx((i) => Math.min(tables.length - 1, i + 1))}
            disabled={idx >= tables.length - 1}
            className="rounded-full p-1.5 text-subtle hover:bg-black/5 disabled:opacity-30"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  )
}
