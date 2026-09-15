// Read-only view of a saved 실시간 튜터 session (the ELI5 cards streamed during a recording).
import { Headphones } from 'lucide-react'
import { useStore } from '../../../store/useStore'
import { MarkdownMath } from '../../MarkdownMath'
import { fmtRange } from '../../../lib/time'
import type { LiveTutorContent, StudioItem } from '../../../../../shared/types'

const MD = '!text-[13.5px] leading-relaxed [&_p]:!my-1 [&_ul]:!my-1 [&_li]:!my-0.5'

export function LiveTutorView({ item }: { item: StudioItem }): JSX.Element {
  const content = item.content as LiveTutorContent
  const cards = content.cards ?? []
  const jumpToTime = useStore((s) => s.jumpToTime)
  return (
    <div className="h-full overflow-y-auto px-3.5 py-3">
      <div className="mb-3 flex items-center gap-2 text-[11.5px] text-subtle">
        <Headphones size={13} className="text-orange-600" />
        녹음 중 실시간으로 풀어 설명한 {cards.length}개 카드{content.pdfName ? ` · 교안 ${content.pdfName}` : ''}
      </div>
      {cards.length === 0 && <div className="mt-8 text-center text-[12px] text-subtle">저장된 설명이 없습니다</div>}
      <div className="space-y-2">
        {cards.map((c) => (
          <div key={c.id} data-export-block className="rounded-xl border border-black/5 bg-black/[0.02] px-3 py-2.5">
            <div className="mb-1 flex items-center gap-1.5">
              <button
                onClick={() => jumpToTime(c.tStart, undefined, item.memoId || undefined)}
                className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums text-accent hover:bg-accent/20"
                title="전사문에서 이 구간 듣기"
              >
                {fmtRange(c.tStart, c.tEnd)}
              </button>
              {c.pdfPage != null && <span className="rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[10.5px] text-subtle">p.{c.pdfPage}</span>}
            </div>
            <MarkdownMath className={MD}>{c.md}</MarkdownMath>
          </div>
        ))}
      </div>
    </div>
  )
}
