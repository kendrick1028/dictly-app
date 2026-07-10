import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, RotateCw } from 'lucide-react'
import { CitedMarkdown } from '../cite/CitedMarkdown'
import type { FlashcardsContent, StudioItem } from '../../../../../shared/types'

/** one centered card, click (or space) to flip, ←/→ to navigate */
export function FlashcardsView({ item }: { item: StudioItem }): JSX.Element {
  const cards = (item.content as FlashcardsContent).cards
  const [idx, setIdx] = useState(0)
  const [flipped, setFlipped] = useState(false)

  useEffect(() => {
    setIdx(0)
    setFlipped(false)
  }, [item.id])

  const go = (d: number): void => {
    setIdx((i) => Math.min(Math.max(0, i + d), cards.length - 1))
    setFlipped(false)
  }

  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === ' ') {
        e.preventDefault()
        setFlipped((f) => !f)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.length])

  const card = cards[idx]
  if (!card) return <div className="p-4 text-[13px] text-subtle">카드가 없습니다</div>

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 px-5 py-4">
      <div className="w-full max-w-[420px] [perspective:1200px]">
        <button
          onClick={() => setFlipped((f) => !f)}
          className="relative block min-h-[220px] w-full transition-transform duration-500 [transform-style:preserve-3d]"
          style={{ transform: flipped ? 'rotateY(180deg)' : 'none' }}
          title="클릭하면 뒤집기 (스페이스)"
        >
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border border-black/10 bg-white p-5 shadow-md [backface-visibility:hidden]">
            <span className="mb-2 rounded-full bg-black/5 px-2 py-0.5 text-[10px] text-subtle">앞면</span>
            <CitedMarkdown sources={item.sources} className="!text-[16px] text-center [&_p]:!my-1">
              {card.front}
            </CitedMarkdown>
          </div>
          <div
            className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border border-accent/30 bg-accent/5 p-5 shadow-md [backface-visibility:hidden]"
            style={{ transform: 'rotateY(180deg)' }}
          >
            <span className="mb-2 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] text-accent">뒷면</span>
            <CitedMarkdown sources={item.sources} className="!text-[15px] text-center [&_p]:!my-1">
              {card.back}
            </CitedMarkdown>
          </div>
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={() => go(-1)} disabled={idx === 0} className="rounded-full border border-black/10 bg-white p-2 hover:bg-black/5 disabled:opacity-30">
          <ChevronLeft size={16} />
        </button>
        <span className="min-w-[64px] text-center text-[13px] tabular-nums text-subtle">
          {idx + 1} / {cards.length}
        </span>
        <button onClick={() => go(1)} disabled={idx >= cards.length - 1} className="rounded-full border border-black/10 bg-white p-2 hover:bg-black/5 disabled:opacity-30">
          <ChevronRight size={16} />
        </button>
        <button onClick={() => setFlipped((f) => !f)} className="ml-1 flex items-center gap-1 rounded-full border border-black/10 bg-white px-3 py-2 text-[12px] text-subtle hover:bg-black/5">
          <RotateCw size={13} /> 뒤집기
        </button>
      </div>
    </div>
  )
}
