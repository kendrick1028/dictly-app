import { useLayoutEffect, type RefObject } from 'react'

/**
 * Auto-grows a <textarea> to fit its content, up to `maxLines`, then scrolls.
 * Recomputes whenever `value` changes (including reset to '' after send).
 */
export function useAutoGrow(
  ref: RefObject<HTMLTextAreaElement>,
  value: string,
  maxLines = 5,
): void {
  useLayoutEffect(() => {
    const ta = ref.current
    if (!ta) return
    ta.style.height = 'auto'
    const cs = getComputedStyle(ta)
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 || 20
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    const borderY = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
    const maxH = lh * maxLines + padY + borderY
    const next = Math.min(ta.scrollHeight, maxH)
    ta.style.height = `${next}px`
    ta.style.overflowY = ta.scrollHeight > maxH + 1 ? 'auto' : 'hidden'
  }, [ref, value, maxLines])
}
