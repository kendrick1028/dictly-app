import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../../store/useStore'
import { CitedMarkdown } from '../cite/CitedMarkdown'
import type { StudioItem, SummaryContent } from '../../../../../shared/types'

/** markdown summary/report with inline citations; click body to edit (persisted) */
export function SummaryView({ item }: { item: StudioItem }): JSX.Element {
  const refreshStudioItems = useStore((s) => s.refreshStudioItems)
  const content = item.content as SummaryContent
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(content.md)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => setDraft(content.md), [content.md, item.id])

  useEffect(() => {
    if (editing && taRef.current) {
      const ta = taRef.current
      ta.style.height = 'auto'
      ta.style.height = `${ta.scrollHeight}px`
      ta.focus()
    }
  }, [editing])

  const save = async (): Promise<void> => {
    setEditing(false)
    if (draft === content.md) return
    await window.api.studio.update(item.id, { content: { md: draft } })
    await refreshStudioItems()
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-3">
      {editing ? (
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            const ta = taRef.current
            if (ta) {
              ta.style.height = 'auto'
              ta.style.height = `${ta.scrollHeight}px`
            }
          }}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
              e.preventDefault()
              void save()
            }
          }}
          className="w-full resize-none rounded-xl border border-accent/40 bg-white px-3 py-2 text-[14px] leading-relaxed outline-none"
        />
      ) : (
        <div onClick={() => setEditing(true)} className="cursor-text" title="클릭하면 수정">
          <CitedMarkdown sources={item.sources}>{content.md}</CitedMarkdown>
        </div>
      )}
    </div>
  )
}
