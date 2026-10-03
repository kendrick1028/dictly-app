// Right-hand "Studio" pane — NotebookLM-style. Modes: hub (feature grid + saved memos),
// chat (separate, closed by default — round bubble button in the header), create, viewer.
import { ArrowLeft, GraduationCap, LayoutGrid, MessageCircle, MessageSquare, PanelLeftClose, PanelRightClose } from 'lucide-react'
import { useStore } from '../store/useStore'
import { StudioHub } from './studio/StudioHub'
import { StudioChat } from './studio/StudioChat'
import { FeynmanSession } from './studio/FeynmanSession'
import { TutorSession } from './studio/TutorSession'
import { StudioMemoViewer, ViewerHeaderCrumb } from './studio/StudioMemoViewer'

export function StudioPanel({ fullscreen = false }: { fullscreen?: boolean }): JSX.Element {
  const studioView = useStore((s) => s.studioView)
  const setStudioView = useStore((s) => s.setStudioView)
  const toggleStudioCollapsed = useStore((s) => s.toggleStudioCollapsed)
  // in viewer mode the header shows the "스튜디오 › {kind}" breadcrumb + item actions inline
  const viewerItem = useStore((s) => (studioView.mode === 'viewer' ? (s.studioItems.find((x) => x.id === studioView.itemId) ?? null) : null))

  const chatOpen = studioView.mode === 'chat'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 px-3 pb-1.5 pt-2.5">
        {viewerItem ? (
          <ViewerHeaderCrumb item={viewerItem} />
        ) : studioView.mode === 'feynman' || studioView.mode === 'tutor' ? (
          // breadcrumb like the viewer: "스튜디오 › 파인만 복습 / AI 튜터" (스튜디오 → hub)
          <div className="flex min-w-0 items-center gap-1 text-[11px] font-semibold">
            <button onClick={() => setStudioView({ mode: 'hub' })} className="rounded px-0.5 uppercase tracking-wide text-subtle hover:text-ink" title="스튜디오로 돌아가기">
              스튜디오
            </button>
            <span className="text-subtle/50">›</span>
            <span className="truncate text-ink">{studioView.mode === 'feynman' ? '파인만 복습' : 'AI 튜터'}</span>
          </div>
        ) : (
          <>
            {studioView.mode !== 'hub' && (
              <button onClick={() => setStudioView({ mode: 'hub' })} className="rounded p-1 text-subtle hover:bg-black/5" title="스튜디오로 돌아가기">
                <ArrowLeft size={15} />
              </button>
            )}
            <span className="text-[11px] font-semibold uppercase tracking-wide text-subtle">스튜디오</span>
          </>
        )}
        <div className="flex-1" />
        {/* circular chat bubble — chat is its own mode, closed by default */}
        <button
          onClick={() => setStudioView(chatOpen ? { mode: 'hub' } : { mode: 'chat' })}
          className={`flex h-7 w-7 items-center justify-center rounded-full border shadow-sm transition ${
            chatOpen ? 'border-accent/40 bg-accent text-white' : 'border-black/10 bg-white text-subtle hover:bg-black/5'
          }`}
          title={chatOpen ? '채팅 닫기' : '노트 채팅 (전사문·PDF 기반)'}
        >
          <MessageCircle size={14} />
        </button>
        {!fullscreen && (
          <button onClick={toggleStudioCollapsed} className="rounded p-1 text-subtle hover:bg-black/5" title="스튜디오 접기">
            <PanelRightClose size={15} />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {studioView.mode === 'hub' && <StudioHub />}
        {studioView.mode === 'chat' && <StudioChat />}
        {studioView.mode === 'feynman' && <FeynmanSession key={studioView.itemId} itemId={studioView.itemId} />}
        {studioView.mode === 'tutor' && <TutorSession key={studioView.itemId} itemId={studioView.itemId} />}
        {studioView.mode === 'viewer' && <StudioMemoViewer key={studioView.itemId} itemId={studioView.itemId} />}
      </div>
    </div>
  )
}

/** Collapsed Studio: narrow icon rail (expand + hub/chat tiles). */
export function StudioRail(): JSX.Element {
  const studioView = useStore((s) => s.studioView)
  const setStudioView = useStore((s) => s.setStudioView)
  const toggleStudioCollapsed = useStore((s) => s.toggleStudioCollapsed)
  const liveTutorOpen = useStore((s) => s.liveTutorOpen)
  const toggleLiveTutor = useStore((s) => s.toggleLiveTutor)
  const aiReady = useStore((s) => s.aiReady)

  const open = (mode: 'hub' | 'chat'): void => {
    setStudioView({ mode })
    toggleStudioCollapsed() // (also closes the 실시간 튜터 panel — the slot is shared)
  }

  return (
    <div className="dictly-anim-in ml-2 flex w-12 shrink-0 flex-col items-center gap-1.5 rounded-xl border border-black/5 bg-panel py-2.5 shadow-sm">
      <button onClick={toggleStudioCollapsed} className="rounded-lg p-1.5 text-subtle hover:bg-black/5" title="스튜디오 펼치기">
        <PanelLeftClose size={17} />
      </button>
      <div className="my-0.5 h-px w-6 bg-black/10" />
      <button
        onClick={() => open('hub')}
        title="스튜디오"
        className={`flex h-9 w-9 items-center justify-center rounded-xl border transition ${
          studioView.mode !== 'chat' ? 'border-accent/40 bg-accent/5 text-accent' : 'border-transparent text-subtle hover:bg-black/5'
        }`}
      >
        <LayoutGrid size={17} />
      </button>
      <button
        onClick={() => open('chat')}
        title="노트 채팅"
        className={`flex h-9 w-9 items-center justify-center rounded-xl border transition ${
          studioView.mode === 'chat' ? 'border-accent/40 bg-accent/5 text-accent' : 'border-transparent text-subtle hover:bg-black/5'
        }`}
      >
        <MessageSquare size={17} />
      </button>
      <div className="my-0.5 h-px w-6 bg-black/10" />
      <button
        onClick={() => toggleLiveTutor()}
        disabled={!aiReady}
        title={aiReady ? (liveTutorOpen ? '코파일럿 닫기' : '코파일럿') : '코파일럿: AI 연결 필요'}
        className={`flex h-9 w-9 items-center justify-center rounded-xl border transition disabled:opacity-40 ${
          liveTutorOpen ? 'border-orange-300 bg-orange-50 text-orange-700' : 'border-transparent text-subtle hover:bg-black/5'
        }`}
      >
        <GraduationCap size={17} />
      </button>
    </div>
  )
}
