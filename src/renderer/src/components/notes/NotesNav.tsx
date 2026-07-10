import { useState } from 'react'
import { StickyNote, Plus, ChevronDown, ChevronRight, Hash, Folder as FolderIcon } from 'lucide-react'
import { useStore } from '../../store/useStore'
import type { NoteSummary } from '../../../../shared/types'

type Group = { key: string; label: string; icon: JSX.Element; notes: NoteSummary[] }

/** "메모" tab for the sidebar: toggles the Notes view + folder-grouped then hashtag-grouped lists
 *  (both shown stacked; each group dropdown is collapsed by default). */
export function NotesNav(): JSX.Element {
  const notesOpen = useStore((s) => s.notesOpen)
  const openNotes = useStore((s) => s.openNotes)
  const summaries = useStore((s) => s.noteSummaries)
  const selectNote = useStore((s) => s.selectNote)
  const selectedNoteId = useStore((s) => s.selectedNoteId)
  const newNote = useStore((s) => s.newNote)
  const folders = useStore((s) => s.folders)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({}) // default: all collapsed

  // folder groups
  const folderGroups: Group[] = []
  for (const f of folders) {
    const ns = summaries.filter((n) => n.folderId === f.id)
    if (ns.length) folderGroups.push({ key: `f${f.id}`, label: f.name, icon: <FolderIcon size={12} />, notes: ns })
  }
  const orphan = summaries.filter((n) => n.folderId == null || !folders.some((f) => f.id === n.folderId))
  if (orphan.length) folderGroups.push({ key: 'fnone', label: '폴더 없음', icon: <FolderIcon size={12} />, notes: orphan })

  // hashtag groups
  const hashtagGroups: Group[] = []
  for (const t of Array.from(new Set(summaries.flatMap((n) => n.hashtags))).sort()) {
    hashtagGroups.push({ key: `h${t}`, label: `#${t}`, icon: <Hash size={12} />, notes: summaries.filter((n) => n.hashtags.includes(t)) })
  }

  const Item = ({ n }: { n: NoteSummary }): JSX.Element => (
    <button
      onClick={() => selectNote(n.id)}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] no-drag ${
        notesOpen && selectedNoteId === n.id ? 'bg-black/[0.06] font-medium' : 'hover:bg-black/[0.04]'
      }`}
    >
      <span className="truncate">{n.title || '제목 없음'}</span>
    </button>
  )

  const GroupRow = ({ g }: { g: Group }): JSX.Element => {
    const open = !!expanded[g.key]
    return (
      <div className="mb-0.5">
        <button
          onClick={() => setExpanded((c) => ({ ...c, [g.key]: !c[g.key] }))}
          className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-[11.5px] font-semibold text-subtle hover:bg-black/[0.03]"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="shrink-0 text-subtle/70">{g.icon}</span>
          <span className="min-w-0 flex-1 truncate">{g.label}</span>
          <span className="text-[10.5px] text-subtle/70">{g.notes.length}</span>
        </button>
        <div className="grid transition-[grid-template-rows] duration-200 ease-out" style={{ gridTemplateRows: open ? '1fr' : '0fr' }}>
          <div className="overflow-hidden">
            <div className="ml-3">
              {g.notes.map((n) => (
                <Item key={n.id} n={n} />
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const Section = ({ label, groups }: { label: string; groups: Group[] }): JSX.Element | null => {
    if (groups.length === 0) return null
    return (
      <div className="mt-1">
        <div className="px-1.5 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-subtle/60">{label}</div>
        {groups.map((g) => (
          <GroupRow key={g.key} g={g} />
        ))}
      </div>
    )
  }

  return (
    <div className="mb-1">
      <div
        className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] font-medium no-drag ${
          notesOpen ? 'bg-black/[0.06] text-ink' : 'text-subtle hover:bg-black/[0.03]'
        }`}
      >
        <button onClick={() => void openNotes()} className="flex flex-1 items-center gap-2 text-left">
          <StickyNote size={15} className={notesOpen ? 'text-accent' : ''} /> 메모
        </button>
        <button onClick={() => void newNote(null)} className="rounded p-0.5 text-subtle hover:bg-black/10 hover:text-accent" title="새 노트">
          <Plus size={13} />
        </button>
      </div>

      {notesOpen && (
        <div className="ml-1 mt-1 border-l border-black/5 pl-1">
          {summaries.length === 0 && <div className="px-2 py-1 text-[12px] text-subtle">메모 없음 · + 로 추가</div>}
          <Section label="폴더별" groups={folderGroups} />
          <Section label="해시태그별" groups={hashtagGroups} />
        </div>
      )}
    </div>
  )
}
