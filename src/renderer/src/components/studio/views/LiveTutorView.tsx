// Read-only view of a saved 코파일럿 session (the explanation cards streamed during a recording).
import { Headphones, MessageCircleQuestion } from 'lucide-react'
import { KeywordChips } from '../../live/LiveTutorPanel'
import { splitKeywordLine } from '../../../live/livePrompts'
import { useStore } from '../../../store/useStore'
import { MarkdownMath } from '../../MarkdownMath'
import { fmtRange } from '../../../lib/time'
import type { LiveTutorContent, StudioItem } from '../../../../../shared/types'

const MD = 'dictly-copilot !text-[13.5px] leading-relaxed [&_p]:!my-1 [&_ul]:!my-1 [&_ul]:!pl-5 [&_li]:!my-0.5'

export function LiveTutorView({ item }: { item: StudioItem }): JSX.Element {
  const content = item.content as LiveTutorContent
  const cards = content.cards ?? []
  const jumpToTime = useStore((s) => s.jumpToTime)
  return (
    <div className="h-full overflow-y-auto px-3.5 py-3">
      <div className="mb-3 flex items-center gap-2 text-[11.5px] text-subtle">
        <Headphones size={13} className="text-orange-600" />
        코파일럿이 녹음 중 풀어 설명한 {cards.length}개 카드{content.pdfName ? ` · 교안 ${content.pdfName}` : ''}
      </div>
      {cards.length === 0 && <div className="mt-8 text-center text-[12px] text-subtle">저장된 설명이 없습니다</div>}
      <div className="space-y-2">
        {cards.map((c) => {
          const { keywords, body } = splitKeywordLine(c.md)
          return (
          <div key={c.id} data-export-block className="rounded-xl border border-black/5 bg-black/[0.02] px-3 py-2.5">
            <div className="mb-1 flex items-center gap-1.5">
              {c.question && (
                <span className="flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-700">
                  <MessageCircleQuestion size={11} /> 내 질문
                </span>
              )}
              <button
                onClick={() => jumpToTime(c.tStart, undefined, item.memoId || undefined)}
                className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums text-accent hover:bg-accent/20"
                title="전사문에서 이 구간 듣기"
              >
                {fmtRange(c.tStart, c.tEnd)}
              </button>
              {c.pdfPage != null && <span className="rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[10.5px] text-subtle">p.{c.pdfPage}</span>}
            </div>
            {c.question && <div className="mb-1.5 rounded-lg bg-white/70 px-2.5 py-1.5 text-[13px] font-medium text-ink">{c.question}</div>}
            <KeywordChips keywords={keywords} />
            <MarkdownMath className={MD}>{body}</MarkdownMath>
          </div>
          )
        })}
      </div>
    </div>
  )
}
