// Chat-style "stick to bottom" for live transcript panes.
// While following, new content keeps the pane scrolled to the end. Any UPWARD scroll by the user
// (wheel / trackpad / scrollbar / PageUp / a search jump) pauses following so they can read earlier
// text without being yanked back down. Following resumes when they scroll back to the very bottom
// or press the round ↓ button (<JumpToLatest/>).
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { ArrowDown } from 'lucide-react'

export function useStickToBottom(ref: RefObject<HTMLElement>): {
  following: boolean
  /** live value for effects that must not re-render on every partial tick */
  followRef: RefObject<boolean>
  scrollToBottom: (smooth?: boolean) => void
} {
  const [following, setFollowing] = useState(true)
  const followRef = useRef(true)
  const lastTop = useRef(0)
  const attached = useRef<HTMLElement | null>(null)
  const set = useCallback((v: boolean) => {
    if (followRef.current === v) return
    followRef.current = v
    setFollowing(v)
  }, [])
  // no dep list on purpose: the container may mount after the first render (e.g. "!memo" early
  // return), so re-check each render and (re)attach only when the element actually changed
  useEffect(() => {
    const el = ref.current
    if (!el || attached.current === el) return
    attached.current = el
    lastTop.current = el.scrollTop
    const onScroll = (): void => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight
      if (el.scrollTop < lastTop.current - 1 && dist > 24) set(false) // user scrolled up → pause
      else if (dist <= 4) set(true) // back at the bottom → follow again
      lastTop.current = el.scrollTop
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (attached.current === el) attached.current = null
    }
  })
  const scrollToBottom = useCallback((smooth = true) => {
    set(true)
    const el = ref.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'instant' })
  }, [ref, set])
  return { following, followRef, scrollToBottom }
}

/** round ↓ button shown over the pane while following is paused during a live transcription */
export function JumpToLatest({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      title="최신 내용으로 이동 · 자동 스크롤 다시 켜기"
      className="dictly-pop-in absolute bottom-4 left-1/2 z-20 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-black/10 bg-white text-ink shadow-md transition hover:bg-black/5 active:scale-95"
    >
      <ArrowDown size={16} />
      <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-white" />
    </button>
  )
}
