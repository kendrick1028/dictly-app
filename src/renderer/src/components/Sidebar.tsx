import { useEffect, useState, type DragEvent } from 'react'
import {
  ChevronDown,
  ChevronRight,
  FileText,
  FolderOpen,
  FolderPlus,
  House,
  Loader2,
  MessageSquare,
  Paperclip,
  ScanText,
  SquarePen,
  Star,
  StickyNote,
  Trash2,
  Unlink
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { NotesNav } from './notes/NotesNav'
import { ChatNav } from './chat/ChatNav'
import { getPdfPages, ocrIndexPdf } from '../lib/pdfText'
import type { MemoSummary, PdfDoc } from '../../../shared/types'

/** drag-and-drop MIME used to reconnect a folder PDF by dropping it on a note row */
const PDF_DND = 'application/x-dictly-pdf-id'
/** drag-and-drop MIME for reordering a memo / moving it to another folder */
const MEMO_DND = 'application/x-dictly-memo'

// after a place(), refresh the affected lists
async function afterPlace(): Promise<void> {
  const st = useStore.getState()
  await st.refreshMemos()
  await st.refreshFolderPdfs()
  if (st.selectedMemoId != null) await st.reloadMemo()
}

/** PDF sublist. Click a row to open it: note context (memoId set) → the note's PDF viewer;
 *  folder context (flush, draggable) → the folder workspace preview. Note rows: index + disconnect
 *  (no delete). Folder rows: index + delete, and are draggable onto a note to (re)connect. */
function PdfList({ pdfs, memoId, flush = false }: { pdfs: PdfDoc[]; memoId?: number | null; flush?: boolean }): JSX.Element {
  const agents = useStore((s) => s.agents)
  const memoAgentId = useStore((s) => s.memo?.agentId)
  const activeAgentId = useStore((s) => s.activeAgentId)
  const requestConfirm = useStore((s) => s.requestConfirm)
  const showToast = useStore((s) => s.showToast)
  const openPdf = useStore((s) => s.openPdf)
  const openFolderView = useStore((s) => s.openFolderView)
  const setFolderPreview = useStore((s) => s.setFolderPreview)
  const [indexed, setIndexed] = useState<Record<number, boolean>>({})
  const [working, setWorking] = useState<Record<number, boolean>>({})
  const [overId, setOverId] = useState<number | null>(null) // folder-PDF drop-reorder target

  const agent = agents.find((a) => a.id === (memoAgentId ?? activeAgentId))

  const reload = async (): Promise<void> => {
    const st = useStore.getState()
    if (st.selectedMemoId != null) await st.reloadMemo()
    await st.refreshFolderPdfs()
  }

  // open the PDF: in a note → the note's PDF viewer; in the folder list → the folder workspace preview
  const openRow = async (p: PdfDoc): Promise<void> => {
    if (memoId != null) openPdf(p.id)
    else if (p.folderId != null) {
      await openFolderView(p.folderId)
      setFolderPreview({ kind: 'pdf', pdf: p, nonce: Date.now() })
    }
  }

  useEffect(() => {
    let cancelled = false
    void Promise.all(
      pdfs.map(async (p) => [p.id, !!(await window.api.pdfs.getExtractedPages(p.id).catch(() => null))?.length] as const)
    ).then((entries) => {
      if (cancelled) return
      setIndexed((cur) => {
        const next = { ...cur }
        for (const [id, ok] of entries) next[id] = ok
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [pdfs])

  const runIndex = async (p: PdfDoc): Promise<void> => {
    setWorking((w) => ({ ...w, [p.id]: true }))
    try {
      const st = await getPdfPages(p) // text layer auto-extracts+persists; image PDFs → needsOcr
      if (st.status === 'needsOcr') await ocrIndexPdf(p, agent?.systemPrompt ?? '')
      else if (st.status === 'error') throw new Error(st.message)
      setIndexed((m) => ({ ...m, [p.id]: true }))
      showToast(`'${p.name}' 인덱싱 완료`)
    } catch (e) {
      showToast(`인덱싱 실패: ${(e as Error).message}`)
    } finally {
      setWorking((w) => ({ ...w, [p.id]: false }))
    }
  }

  const runDelete = (p: PdfDoc): void => {
    const msg = p.inherited
      ? `'${p.name}'은(는) 폴더 공용 PDF입니다. 삭제하면 폴더의 모든 노트에서 사라집니다. 삭제할까요?`
      : `'${p.name}' PDF를 삭제할까요?`
    requestConfirm(msg, async () => {
      await window.api.pdfs.delete(p.id)
      await reload()
      showToast('PDF를 삭제했어요')
    })
  }

  const disconnect = async (pdfId: number): Promise<void> => {
    if (memoId == null) return
    await window.api.pdfs.setMemoExclusion(memoId, pdfId, true)
    await reload()
    showToast('이 노트에서 PDF 연결을 해제했어요')
  }

  return (
    <div className={flush ? 'flex flex-col gap-0.5' : 'mb-0.5 ml-5 mt-0.5 flex flex-col gap-0.5 border-l border-black/5 pl-2'}>
      {pdfs.map((p) => (
        <div
          key={p.id}
          onClick={() => void openRow(p)}
          draggable={memoId == null}
          onDragStart={
            memoId == null
              ? (e) => {
                  e.dataTransfer.setData(PDF_DND, String(p.id))
                  e.dataTransfer.effectAllowed = 'move'
                }
              : undefined
          }
          // folder context: drop another folder PDF here to reorder it before this one
          onDragOver={
            memoId == null && p.folderId != null
              ? (e) => {
                  if (e.dataTransfer.types.includes(PDF_DND)) {
                    e.preventDefault()
                    setOverId(p.id)
                  }
                }
              : undefined
          }
          onDragLeave={memoId == null ? () => setOverId((v) => (v === p.id ? null : v)) : undefined}
          onDrop={
            memoId == null && p.folderId != null
              ? (e) => {
                  const raw = e.dataTransfer.getData(PDF_DND)
                  setOverId(null)
                  if (!raw || Number(raw) === p.id) return
                  e.preventDefault()
                  e.stopPropagation()
                  void window.api.pdfs.place(Number(raw), p.folderId as number, p.id).then(afterPlace)
                }
              : undefined
          }
          className={`group/pdf flex cursor-pointer items-center gap-1.5 rounded text-subtle hover:bg-black/[0.04] hover:text-ink ${
            flush ? 'px-2 py-1 text-[13px]' : 'px-1 py-0.5 text-[11.5px]'
          } ${overId === p.id ? 'border-t-2 border-accent' : ''}`}
          title={p.inherited ? `폴더 공용 PDF: ${p.name}` : p.name}
        >
          {p.inherited ? (
            <FolderOpen size={flush ? 13 : 11} className="shrink-0 opacity-70" />
          ) : (
            <FileText size={flush ? 13 : 11} className="shrink-0 opacity-70" />
          )}
          <span className="min-w-0 flex-1 truncate">{p.name}</span>
          {!indexed[p.id] && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                void runIndex(p)
              }}
              disabled={working[p.id]}
              className={`shrink-0 rounded p-0.5 hover:bg-black/10 hover:text-accent disabled:opacity-60 ${
                working[p.id] ? 'block' : 'hidden group-hover/pdf:block'
              }`}
              title="텍스트 인덱싱 (이미지 PDF는 OCR)"
            >
              {working[p.id] ? <Loader2 size={11} className="animate-spin" /> : <ScanText size={11} />}
            </button>
          )}
          {memoId != null && p.inherited && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                void disconnect(p.id)
              }}
              className="hidden shrink-0 rounded p-0.5 hover:bg-black/10 hover:text-accent group-hover/pdf:block"
              title="이 노트에서 연결 해제 (PDF는 삭제하지 않음)"
            >
              <Unlink size={11} />
            </button>
          )}
          {memoId == null && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                runDelete(p)
              }}
              className="hidden shrink-0 rounded p-0.5 hover:bg-black/10 hover:text-red-500 group-hover/pdf:block"
              title="PDF 삭제"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function dateLabel(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

/** A memo row + (when selected) its connected-PDF sublist. Module-scope so its identity is stable
 *  across Sidebar re-renders — otherwise the selected memo's PdfList (OCR/index spinner state) remounts. */
function MemoRow({ m }: { m: MemoSummary }): JSX.Element {
  const selectedMemoId = useStore((s) => s.selectedMemoId)
  const selectMemo = useStore((s) => s.selectMemo)
  const recActive = useStore((s) => s.rec.isRecording || s.rec.finalizing)
  const recPaused = useStore((s) => s.rec.paused)
  const recordingMemoId = useStore((s) => s.recordingMemoId)
  const toggleFavorite = useStore((s) => s.toggleFavorite)
  const requestConfirm = useStore((s) => s.requestConfirm)
  const deleteMemo = useStore((s) => s.deleteMemo)
  const memoPdfs = useStore((s) => s.memo?.pdfs)
  const reloadMemo = useStore((s) => s.reloadMemo)
  const showToast = useStore((s) => s.showToast)
  const selected = selectedMemoId === m.id
  const [dropActive, setDropActive] = useState(false)

  const attachPdfToMemo = async (id: number): Promise<void> => {
    const res = await window.api.pdfs.addToMemo(id)
    if (!res.length) return
    if (useStore.getState().selectedMemoId === id) await reloadMemo()
    showToast(res.length === 1 ? `'${res[0].name}' 첨부됨` : `PDF ${res.length}개 첨부됨`)
  }

  // drop here: a dragged memo → reorder before this one (move folder if different);
  // a dragged folder-level PDF → (re)connect it to this note
  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    setDropActive(false)
    const memoRaw = e.dataTransfer.getData(MEMO_DND)
    if (memoRaw) {
      e.preventDefault()
      e.stopPropagation()
      try {
        const src = JSON.parse(memoRaw) as { id: number }
        if (src.id !== m.id) void window.api.memos.place(src.id, m.folderId, m.id).then(afterPlace)
      } catch {
        /* ignore */
      }
      return
    }
    const raw = e.dataTransfer.getData(PDF_DND)
    if (!raw) return
    e.preventDefault()
    e.stopPropagation() // a PDF dropped on a note reconnects it here — don't also bubble to the folder header (move-to-folder)
    const pdfId = Number(raw)
    void (async () => {
      await window.api.pdfs.setMemoExclusion(m.id, pdfId, false)
      if (useStore.getState().selectedMemoId === m.id) await reloadMemo()
      showToast('이 노트에 PDF를 연결했어요')
    })()
  }

  return (
    <div>
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(MEMO_DND, JSON.stringify({ id: m.id, folderId: m.folderId }))
          e.dataTransfer.effectAllowed = 'move'
        }}
        onClick={() => selectMemo(m.id)}
        onDragOver={(e) => {
          const t = e.dataTransfer.types
          if (t.includes(PDF_DND) || t.includes(MEMO_DND)) {
            e.preventDefault()
            setDropActive(true)
          }
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={onDrop}
        className={`group flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] no-drag ${
          dropActive ? 'ring-1 ring-accent bg-accent/[0.06]' : selected ? 'bg-black/[0.06] font-medium' : 'hover:bg-black/[0.04]'
        }`}
      >
        <FileText size={14} className="shrink-0 text-subtle" />
        <span className="flex-1 truncate">{m.title}</span>
        {recActive && recordingMemoId === m.id ? (
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${recPaused ? 'bg-gray-400' : 'animate-pulse bg-emerald-500'}`}
            title={recPaused ? '일시중지됨' : '녹음 중'}
          />
        ) : (
          <>
            <span className="text-[11px] text-subtle group-hover:hidden">{dateLabel(m.createdAt)}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                void toggleFavorite('memo', m.id, !m.favorite)
              }}
              className={`shrink-0 rounded p-0.5 hover:bg-black/10 ${m.favorite ? 'text-amber-400' : 'hidden text-subtle hover:text-amber-400 group-hover:block'}`}
              title={m.favorite ? '즐겨찾기 해제' : '즐겨찾기'}
            >
              <Star size={12} className={m.favorite ? 'fill-current' : ''} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                void attachPdfToMemo(m.id)
              }}
              className="hidden shrink-0 rounded p-0.5 text-subtle hover:bg-black/10 hover:text-accent group-hover:block"
              title="이 메모에 PDF 첨부"
            >
              <Paperclip size={13} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                requestConfirm(`'${m.title}' 메모를 삭제할까요?`, () => void deleteMemo(m.id))
              }}
              className="hidden shrink-0 rounded p-0.5 text-subtle hover:bg-black/10 hover:text-red-500 group-hover:block"
              title="메모 삭제"
            >
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>
      {/* connected PDFs under the selected memo (click → note PDF viewer; disconnect; no delete) */}
      {selected && memoPdfs && memoPdfs.length > 0 && <PdfList pdfs={memoPdfs} memoId={m.id} />}
    </div>
  )
}

export function Sidebar(): JSX.Element {
  // fine-grained selectors: the sidebar (heavy folder/memo list) must NOT re-render on every
  // partial/elapsed tick during recording — it only cares about isRecording/finalizing.
  const folders = useStore((s) => s.folders)
  const selectedFolderId = useStore((s) => s.selectedFolderId)
  const allMemos = useStore((s) => s.allMemos)
  const folderPdfs = useStore((s) => s.folderPdfs)
  const selectFolder = useStore((s) => s.selectFolder)
  const openFolderView = useStore((s) => s.openFolderView)
  const createFolder = useStore((s) => s.createFolder)
  const requestPrompt = useStore((s) => s.requestPrompt)
  const deleteFolder = useStore((s) => s.deleteFolder)
  const createMemo = useStore((s) => s.createMemo)
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed)
  const homeOpen = useStore((s) => s.homeOpen)
  const openHome = useStore((s) => s.openHome)
  const notesOpen = useStore((s) => s.notesOpen)
  const openNotes = useStore((s) => s.openNotes)
  const chatOpen = useStore((s) => s.chatOpen)
  const openChat = useStore((s) => s.openChat)
  const toggleFavorite = useStore((s) => s.toggleFavorite)
  const requestConfirm = useStore((s) => s.requestConfirm)
  const reloadMemo = useStore((s) => s.reloadMemo)
  const showToast = useStore((s) => s.showToast)
  const [collapsedFolders, setCollapsedFolders] = useState<Record<number, boolean>>({})
  const [dragFolderId, setDragFolderId] = useState<number | null>(null) // folder highlighted as a DnD drop target

  // drop a dragged memo / folder-PDF onto a folder header → move it into that folder (append)
  const onFolderDrop = (folderId: number, e: DragEvent<HTMLDivElement>): void => {
    setDragFolderId(null)
    const memoRaw = e.dataTransfer.getData(MEMO_DND)
    if (memoRaw) {
      e.preventDefault()
      e.stopPropagation()
      try {
        const src = JSON.parse(memoRaw) as { id: number }
        void window.api.memos.place(src.id, folderId, null).then(afterPlace)
      } catch {
        /* ignore */
      }
      return
    }
    const pdfRaw = e.dataTransfer.getData(PDF_DND)
    if (pdfRaw) {
      e.preventDefault()
      e.stopPropagation()
      void window.api.pdfs.place(Number(pdfRaw), folderId, null).then(afterPlace)
    }
  }

  const onNewFolder = (): void => {
    requestPrompt({
      title: '새 폴더 이름',
      placeholder: '폴더 이름',
      confirmLabel: '만들기',
      onSubmit: (name) => void createFolder(name)
    })
  }

  // Attach a PDF to a folder (all child notes inherit it).
  const attachPdfToFolder = async (id: number): Promise<void> => {
    const res = await window.api.pdfs.addToFolder(id)
    if (!res.length) return
    if (useStore.getState().memo?.folderId === id) await reloadMemo()
    showToast(res.length === 1 ? `'${res[0].name}' 폴더에 첨부됨` : `PDF ${res.length}개 폴더에 첨부됨`)
  }


  return (
    <div
      className={`relative flex h-full shrink-0 flex-col overflow-hidden bg-sidebar transition-[width] duration-300 ease-out ${
        sidebarCollapsed ? 'w-14' : 'w-[264px]'
      }`}
    >
      {/* drag titlebar row (traffic lights sit over it; the collapse/minimize buttons
          live in App's top-left strip so they stay fixed regardless of sidebar width). */}
      <div className="drag h-11 shrink-0" />

      {sidebarCollapsed ? (
        <div className="flex flex-1 flex-col items-center gap-1 pt-1">
          <button
            onClick={() => void openHome()}
            className={`no-drag rounded-lg p-2 hover:bg-black/5 ${homeOpen ? 'text-accent' : 'text-subtle'}`}
            title="대시보드"
          >
            <House size={18} />
          </button>
          <button
            onClick={() => void openNotes()}
            className={`no-drag rounded-lg p-2 hover:bg-black/5 ${notesOpen ? 'text-accent' : 'text-subtle'}`}
            title="메모"
          >
            <StickyNote size={18} />
          </button>
          <button
            onClick={() => void openChat()}
            className={`no-drag rounded-lg p-2 hover:bg-black/5 ${chatOpen ? 'text-accent' : 'text-subtle'}`}
            title="채팅"
          >
            <MessageSquare size={18} />
          </button>
          <button onClick={() => createMemo()} className="no-drag rounded-lg p-2 text-accent hover:bg-black/5" title="새 노트">
            <SquarePen size={18} />
          </button>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            <button
              onClick={() => void openHome()}
              className={`no-drag mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] font-medium ${
                homeOpen ? 'bg-black/[0.06] text-ink' : 'text-subtle hover:bg-black/[0.03]'
              }`}
            >
              <House size={15} className={homeOpen ? 'text-accent' : ''} /> 대시보드
            </button>
            <NotesNav />
            <ChatNav />
            <div className="mb-1 flex items-center justify-between px-2 py-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-subtle">폴더</span>
              <button onClick={onNewFolder} className="no-drag rounded p-1 text-subtle hover:bg-black/5" title="새 폴더">
                <FolderPlus size={14} />
              </button>
            </div>

            {folders.map((f) => {
              const open = selectedFolderId === f.id && !collapsedFolders[f.id]
              const folderNotes = allMemos.filter((m) => m.folderId === f.id)
              // folder-level (inherited) PDFs of the currently-selected folder, shown above its notes
              const folderLevelPdfs = selectedFolderId === f.id ? folderPdfs.filter((p) => p.inherited) : []
              return (
                <div key={f.id} className="mb-0.5">
                  <div
                    onDragOver={(e) => {
                      const t = e.dataTransfer.types
                      if (t.includes(MEMO_DND) || t.includes(PDF_DND)) {
                        e.preventDefault()
                        setDragFolderId(f.id)
                      }
                    }}
                    onDragLeave={() => setDragFolderId((v) => (v === f.id ? null : v))}
                    onDrop={(e) => onFolderDrop(f.id, e)}
                    className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] no-drag ${
                      dragFolderId === f.id ? 'ring-1 ring-accent bg-accent/[0.06]' : selectedFolderId === f.id ? 'bg-black/[0.05]' : 'hover:bg-black/[0.03]'
                    }`}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (selectedFolderId === f.id) setCollapsedFolders((c) => ({ ...c, [f.id]: !c[f.id] }))
                        else void selectFolder(f.id)
                      }}
                      className="shrink-0 rounded p-0.5 text-subtle hover:bg-black/10"
                      title={open ? '접기' : '펼치기'}
                    >
                      {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </button>
                    <button
                      onClick={() => void openFolderView(f.id)}
                      className="flex flex-1 items-center gap-1 text-left"
                      title="폴더 작업공간 열기 (소스·미리보기·스튜디오)"
                    >
                      <span className="flex-1 truncate font-medium">{f.name}</span>
                      <span className="text-[11px] text-subtle">{folderNotes.length}</span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        void toggleFavorite('folder', f.id, !f.favorite)
                      }}
                      className={`shrink-0 rounded p-0.5 hover:bg-black/10 ${f.favorite ? 'text-amber-400' : 'hidden text-subtle hover:text-amber-400 group-hover:block'}`}
                      title={f.favorite ? '즐겨찾기 해제' : '즐겨찾기'}
                    >
                      <Star size={12} className={f.favorite ? 'fill-current' : ''} />
                    </button>
                    <button
                      onClick={() => void attachPdfToFolder(f.id)}
                      className="hidden rounded p-0.5 text-subtle hover:bg-black/10 hover:text-accent group-hover:block"
                      title="폴더에 PDF 첨부 (하위 노트 공용)"
                    >
                      <Paperclip size={12} />
                    </button>
                    <button
                      onClick={() =>
                        requestConfirm(
                          folderNotes.length
                            ? `'${f.name}' 폴더를 삭제할까요? 강의 ${folderNotes.length}개와 그 안의 PDF·학습자료가 함께 영구 삭제돼요.`
                            : `'${f.name}' 폴더를 삭제할까요?`,
                          () => void deleteFolder(f.id)
                        )
                      }
                      className="hidden rounded p-0.5 text-subtle hover:bg-red-50 hover:text-red-500 group-hover:block"
                      title="삭제"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  {/* collapsible body — grid-rows 0fr↔1fr animates open/close (incl. when switching folders).
                      folder-level PDFs are flat (same indent + size as notes), notes below them. */}
                  <div className="grid transition-[grid-template-rows] duration-200 ease-out" style={{ gridTemplateRows: open ? '1fr' : '0fr' }}>
                    <div className="overflow-hidden">
                      <div className="ml-3 border-l border-black/5 pl-1">
                        {folderLevelPdfs.length > 0 && (
                          <>
                            <div className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-subtle/60">PDF</div>
                            <PdfList pdfs={folderLevelPdfs} flush />
                          </>
                        )}
                        <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-subtle/60">노트</div>
                        {folderNotes.length === 0 && <div className="px-2 py-1 text-[12px] text-subtle">노트 없음</div>}
                        {folderNotes.map((m) => (
                          <MemoRow key={m.id} m={m} />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="border-t border-black/5 p-2">
            <button
              onClick={() => createMemo()}
              className="no-drag flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-accent/90"
            >
              <SquarePen size={15} /> 새 노트
            </button>
          </div>
        </>
      )}
    </div>
  )
}
