import { useEffect, useRef, useState } from 'react'
import { NotebookPen, Trash2, Plus } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { NoteEditor } from './NoteEditor'

/** Center view for the 메모 tab — title + the connected-note editor for the selected note. */
export function NotesView(): JSX.Element {
  const selectedNoteId = useStore((s) => s.selectedNoteId)
  const summaries = useStore((s) => s.noteSummaries)
  const newNote = useStore((s) => s.newNote)
  const deleteNote = useStore((s) => s.deleteNote)
  const refreshNotes = useStore((s) => s.refreshNotes)
  const requestConfirm = useStore((s) => s.requestConfirm)
  const cur = summaries.find((n) => n.id === selectedNoteId) ?? null

  const [title, setTitle] = useState('')
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => setTitle(cur?.title ?? ''), [cur?.id, cur?.title])

  const saveTitle = (v: string): void => {
    setTitle(v)
    if (titleTimer.current) clearTimeout(titleTimer.current)
    if (selectedNoteId == null) return
    titleTimer.current = setTimeout(async () => {
      await window.api.notes.update(selectedNoteId, { title: v })
      void refreshNotes()
    }, 500)
  }

  if (selectedNoteId == null || !cur) {
    return (
      <div className="dictly-anim-in flex h-full flex-col items-center justify-center gap-3 bg-panel text-subtle">
        <NotebookPen size={26} className="opacity-40" />
        <p className="text-[14px]">노트를 선택하거나 새로 만들어 보세요</p>
        <button
          onClick={() => void newNote(null)}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:bg-accent/90"
        >
          <Plus size={14} /> 새 노트
        </button>
      </div>
    )
  }

  return (
    <div className="dictly-anim-in flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 px-4 pt-3">
        <input
          value={title}
          onChange={(e) => saveTitle(e.target.value)}
          placeholder="제목 없음"
          className="min-w-0 flex-1 bg-transparent text-[18px] font-semibold text-ink outline-none placeholder:text-subtle/50"
        />
        {cur.hashtags.length > 0 && (
          <div className="flex shrink-0 items-center gap-1 overflow-hidden">
            {cur.hashtags.slice(0, 4).map((t) => (
              <span key={t} className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent">
                #{t}
              </span>
            ))}
          </div>
        )}
        <button
          onClick={() => requestConfirm('이 노트를 삭제할까요?', () => void deleteNote(cur.id))}
          className="shrink-0 rounded-lg p-1.5 text-subtle hover:bg-black/5 hover:text-red-500"
          title="노트 삭제"
        >
          <Trash2 size={16} />
        </button>
      </div>
      <NoteEditor key={cur.id} noteId={cur.id} className="min-h-0 flex-1" />
    </div>
  )
}
