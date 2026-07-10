// "채팅" sidebar tab (below 메모). Just the tab toggle — the conversation list lives inside the
// tab's center view (ChatView), not in the sidebar.
import { MessageSquare } from 'lucide-react'
import { useStore } from '../../store/useStore'

export function ChatNav(): JSX.Element {
  const chatOpen = useStore((s) => s.chatOpen)
  const openChat = useStore((s) => s.openChat)
  return (
    <div className="mb-1">
      <button
        onClick={() => void openChat()}
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] font-medium no-drag ${
          chatOpen ? 'bg-black/[0.06] text-ink' : 'text-subtle hover:bg-black/[0.03]'
        }`}
      >
        <MessageSquare size={15} className={chatOpen ? 'text-accent' : ''} /> 채팅
      </button>
    </div>
  )
}
