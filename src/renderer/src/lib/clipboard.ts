import { useStore } from '../store/useStore'

const DEFAULT_MSG = '클립보드에 복사했어요'

/** Copy plain text to the clipboard and show a confirmation toast. */
export async function copyText(text: string, msg: string = DEFAULT_MSG): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    useStore.getState().showToast(msg)
  } catch {
    useStore.getState().showToast('복사에 실패했어요')
  }
}

/** Copy rich HTML (+ plain-text fallback) via the main-process clipboard, then toast. */
export async function copyHtml(html: string, text: string, msg: string = DEFAULT_MSG): Promise<void> {
  try {
    await window.api.clipboard.writeHtml(html, text)
    useStore.getState().showToast(msg)
  } catch {
    useStore.getState().showToast('복사에 실패했어요')
  }
}
