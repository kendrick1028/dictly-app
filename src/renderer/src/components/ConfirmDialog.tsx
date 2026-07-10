import { useEffect, useRef } from 'react'
import { useStore } from '../store/useStore'

/** In-app confirm dialog (replaces OS confirm). Enter = confirm, Esc/바깥클릭 = cancel. */
export function ConfirmDialog(): JSX.Element | null {
  const confirmDialog = useStore((s) => s.confirmDialog)
  const closeConfirm = useStore((s) => s.closeConfirm)
  const okRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (confirmDialog) okRef.current?.focus()
  }, [confirmDialog])

  if (!confirmDialog) return null

  const onConfirm = (): void => {
    confirmDialog.onConfirm()
    closeConfirm()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onMouseDown={() => closeConfirm()}>
      <div
        className="w-[360px] max-w-[90vw] rounded-2xl border border-black/10 bg-white p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault() // prevent the focused button's native Enter-click (avoid double)
            onConfirm()
          } else if (e.key === 'Escape') {
            closeConfirm()
          }
        }}
      >
        <p className="mb-4 whitespace-pre-line text-[14px] text-ink">{confirmDialog.message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => closeConfirm()}
            className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-[13px] hover:bg-black/5"
          >
            취소
          </button>
          <button
            ref={okRef}
            onClick={onConfirm}
            className="rounded-lg bg-red-500 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-red-600"
          >
            삭제
          </button>
        </div>
      </div>
    </div>
  )
}
