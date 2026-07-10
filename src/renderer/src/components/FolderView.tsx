// Folder workspace: 소스(체크박스 목록) | 미리보기 | 스튜디오(폴더 소스 기반 생성).
import { useEffect, useState } from 'react'
import { Panel, PanelGroup } from 'react-resizable-panels'
import { ChevronRight, FileText, FolderOpen, StickyNote, Volume2 } from 'lucide-react'
import { useStore } from '../store/useStore'
import { ResizeHandle } from './ResizeHandle'
import { StudioPanel, StudioRail } from './StudioPanel'
import { TranscriptPreview } from './folder/TranscriptPreview'
import { PdfPreview } from './folder/PdfPreview'
import { NoteEditor } from './notes/NoteEditor'
import type { MemoSummary, NoteSummary, PdfDoc } from '../../../shared/types'

const CARD = 'h-full min-h-0 overflow-hidden rounded-xl border border-black/5 bg-panel shadow-sm'

function Check({ on }: { on: boolean }): JSX.Element {
  return (
    <span
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
        on ? 'border-accent bg-accent text-white' : 'border-black/20 bg-white'
      }`}
    >
      {on && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
    </span>
  )
}

/** Collapsible source-group header with a 전체 선택/해제 toggle. */
function SectionHeader({
  icon,
  label,
  count,
  open,
  onToggle,
  allOn,
  onSelectAll
}: {
  icon: JSX.Element
  label: string
  count: number
  open: boolean
  onToggle: () => void
  allOn: boolean
  onSelectAll: () => void
}): JSX.Element {
  return (
    <div className="mb-1 mt-1 flex items-center gap-1 px-1.5">
      <button onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-1 text-[11px] font-medium text-subtle hover:text-ink">
        <ChevronRight size={11} className={`shrink-0 transition ${open ? 'rotate-90' : ''}`} />
        {icon}
        <span className="truncate">
          {label} ({count})
        </span>
      </button>
      {count > 0 && (
        <button
          onClick={onSelectAll}
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-subtle hover:bg-black/5 hover:text-accent"
          title={allOn ? '전체 해제' : '전체 선택'}
        >
          {allOn ? '전체 해제' : '전체 선택'}
        </button>
      )}
    </div>
  )
}

function SourcesPane(): JSX.Element {
  const memos = useStore((s) => s.memos)
  const folderPdfs = useStore((s) => s.folderPdfs)
  const folderNotes = useStore((s) => s.folderNotes)
  const srcMemoIds = useStore((s) => s.folderSrcMemoIds)
  const srcPdfIds = useStore((s) => s.folderSrcPdfIds)
  const srcNoteIds = useStore((s) => s.folderSrcNoteIds)
  const toggleMemo = useStore((s) => s.toggleFolderSrcMemo)
  const togglePdf = useStore((s) => s.toggleFolderSrcPdf)
  const toggleNote = useStore((s) => s.toggleFolderSrcNote)
  const setMemoIds = useStore((s) => s.setFolderSrcMemoIds)
  const setPdfIds = useStore((s) => s.setFolderSrcPdfIds)
  const setNoteIds = useStore((s) => s.setFolderSrcNoteIds)
  const setPreview = useStore((s) => s.setFolderPreview)
  const preview = useStore((s) => s.folderPreview)
  const [transcriptsOpen, setTranscriptsOpen] = useState(true)
  const [pdfsOpen, setPdfsOpen] = useState(true)
  const [notesOpen, setNotesOpen] = useState(true)

  // de-dup PDFs by NAME (same file attached to several notes shows once — keep the first occurrence)
  const pdfs: PdfDoc[] = []
  const seenNames = new Set<string>()
  for (const p of folderPdfs) {
    if (!seenNames.has(p.name)) {
      seenNames.add(p.name)
      pdfs.push(p)
    }
  }

  const memoActive = (m: MemoSummary): boolean => preview?.kind === 'memo' && preview.memoId === m.id
  const pdfActive = (p: PdfDoc): boolean => preview?.kind === 'pdf' && preview.pdf.id === p.id
  const noteActive = (n: NoteSummary): boolean => preview?.kind === 'note' && preview.noteId === n.id
  const allMemosOn = memos.length > 0 && memos.every((m) => srcMemoIds.includes(m.id))
  const allPdfsOn = pdfs.length > 0 && pdfs.every((p) => srcPdfIds.includes(p.id))
  const allNotesOn = folderNotes.length > 0 && folderNotes.every((n) => srcNoteIds.includes(n.id))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-3 pb-1.5 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">소스</div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {/* 전사문 그룹 */}
        <SectionHeader
          icon={<Volume2 size={12} className="shrink-0" />}
          label="전사문"
          count={memos.length}
          open={transcriptsOpen}
          onToggle={() => setTranscriptsOpen((v) => !v)}
          allOn={allMemosOn}
          onSelectAll={() => setMemoIds(allMemosOn ? [] : memos.map((m) => m.id))}
        />
        {transcriptsOpen && (
          <>
            {memos.length === 0 && <div className="px-2 py-1 text-[12px] text-subtle">메모 없음</div>}
            {memos.map((m) => (
              <div
                key={m.id}
                className={`group flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-[13px] ${memoActive(m) ? 'bg-accent/[0.08]' : 'hover:bg-black/[0.04]'}`}
              >
                <button onClick={() => toggleMemo(m.id)} title="스튜디오 소스로 선택">
                  <Check on={srcMemoIds.includes(m.id)} />
                </button>
                <button onClick={() => setPreview({ kind: 'memo', memoId: m.id, nonce: Date.now() })} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                  <FileText size={13} className="shrink-0 text-subtle" />
                  <span className="truncate">{m.title}</span>
                </button>
              </div>
            ))}
          </>
        )}

        {/* PDF 그룹 */}
        <div className="mt-2">
          <SectionHeader
            icon={<FileText size={12} className="shrink-0" />}
            label="PDF"
            count={pdfs.length}
            open={pdfsOpen}
            onToggle={() => setPdfsOpen((v) => !v)}
            allOn={allPdfsOn}
            onSelectAll={() => setPdfIds(allPdfsOn ? [] : pdfs.map((p) => p.id))}
          />
        </div>
        {pdfsOpen && (
          <>
            {pdfs.length === 0 && <div className="px-2 py-1 text-[12px] text-subtle">첨부된 PDF 없음</div>}
            {pdfs.map((p) => (
              <div
                key={p.id}
                className={`group flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-[13px] ${pdfActive(p) ? 'bg-accent/[0.08]' : 'hover:bg-black/[0.04]'}`}
              >
                <button onClick={() => togglePdf(p.id)} title="스튜디오 소스로 선택">
                  <Check on={srcPdfIds.includes(p.id)} />
                </button>
                <button onClick={() => setPreview({ kind: 'pdf', pdf: p, nonce: Date.now() })} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                  {p.inherited ? <FolderOpen size={13} className="shrink-0 text-subtle" /> : <FileText size={13} className="shrink-0 text-subtle" />}
                  <span className="truncate" title={p.name}>
                    {p.name}
                  </span>
                </button>
              </div>
            ))}
          </>
        )}

        {/* 노트(필기) 그룹 — 각 강의에 연결된 필기 노트 */}
        <div className="mt-2">
          <SectionHeader
            icon={<StickyNote size={12} className="shrink-0" />}
            label="노트"
            count={folderNotes.length}
            open={notesOpen}
            onToggle={() => setNotesOpen((v) => !v)}
            allOn={allNotesOn}
            onSelectAll={() => setNoteIds(allNotesOn ? [] : folderNotes.map((n) => n.id))}
          />
        </div>
        {notesOpen && (
          <>
            {folderNotes.length === 0 && <div className="px-2 py-1 text-[12px] text-subtle">연결된 노트 없음</div>}
            {folderNotes.map((n) => (
              <div
                key={n.id}
                className={`group flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-[13px] ${noteActive(n) ? 'bg-accent/[0.08]' : 'hover:bg-black/[0.04]'}`}
              >
                <button onClick={() => toggleNote(n.id)} title="스튜디오 소스로 선택">
                  <Check on={srcNoteIds.includes(n.id)} />
                </button>
                <button onClick={() => setPreview({ kind: 'note', noteId: n.id, nonce: Date.now() })} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                  <StickyNote size={13} className="shrink-0 text-subtle" />
                  <span className="truncate" title={n.title || '제목 없는 노트'}>
                    {n.title || '제목 없는 노트'}
                  </span>
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function PreviewPane(): JSX.Element {
  const preview = useStore((s) => s.folderPreview)
  const memos = useStore((s) => s.memos)
  const folderNotes = useStore((s) => s.folderNotes)
  const title = preview
    ? preview.kind === 'memo'
      ? (memos.find((m) => m.id === preview.memoId)?.title ?? '전사문')
      : preview.kind === 'pdf'
        ? preview.pdf.name
        : (folderNotes.find((n) => n.id === preview.noteId)?.title || '제목 없는 노트')
    : null
  const TitleIcon = preview?.kind === 'pdf' ? (preview.pdf.inherited ? FolderOpen : FileText) : preview?.kind === 'note' ? StickyNote : Volume2

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 pb-1.5 pt-2.5">
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-subtle">미리보기</span>
        {title && (
          <>
            <span className="shrink-0 text-subtle">·</span>
            <TitleIcon size={12} className="shrink-0 text-subtle" />
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink" title={title}>
              {title}
            </span>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden border-t border-black/5">
        {!preview ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-subtle">
            왼쪽 소스에서 전사문·PDF·노트를 클릭하면
            <br />
            여기에 미리보기가 표시됩니다
          </div>
        ) : preview.kind === 'memo' ? (
          <TranscriptPreview memoId={preview.memoId} t={preview.t} nonce={preview.nonce} />
        ) : preview.kind === 'pdf' ? (
          <PdfPreview pdf={preview.pdf} page={preview.page} nonce={preview.nonce} />
        ) : (
          <NoteEditor key={preview.noteId} noteId={preview.noteId} className="h-full" />
        )}
      </div>
    </div>
  )
}

export function FolderView(): JSX.Element {
  const folders = useStore((s) => s.folders)
  const selectedFolderId = useStore((s) => s.selectedFolderId)
  const studioFullscreen = useStore((s) => s.studioFullscreen)
  const studioCollapsed = useStore((s) => s.studioCollapsed)
  const renameFolder = useStore((s) => s.renameFolder)
  const folder = folders.find((f) => f.id === selectedFolderId)
  const [title, setTitle] = useState('')
  useEffect(() => setTitle(folder?.name ?? ''), [folder?.id, folder?.name])

  const studioOpen = !studioCollapsed

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      <div className="flex h-12 shrink-0 items-center gap-2 px-4 pt-1">
        <FolderOpen size={16} className="shrink-0 text-subtle" />
        <input
          className="min-w-[48px] max-w-[60%] bg-transparent text-[15px] font-semibold outline-none"
          style={{ fieldSizing: 'content' } as React.CSSProperties}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => folder && title.trim() && title !== folder.name && void renameFolder(folder.id, title.trim())}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          title="폴더 이름 편집"
        />
        <span className="shrink-0 text-[12px] text-subtle">· 폴더</span>
      </div>

      <div className="flex min-h-0 flex-1 px-2 pb-2">
        {studioFullscreen ? (
          <div className={`${CARD} flex-1 dictly-anim-in`}>
            <StudioPanel fullscreen />
          </div>
        ) : (
          <>
            <PanelGroup autoSaveId="folder.cols" direction="horizontal" className="min-w-0 flex-1">
              <Panel key="src" id="src" order={1} defaultSize={26} minSize={16} className="min-h-0">
                <div className={CARD}>
                  <SourcesPane />
                </div>
              </Panel>
              <ResizeHandle key="h-src" dir="h" />
              <Panel key="preview" id="preview" order={2} defaultSize={44} minSize={24} className="min-h-0">
                <div className={CARD}>
                  <PreviewPane />
                </div>
              </Panel>
              {studioOpen && <ResizeHandle key="h-studio" dir="h" />}
              {studioOpen && (
                <Panel key="studio" id="studio" order={3} defaultSize={30} minSize={18} className="min-h-0">
                  <div className={`${CARD} dictly-anim-in`}>
                    <StudioPanel />
                  </div>
                </Panel>
              )}
            </PanelGroup>
            {!studioOpen && <StudioRail />}
          </>
        )}
      </div>
    </div>
  )
}
