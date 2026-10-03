import { useEffect, useState } from 'react'
import { Trash2, RefreshCw, Loader2, BookOpen, StickyNote, GraduationCap } from 'lucide-react'
import { Panel, PanelGroup } from 'react-resizable-panels'
import { useStore } from '../store/useStore'
import { TranscriptArea } from './TranscriptArea'
import { RecordBar } from './RecordBar'
import { PdfSection } from './PdfSection'
import { StudioPanel, StudioRail } from './StudioPanel'
import { LiveTutorPanel } from './live/LiveTutorPanel'
import { NoteEditor } from './notes/NoteEditor'
import { ResizeHandle } from './ResizeHandle'

const CARD = 'h-full min-h-0 overflow-hidden rounded-xl border border-black/5 bg-panel shadow-sm'

export function MemoView(): JSX.Element {
  // selectors (NOT whole-store): MemoView must not re-render on every partial/elapsed tick.
  const memo = useStore((s) => s.memo)
  const updateTitle = useStore((s) => s.updateTitle)
  const deleteMemo = useStore((s) => s.deleteMemo)
  const requestConfirm = useStore((s) => s.requestConfirm)
  const regenerateTitle = useStore((s) => s.regenerateTitle)
  const aiReady = useStore((s) => s.aiReady)
  const pdfSectionOpen = useStore((s) => s.pdfSectionOpen)
  const togglePdfSection = useStore((s) => s.togglePdfSection)
  const notesPanelOpen = useStore((s) => s.notesPanelOpen)
  const toggleNotesPanel = useStore((s) => s.toggleNotesPanel)
  const lectureNoteId = useStore((s) => s.lectureNoteId)
  const studioCollapsed = useStore((s) => s.studioCollapsed)
  const studioFullscreen = useStore((s) => s.studioFullscreen)
  const liveTutorOpen = useStore((s) => s.liveTutorOpen)
  const toggleLiveTutor = useStore((s) => s.toggleLiveTutor)
  const [title, setTitle] = useState('')
  const [titling, setTitling] = useState(false)

  useEffect(() => setTitle(memo?.title ?? ''), [memo?.id, memo?.title])

  if (!memo) {
    return (
      <div className="flex flex-1 flex-col bg-canvas">
        <div className="flex flex-1 items-center justify-center text-subtle">
          <div className="text-center">
            <p className="text-[15px]">메모를 선택하거나 새 녹음을 시작하세요</p>
            <p className="mt-1 text-[13px]">왼쪽 “새 노트” 버튼으로 시작하세요</p>
          </div>
        </div>
      </div>
    )
  }

  const doRegenTitle = async (): Promise<void> => {
    setTitling(true)
    try {
      await regenerateTitle()
    } finally {
      setTitling(false)
    }
  }

  const studioOpen = !studioCollapsed

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      {/* header: title (+regen right next to it) … PDF toggle · delete on the right */}
      <div className="flex h-12 shrink-0 items-center gap-1 px-4 pt-1">
        <input
          className="min-w-[48px] max-w-[55%] bg-transparent text-[15px] font-semibold outline-none"
          style={{ fieldSizing: 'content' } as React.CSSProperties}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== memo.title && updateTitle(title.trim())}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <button
          onClick={doRegenTitle}
          disabled={titling || !aiReady}
          className="no-drag shrink-0 rounded-lg p-1.5 text-subtle hover:bg-black/5 disabled:opacity-40"
          title="녹음 내용으로 제목 다시 생성"
        >
          {titling ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
        </button>
        <div className="flex-1" />
        <div className="no-drag flex items-center gap-1 text-subtle">
          <button
            onClick={togglePdfSection}
            className={`relative rounded-lg p-1.5 hover:bg-black/5 ${pdfSectionOpen ? 'text-accent' : ''}`}
            title={pdfSectionOpen ? 'PDF 보기 닫기' : 'PDF 보기 열기'}
          >
            <BookOpen size={16} />
            {memo.pdfs.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-0.5 text-[9px] font-semibold text-white">
                {memo.pdfs.length}
              </span>
            )}
          </button>
          <button
            onClick={() => void toggleNotesPanel()}
            className={`rounded-lg p-1.5 hover:bg-black/5 ${notesPanelOpen ? 'text-accent' : ''}`}
            title={notesPanelOpen ? '메모(필기) 닫기' : '메모(필기) 열기 — 강의 들으며 타이핑'}
          >
            <StickyNote size={16} />
          </button>
          <button
            onClick={() => toggleLiveTutor()}
            disabled={!aiReady}
            className={`rounded-lg p-1.5 hover:bg-black/5 disabled:opacity-40 ${liveTutorOpen ? 'text-accent' : ''}`}
            title={!aiReady ? '코파일럿: AI 연결 필요' : liveTutorOpen ? '코파일럿 닫기' : '코파일럿 열기: 녹음 중 교수님 설명을 인용하고 쉽게 다시 풀어 줍니다'}
          >
            <GraduationCap size={16} />
          </button>
          <button
            onClick={() => requestConfirm('이 메모를 삭제할까요?', () => void deleteMemo(memo.id))}
            className="rounded-lg p-1.5 hover:bg-black/5 hover:text-red-500"
            title="메모 삭제"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* body: fullscreen studio (single section) OR up to 3 resizable columns + collapsed rail.
          Conditional panels carry id+order (for react-resizable-panels) and a React key (so
          reconciliation never reuses one panel's instance for another). autoSaveId persists a
          separate layout per visible-panel combination. */}
      <div className="flex min-h-0 flex-1 px-2 pb-2">
        {studioFullscreen ? (
          <div className={`${CARD} flex-1 dictly-anim-in`}>
            <StudioPanel fullscreen />
          </div>
        ) : (
          <>
            <PanelGroup autoSaveId="memo.cols" direction="horizontal" className="min-w-0 flex-1">
              {pdfSectionOpen && (
                <Panel key="pdf" id="pdf" order={1} defaultSize={34} minSize={18} className="min-h-0">
                  <div className={`${CARD} dictly-anim-in`}>
                    <PdfSection />
                  </div>
                </Panel>
              )}
              {pdfSectionOpen && <ResizeHandle key="h-pdf" dir="h" />}
              <Panel key="transcript" id="transcript" order={2} defaultSize={40} minSize={24} className="min-h-0">
                <div className={CARD}>
                  <TranscriptArea />
                </div>
              </Panel>
              {notesPanelOpen && lectureNoteId != null && <ResizeHandle key="h-note" dir="h" />}
              {notesPanelOpen && lectureNoteId != null && (
                <Panel key="note" id="note" order={3} defaultSize={30} minSize={20} className="min-h-0">
                  <div className={`${CARD} dictly-anim-in`}>
                    <NoteEditor noteId={lectureNoteId} className="h-full" />
                  </div>
                </Panel>
              )}
              {liveTutorOpen && <ResizeHandle key="h-tutor" dir="h" />}
              {liveTutorOpen && (
                <Panel key="tutor" id="tutor" order={4} defaultSize={28} minSize={22} className="min-h-0">
                  <div className={`${CARD} dictly-anim-in`}>
                    <LiveTutorPanel />
                  </div>
                </Panel>
              )}
              {studioOpen && <ResizeHandle key="h-studio" dir="h" />}
              {studioOpen && (
                <Panel key="studio" id="studio" order={5} defaultSize={26} minSize={18} className="min-h-0">
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
      {/* recording pill floats at the bottom center of the window (not clipped by any column) */}
      <RecordBar />
    </div>
  )
}
