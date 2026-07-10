import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import ListItem from '@tiptap/extension-list-item'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Mathematics } from '@tiptap/extension-mathematics'
import { CellSelection } from '@tiptap/pm/tables'
import { Bold, Italic, Underline as UnderlineIcon, Highlighter, List, ListOrdered, ListChecks, Table as TableIcon, Link2, AlignJustify, Loader2 } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { CiteChip, citeAttrs, fmtT } from './citeChip'
import { Hashtag, extractHashtags } from './hashtag'
import { SlashCommand, MentionCite, HashtagInput, type SuggestItem } from './suggestions'
import { Indent } from './indent'
import { EdgeParagraphs } from './edgeParagraphs'
import type { Note } from '../../../../shared/types'

/** allow a heading (not just a paragraph) as the first child of a list/task item */
const HEADING_LIST_CONTENT = '(paragraph | heading) block*'

/** insert a citation chip for the current recording time at the caret */
function insertTimeCite(editor: Editor, memoId: number | null): void {
  const t = Math.round(useStore.getState().rec.elapsedSec)
  editor.chain().insertContent({ type: 'citeChip', attrs: citeAttrs({ kind: 't', t, memoId }) }).run()
}

export function NoteEditor({ noteId, className = '' }: { noteId: number; className?: string }): JSX.Element {
  const lineSpacing = useStore((s) => s.noteLineSpacing)
  const setNoteLineSpacing = useStore((s) => s.setNoteLineSpacing)
  const [note, setNote] = useState<Note | null>(null)
  const [citeOn, setCiteOn] = useState(true)
  const [saving, setSaving] = useState(false)
  const [tableOpen, setTableOpen] = useState(false)
  const [spacingOpen, setSpacingOpen] = useState(false)
  const noteRef = useRef<Note | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // @-search across ALL lectures (transcript chunks) and ALL PDFs (page text). Each source shows
  // as a selectable title (whole-source tag) with matching chunks/pages nested beneath (specific tag).
  const search = useMemo(
    () =>
      async (query: string): Promise<SuggestItem[]> => {
        const hits = await window.api.notes.searchSources(query)
        const out: SuggestItem[] = []
        const memoHits = hits.filter((h) => h.kind === 'memo')
        const pdfHits = hits.filter((h) => h.kind === 'pdf')
        if (memoHits.length) {
          out.push({ label: '노트', header: true })
          for (const h of memoHits) {
            out.push({ label: h.title, hint: '전사 전체', depth: 0, cite: citeAttrs({ kind: 't', t: null, memoId: h.memoId, label: h.title }) })
            for (const c of h.children)
              out.push({
                label: fmtT(c.t ?? 0),
                hint: c.text.slice(0, 60),
                depth: 1,
                // chip shows the source title too, e.g. "44강 재무비율 분석 개요 0:14"
                cite: citeAttrs({ kind: 't', t: c.t ?? null, memoId: h.memoId, label: `${h.title} ${fmtT(c.t ?? 0)}` })
              })
          }
        }
        if (pdfHits.length) {
          out.push({ label: 'PDF', header: true })
          for (const h of pdfHits) {
            out.push({
              label: h.title,
              hint: 'PDF 전체',
              depth: 0,
              cite: citeAttrs({ kind: 'p', pdfId: h.pdfId ?? null, page: null, memoId: h.memoId, folderId: h.folderId, label: h.title })
            })
            for (const c of h.children)
              out.push({
                label: `p.${c.page}`,
                hint: c.text.slice(0, 60),
                depth: 1,
                // chip shows the PDF title too, e.g. "원가회계 강의계획서 p.3"
                cite: citeAttrs({ kind: 'p', pdfId: h.pdfId ?? null, page: c.page ?? null, memoId: h.memoId, folderId: h.folderId, label: `${h.title} p.${c.page}` })
              })
          }
        }
        return out
      },
    []
  )

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ listItem: false }),
      ListItem.extend({ content: HEADING_LIST_CONTENT }),
      Indent,
      EdgeParagraphs,
      Underline,
      Highlight,
      Link.configure({ autolink: true, openOnClick: false, HTMLAttributes: { rel: 'noopener', target: '_blank' } }),
      Placeholder.configure({ placeholder: "필기를 시작하세요 —  '/' 블록 ·  '@' 인용 ·  '#' 태그" }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.extend({ content: HEADING_LIST_CONTENT }).configure({ nested: true }),
      Mathematics,
      CiteChip,
      Hashtag,
      SlashCommand,
      MentionCite.configure({ search }),
      HashtagInput.configure({ tags: () => Array.from(new Set(useStore.getState().noteSummaries.flatMap((n) => n.hashtags))) })
    ],
    editorProps: {
      attributes: { class: 'dictly-note-prose focus:outline-none' },
      // open links on click via the OS browser (instead of an in-app window)
      handleClickOn(_view, _pos, node, _np, _ev) {
        const href = node.marks?.find((m) => m.type.name === 'link')?.attrs?.href
        if (href) {
          void window.api.shell.openExternal(href)
          return true
        }
        return false
      },
      handleKeyDown(view, event) {
        const ed = editorRef.current
        // ⌘/Ctrl+T → insert a table
        if ((event.metaKey || event.ctrlKey) && (event.key === 't' || event.key === 'T')) {
          ed?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          return true
        }
        // Backspace/Delete on a whole-table cell selection → delete the entire table
        if (event.key === 'Backspace' || event.key === 'Delete') {
          const sel = view.state.selection
          if (sel instanceof CellSelection && sel.isRowSelection() && sel.isColSelection()) {
            ed?.chain().focus().deleteTable().run()
            return true
          }
        }
        // auto time-citation: drop a chip on Enter while recording
        if (autoCiteActive() && event.key === 'Enter' && !event.shiftKey && ed) {
          insertTimeCite(ed, noteRef.current?.sourceMemoId ?? null)
          return false
        }
        return false
      },
      handleTextInput(_view, _from, _to, text) {
        if (!autoCiteActive()) return false
        if (/[.?!]/.test(text) && editorRef.current) {
          const ed = editorRef.current
          queueMicrotask(() => insertTimeCite(ed, noteRef.current?.sourceMemoId ?? null))
        }
        return false
      }
    },
    onUpdate: ({ editor }) => scheduleSave(editor)
  })
  const editorRef = useRef<Editor | null>(null)
  editorRef.current = editor

  const autoCiteActive = (): boolean => {
    const st = useStore.getState()
    const src = noteRef.current?.sourceMemoId
    return !!noteRef.current && noteRef.current.citeOn && st.rec.isRecording && src != null && st.recordingMemoId === src
  }

  const scheduleSave = (ed: Editor): void => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSaving(true)
    saveTimer.current = setTimeout(async () => {
      const json = ed.getJSON()
      await window.api.notes.update(noteId, {
        contentJson: JSON.stringify(json),
        plainText: ed.getText(),
        hashtags: extractHashtags(json)
      })
      setSaving(false)
      void useStore.getState().refreshNotes()
    }, 600)
  }

  // load note when noteId changes
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const n = await window.api.notes.get(noteId)
      if (cancelled || !n) return
      noteRef.current = n
      setNote(n)
      setCiteOn(n.citeOn)
      if (editorRef.current && n.contentJson) {
        try {
          editorRef.current.commands.setContent(JSON.parse(n.contentJson), false)
        } catch {
          /* empty/legacy */
        }
      } else editorRef.current?.commands.clearContent(false)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, editor])

  const toggleCite = async (): Promise<void> => {
    const v = !citeOn
    setCiteOn(v)
    if (noteRef.current) noteRef.current = { ...noteRef.current, citeOn: v }
    await window.api.notes.update(noteId, { citeOn: v })
  }

  if (!editor) return <div className={className} />

  const Btn = ({ on, active, title, children }: { on: () => void; active?: boolean; title: string; children: React.ReactNode }): JSX.Element => (
    <button
      onMouseDown={(e) => {
        e.preventDefault()
        on()
      }}
      title={title}
      className={`flex h-7 w-7 items-center justify-center rounded-md hover:bg-black/5 ${active ? 'bg-black/[0.06] text-accent' : 'text-subtle'}`}
    >
      {children}
    </button>
  )

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      {/* toolbar */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-black/5 px-2 py-1">
        <Btn on={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="볼드 (⌘B)">
          <Bold size={15} />
        </Btn>
        <Btn on={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="이탤릭 (⌘I)">
          <Italic size={15} />
        </Btn>
        <Btn on={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="밑줄 (⌘U)">
          <UnderlineIcon size={15} />
        </Btn>
        <Btn on={() => editor.chain().focus().toggleHighlight().run()} active={editor.isActive('highlight')} title="하이라이트">
          <Highlighter size={15} />
        </Btn>
        <div className="mx-1 h-4 w-px bg-black/10" />
        <Btn on={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="글머리 목록">
          <List size={15} />
        </Btn>
        <Btn on={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="번호 목록">
          <ListOrdered size={15} />
        </Btn>
        <Btn on={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive('taskList')} title="체크리스트">
          <ListChecks size={15} />
        </Btn>
        <div className="relative">
          <Btn on={() => setTableOpen((o) => !o)} active={tableOpen} title="표 삽입 (⌘T)">
            <TableIcon size={15} />
          </Btn>
          {tableOpen && (
            <TableSizePopover
              onClose={() => setTableOpen(false)}
              onInsert={(rows, cols) => {
                editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()
                setTableOpen(false)
              }}
            />
          )}
        </div>
        <div className="flex-1" />
        {/* line spacing */}
        <div className="relative">
          <Btn on={() => setSpacingOpen((o) => !o)} active={spacingOpen} title="줄 간격">
            <AlignJustify size={15} />
          </Btn>
          {spacingOpen && (
            <LineSpacingPopover
              value={lineSpacing}
              onChange={(v) => setNoteLineSpacing(v)}
              onClose={() => setSpacingOpen(false)}
            />
          )}
        </div>
        {note?.sourceMemoId != null && (
          <button
            onClick={() => void toggleCite()}
            title={`녹음 중 문장 끝에 시간 인용 자동 추가 (${citeOn ? 'ON' : 'OFF'})`}
            className="ml-0.5 flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-black/5"
          >
            <Link2 size={14} className={citeOn ? 'text-accent' : 'text-subtle'} />
            <span className={`relative h-3.5 w-6 rounded-full transition-colors ${citeOn ? 'bg-accent' : 'bg-black/20'}`}>
              <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white shadow-sm transition-all ${citeOn ? 'left-[11px]' : 'left-0.5'}`} />
            </span>
          </button>
        )}
        {saving && <Loader2 size={13} className="ml-1 animate-spin text-subtle" />}
      </div>

      {/* editor body — click anywhere in the empty area to place the caret */}
      <div
        className="min-h-0 flex-1 cursor-text overflow-y-auto px-5 py-4"
        style={{ lineHeight: lineSpacing }}
        onMouseDown={(e) => {
          if (!(e.target as HTMLElement).closest('.dictly-note-prose')) {
            e.preventDefault()
            editor.chain().focus('end').run()
          }
        }}
      >
        <EditorContent editor={editor} className="min-h-full" />
      </div>
      <TableMenu editor={editor} />
    </div>
  )
}

/** small "rows × cols" popover anchored under the table toolbar button */
function TableSizePopover({ onInsert, onClose }: { onInsert: (rows: number, cols: number) => void; onClose: () => void }): JSX.Element {
  const [rows, setRows] = useState(3)
  const [cols, setCols] = useState(3)
  const clamp = (n: number): number => Math.min(20, Math.max(1, Math.round(n || 1)))
  return (
    <>
      <div className="fixed inset-0 z-[70]" onMouseDown={onClose} />
      <div className="absolute left-0 top-9 z-[71] w-44 rounded-xl border border-black/10 bg-white p-3 shadow-xl">
        <div className="mb-2 flex items-center gap-2">
          <label className="flex flex-1 items-center gap-1 text-[12px] text-subtle">
            행
            <input
              type="number"
              min={1}
              max={20}
              value={rows}
              onChange={(e) => setRows(clamp(Number(e.target.value)))}
              className="w-full rounded-md border border-black/10 px-1.5 py-1 text-[13px] text-ink focus:outline-none"
            />
          </label>
          <label className="flex flex-1 items-center gap-1 text-[12px] text-subtle">
            열
            <input
              type="number"
              min={1}
              max={20}
              value={cols}
              onChange={(e) => setCols(clamp(Number(e.target.value)))}
              className="w-full rounded-md border border-black/10 px-1.5 py-1 text-[13px] text-ink focus:outline-none"
            />
          </label>
        </div>
        <button
          onMouseDown={(e) => {
            e.preventDefault()
            onInsert(clamp(rows), clamp(cols))
          }}
          className="w-full rounded-md bg-accent py-1.5 text-[12px] font-semibold text-white hover:opacity-90"
        >
          표 삽입
        </button>
      </div>
    </>
  )
}

/** line-spacing presets popover */
function LineSpacingPopover({ value, onChange, onClose }: { value: number; onChange: (v: number) => void; onClose: () => void }): JSX.Element {
  const presets: [string, number][] = [
    ['좁게', 1.4],
    ['보통', 1.7],
    ['넓게', 2.0],
    ['더 넓게', 2.4]
  ]
  return (
    <>
      <div className="fixed inset-0 z-[70]" onMouseDown={onClose} />
      <div className="absolute right-0 top-9 z-[71] w-40 rounded-xl border border-black/10 bg-white p-1.5 shadow-xl">
        {presets.map(([label, v]) => (
          <button
            key={v}
            onMouseDown={(e) => {
              e.preventDefault()
              onChange(v)
              onClose()
            }}
            className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-[13px] hover:bg-black/5 ${Math.abs(value - v) < 0.06 ? 'font-semibold text-accent' : 'text-ink'}`}
          >
            {label}
            <span className="text-[11px] tabular-nums text-subtle">{v.toFixed(1)}</span>
          </button>
        ))}
      </div>
    </>
  )
}

/** floating toolbar above a table: row actions on a full-row drag, column actions on a full-column
 *  drag (whole-table drag shows both + 표 삭제). Portaled to <body> so it isn't clipped by the
 *  resizable panels' transformed/overflow ancestors (e.g. the lecture-screen memo panel). */
function TableMenu({ editor }: { editor: Editor }): JSX.Element | null {
  const [, force] = useState(0)
  useEffect(() => {
    const rerender = (): void => force((n) => n + 1)
    editor.on('selectionUpdate', rerender)
    editor.on('transaction', rerender)
    window.addEventListener('scroll', rerender, true)
    window.addEventListener('resize', rerender)
    return () => {
      editor.off('selectionUpdate', rerender)
      editor.off('transaction', rerender)
      window.removeEventListener('scroll', rerender, true)
      window.removeEventListener('resize', rerender)
    }
  }, [editor])

  const sel = editor.state.selection
  if (!(sel instanceof CellSelection)) return null
  const isRow = sel.isRowSelection()
  const isCol = sel.isColSelection()
  if (!isRow && !isCol) return null // only on a full-row or full-column (or whole-table) drag
  const table = findTableEl(editor)
  if (!table) return null
  const r = table.getBoundingClientRect()
  const left = Math.max(8, Math.min(r.left, window.innerWidth - 360))
  const top = Math.max(8, r.top - 40)

  const mkBtn = (txt: string, tip: string, fn: () => void, del = false): JSX.Element => (
    <button
      onMouseDown={(e) => {
        e.preventDefault()
        fn()
      }}
      title={tip}
      className={`flex h-6 items-center rounded-md px-1.5 text-[11px] font-medium hover:bg-black/5 ${del ? 'text-rose-500 hover:bg-rose-500/10' : 'text-ink'}`}
    >
      {txt}
    </button>
  )

  const menu = (
    <div
      className="fixed z-[90] flex items-center gap-1 rounded-lg border border-black/10 bg-white px-1.5 py-1 shadow-xl"
      style={{ top, left }}
    >
      {isRow && (
        <div className="flex items-center gap-0.5">
          <span className="px-1 text-[10px] font-semibold text-subtle/60">행</span>
          {mkBtn('위', '위에 행 추가', () => editor.chain().focus().addRowBefore().run())}
          {mkBtn('아래', '아래에 행 추가', () => editor.chain().focus().addRowAfter().run())}
          {mkBtn('삭제', '선택한 행 삭제', () => editor.chain().focus().deleteRow().run(), true)}
        </div>
      )}
      {isRow && isCol && <div className="mx-0.5 h-4 w-px bg-black/10" />}
      {isCol && (
        <div className="flex items-center gap-0.5">
          <span className="px-1 text-[10px] font-semibold text-subtle/60">열</span>
          {mkBtn('왼쪽', '왼쪽에 열 추가', () => editor.chain().focus().addColumnBefore().run())}
          {mkBtn('오른쪽', '오른쪽에 열 추가', () => editor.chain().focus().addColumnAfter().run())}
          {mkBtn('삭제', '선택한 열 삭제', () => editor.chain().focus().deleteColumn().run(), true)}
        </div>
      )}
      {isRow && isCol && (
        <>
          <div className="mx-0.5 h-4 w-px bg-black/10" />
          {mkBtn('표 삭제', '표 전체 삭제', () => editor.chain().focus().deleteTable().run(), true)}
        </>
      )}
    </div>
  )
  return createPortal(menu, document.body)
}

/** the <table> element holding the current selection (drag-selected cells, else the caret's cell) */
function findTableEl(editor: Editor): HTMLElement | null {
  const sc = editor.view.dom.querySelector('td.selectedCell, th.selectedCell')
  if (sc) return sc.closest('table')
  try {
    const dom = editor.view.domAtPos(editor.state.selection.from)
    const el = (dom.node.nodeType === 3 ? dom.node.parentElement : dom.node) as HTMLElement | null
    return el?.closest?.('table') ?? null
  } catch {
    return null
  }
}
