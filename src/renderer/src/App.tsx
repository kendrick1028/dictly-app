import { useEffect } from 'react'
import { Plug, Settings, Users, CalendarClock, PanelLeftClose, PanelLeftOpen, Minimize2 } from 'lucide-react'
import { useStore } from './store/useStore'
import { Sidebar } from './components/Sidebar'
import { MemoView } from './components/MemoView'
import { FolderView } from './components/FolderView'
import { FolderChat } from './components/FolderChat'
import { Home } from './components/Home'
import { NotesView } from './components/notes/NotesView'
import { ChatView } from './components/chat/ChatView'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AgentManager } from './components/AgentManager'
import { Timetable } from './components/Timetable'
import { SettingsModal } from './components/SettingsModal'
import { ConnectModal } from './components/ConnectModal'
import { ScheduleConfirmModal } from './components/studio/ScheduleConfirmModal'
import { ConfirmDialog } from './components/ConfirmDialog'
import { PromptDialog } from './components/PromptDialog'
import { Toast } from './components/Toast'
import { CompactWidget } from './components/CompactWidget'
import { Spotlight } from './components/Spotlight'
import { matchShortcut } from './lib/shortcut'

export default function App(): JSX.Element {
  const ready = useStore((s) => s.ready)
  const init = useStore((s) => s.init)
  const folderChatId = useStore((s) => s.folderChatId)
  const folderOpen = useStore((s) => s.folderOpen)
  const homeOpen = useStore((s) => s.homeOpen)
  const notesOpen = useStore((s) => s.notesOpen)
  const chatOpen = useStore((s) => s.chatOpen)
  const aiReady = useStore((s) => s.aiReady)
  const compactMode = useStore((s) => s.compactMode)
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed)
  const setSidebarCollapsed = useStore((s) => s.setSidebarCollapsed)
  const enterCompact = useStore((s) => s.enterCompact)
  const setConnectOpen = useStore((s) => s.setConnectOpen)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const setAgentManagerOpen = useStore((s) => s.setAgentManagerOpen)
  const setTimetableOpen = useStore((s) => s.setTimetableOpen)

  useEffect(() => {
    init()
  }, [init])

  // global shortcut → open/close Spotlight search (configurable in Settings, default ⌘⇧F)
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      const st = useStore.getState()
      if (st.settingsOpen) return // don't hijack the shortcut while it's being rebound in Settings
      if (matchShortcut(e, st.spotlightShortcut)) {
        e.preventDefault()
        st.toggleSpotlight()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // a timetable notification was clicked → a new note was created for it; open it
  useEffect(() => {
    return window.api.timetable.onOpened(async (memoId) => {
      const st = useStore.getState()
      await st.refreshFolders()
      await st.refreshMemos()
      await st.selectMemo(memoId)
    })
  }, [])

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center bg-sidebar text-subtle">
        <span className="text-[13px]">Dictly 시작 중…</span>
      </div>
    )
  }

  if (compactMode) return <CompactWidget />

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-sidebar">
      <Sidebar />
      {/* right side: a white rounded card floating on the gray window, below the titlebar */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* titlebar: drag strip with settings/agent/connect aligned at traffic-light height */}
        <div className="drag flex h-11 shrink-0 items-center justify-end gap-1 pr-3">
          <button
            onClick={() => setConnectOpen(true)}
            className="no-drag relative rounded-lg p-1.5 text-subtle hover:bg-black/5"
            title="AI 연결 (Claude / GPT)"
          >
            <Plug size={16} />
            <span className={`absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full ${aiReady ? 'bg-emerald-500' : 'bg-gray-300'}`} />
          </button>
          <button onClick={() => setAgentManagerOpen(true)} className="no-drag rounded-lg p-1.5 text-subtle hover:bg-black/5" title="에이전트 / 키워드">
            <Users size={16} />
          </button>
          <button onClick={() => setTimetableOpen(true)} className="no-drag rounded-lg p-1.5 text-subtle hover:bg-black/5" title="시간표 (알림 + 링크 + 메모)">
            <CalendarClock size={16} />
          </button>
          <button onClick={() => setSettingsOpen(true)} className="no-drag rounded-lg p-1.5 text-subtle hover:bg-black/5" title="설정">
            <Settings size={16} />
          </button>
        </div>
        <div className="mb-3 ml-1 mr-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-black/5 bg-panel shadow-sm">
          <ErrorBoundary resetKey={`${homeOpen}|${notesOpen}|${chatOpen}|${folderOpen}|${folderChatId}`}>
            {homeOpen ? (
              <Home />
            ) : chatOpen ? (
              <ChatView />
            ) : notesOpen ? (
              <NotesView />
            ) : folderChatId != null ? (
              <FolderChat />
            ) : folderOpen ? (
              <FolderView />
            ) : (
              <MemoView />
            )}
          </ErrorBoundary>
        </div>
      </div>

      {/* top-left controls pinned beside the traffic lights (fixed regardless of sidebar width).
          no-drag buttons live inside this drag strip so macOS keeps them clickable. */}
      <div className="drag absolute left-0 top-0 z-40 flex h-11 items-center gap-1 pl-[76px]">
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="no-drag rounded-lg p-1.5 text-subtle hover:bg-black/10"
          title={sidebarCollapsed ? '사이드바 펼치기' : '사이드바 접기'}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        <button
          onClick={() => void enterCompact()}
          className="no-drag rounded-lg p-1.5 text-subtle hover:bg-black/10"
          title="위젯으로 최소화 (녹음하며 다른 작업)"
        >
          <Minimize2 size={16} />
        </button>
      </div>

      <AgentManager />
      <Timetable />
      <SettingsModal />
      <ConnectModal />
      <ScheduleConfirmModal />
      <ConfirmDialog />
      <PromptDialog />
      <Spotlight />
      <Toast />
    </div>
  )
}
