import { useEffect, useRef, useState } from 'react'
import { X, Undo2 } from 'lucide-react'
import { toastStore, type ToastItem, type ToastType } from '../lib/toastStore'

// Top-right toasts: a flat vertical list (no 3D stack), at most 2 shown. The newest slides in at the
// bottom; when a 3rd arrives the oldest (top) collapses + slides up and out; on auto-dismiss the
// remaining toasts slide up to fill. Auto-dismiss with pause-on-hover (handled by the store).

const CARD: Record<ToastType, string> = {
  message: 'bg-white text-ink ring-1 ring-black/10',
  success: 'bg-emerald-600 text-white',
  warning: 'bg-amber-500 text-white',
  error: 'bg-red-500 text-white'
}
const BTN_HOVER: Record<ToastType, string> = {
  message: 'text-subtle hover:bg-black/5 hover:text-ink',
  success: 'text-white/80 hover:bg-white/15 hover:text-white',
  warning: 'text-white/80 hover:bg-white/15 hover:text-white',
  error: 'text-white/80 hover:bg-white/15 hover:text-white'
}

const VISIBLE = 2
const EXIT_MS = 280

type Entry = { toast: ToastItem; leaving: boolean }

export function Toast(): JSX.Element {
  const [store, setStore] = useState<ToastItem[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const entriesRef = useRef<Entry[]>([])
  entriesRef.current = entries
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    setStore([...toastStore.toasts])
    return toastStore.subscribe(() => setStore([...toastStore.toasts]))
  }, [])

  // reconcile the store's last VISIBLE toasts into the on-screen entries: keep visible ones, mark
  // departed ones (removed OR pushed out of the window) as leaving, and drop them after EXIT_MS so
  // their collapse/slide-up animation can play.
  useEffect(() => {
    const visible = store.slice(-VISIBLE)
    const visIds = new Set(visible.map((t) => t.id))
    const next: Entry[] = []
    for (const e of entriesRef.current) {
      const fresh = visible.find((t) => t.id === e.toast.id)
      if (fresh) {
        next.push({ toast: fresh, leaving: false })
      } else {
        if (!timers.current.has(e.toast.id)) {
          timers.current.set(
            e.toast.id,
            setTimeout(() => {
              timers.current.delete(e.toast.id)
              setEntries((cur) => cur.filter((x) => x.toast.id !== e.toast.id))
            }, EXIT_MS)
          )
        }
        next.push({ toast: e.toast, leaving: true })
      }
    }
    for (const t of visible) if (!next.find((n) => n.toast.id === t.id)) next.push({ toast: t, leaving: false })
    setEntries(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  useEffect(() => {
    const t = timers.current
    return () => t.forEach((x) => clearTimeout(x))
  }, [])

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed right-4 top-4 z-[9999] flex w-[360px] max-w-[calc(100vw-1.5rem)] flex-col items-stretch"
    >
      {entries.map((e) => (
        <ToastRow key={e.toast.id} toast={e.toast} leaving={e.leaving} />
      ))}
    </div>
  )
}

function ToastRow({ toast, leaving }: { toast: ToastItem; leaving: boolean }): JSX.Element {
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const r = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(r)
  }, [])

  return (
    <div
      className="overflow-hidden transition-all duration-[280ms] ease-out"
      style={{
        // collapse height + gap on leave so the toasts below slide up smoothly
        maxHeight: leaving ? 0 : 500,
        marginBottom: leaving ? 0 : '0.5rem',
        opacity: leaving ? 0 : entered ? 1 : 0,
        transform: leaving ? 'translateY(-8px)' : entered ? 'translateY(0)' : 'translateY(8px)'
      }}
      onMouseEnter={() => toast.pause?.()}
      onMouseLeave={() => toast.resume?.()}
    >
      <div className={`pointer-events-auto rounded-xl p-3.5 text-[13px] leading-[1.45] shadow-lg ${CARD[toast.type]}`}>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 flex-1 break-words font-medium">{toast.text}</span>
            {!toast.action && (
              <div className="flex shrink-0 items-center gap-0.5">
                {toast.onUndoAction && (
                  <button
                    onClick={() => {
                      toast.onUndoAction?.()
                      toastStore.remove(toast.id)
                    }}
                    title="되돌리기"
                    className={`flex h-7 w-7 items-center justify-center rounded-md transition ${BTN_HOVER[toast.type]}`}
                  >
                    <Undo2 size={15} />
                  </button>
                )}
                <button
                  onClick={() => toastStore.remove(toast.id)}
                  title="닫기"
                  className={`flex h-7 w-7 items-center justify-center rounded-md transition ${BTN_HOVER[toast.type]}`}
                >
                  <X size={15} />
                </button>
              </div>
            )}
          </div>
          {toast.action && (
            <div className="flex items-center justify-end gap-1.5">
              <button onClick={() => toastStore.remove(toast.id)} className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition ${BTN_HOVER[toast.type]}`}>
                닫기
              </button>
              <button
                onClick={() => {
                  toast.onAction?.()
                  toastStore.remove(toast.id)
                }}
                className={`rounded-md px-2.5 py-1 text-[12px] font-semibold transition ${
                  toast.type === 'message' ? 'bg-accent text-white hover:bg-accent/90' : 'bg-white/20 text-white hover:bg-white/30'
                }`}
              >
                {toast.action}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
