import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'

/** In-app text-input dialog (replaces window.prompt, which Electron does not support).
 *  Enter = submit (when non-empty), Esc/바깥클릭 = cancel. */
export function PromptDialog(): JSX.Element | null {
  const promptDialog = useStore((s) => s.promptDialog)
  const closePrompt = useStore((s) => s.closePrompt)
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')

  useEffect(() => {
    if (promptDialog) {
      setValue(promptDialog.initial ?? '')
      // focus + select after mount
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [promptDialog])

  if (!promptDialog) return null

  const submit = (): void => {
    const v = value.trim()
    if (!v) return
    promptDialog.onSubmit(v)
    closePrompt()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onMouseDown={() => closePrompt()}>
      <div
        className="w-[360px] max-w-[90vw] rounded-2xl border border-black/10 bg-white p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return // IME guard
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            closePrompt()
          }
        }}
      >
        <p className="mb-3 text-[14px] font-medium text-ink">{promptDialog.title}</p>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={promptDialog.placeholder}
          className="mb-4 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-[14px] text-ink outline-none focus:border-accent"
        />
        <div className="flex justify-end gap-2">
          <button onClick={() => closePrompt()} className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-[13px] hover:bg-black/5">
            취소
          </button>
          <button
            onClick={submit}
            disabled={!value.trim()}
            className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:bg-accent/90 disabled:opacity-40"
          >
            {promptDialog.confirmLabel ?? '확인'}
          </button>
        </div>
      </div>
    </div>
  )
}
