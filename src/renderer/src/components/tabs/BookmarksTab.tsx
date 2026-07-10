import { useMemo } from 'react'
import { Bookmark, CornerDownRight } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { MarkdownMath } from '../MarkdownMath'
import { applyMathRules } from '../../math/koMathRules'
import { isHeading } from '../../lib/structure'
import { fmtRange } from '../../lib/time'

const EMPTY: Record<string, string> = {}

/** "북마크" tab — only the chunks the user bookmarked, for quick review. Click a chunk to jump to it
 *  in the 전사문 tab (flash + scroll); the bookmark icon removes it. */
export function BookmarksTab(): JSX.Element {
  const memo = useStore((s) => s.memo)
  const agents = useStore((s) => s.agents)
  const activeAgentId = useStore((s) => s.activeAgentId)
  const toggleBookmark = useStore((s) => s.toggleBookmark)
  const setTab = useStore((s) => s.setTab)
  const setScrollTarget = useStore((s) => s.setScrollTarget)

  const agent = useMemo(() => agents.find((a) => a.id === (memo?.agentId ?? activeAgentId)), [agents, memo?.agentId, activeAgentId])
  const mathRules = agent?.mathRules ?? EMPTY
  const replacements = agent?.replacements ?? EMPTY

  const marked = useMemo(() => {
    if (!memo) return []
    const set = new Set(memo.bookmarks)
    return memo.segments.filter((s) => set.has(s.tStart) && s.text.trim()).sort((a, b) => a.tStart - b.tStart)
  }, [memo])

  const jump = (tStart: number): void => {
    if (!memo) return
    setScrollTarget({ memoId: memo.id, t: tStart })
    setTab('transcript')
  }

  if (!memo) return <div />

  return (
    <div className="h-full overflow-y-auto px-4 pb-6 pt-3">
      {marked.length === 0 ? (
        <div className="mt-16 text-center text-subtle">
          <Bookmark size={22} className="mx-auto mb-2 opacity-40" />
          <p className="text-[14px]">북마크한 청크가 없습니다</p>
          <p className="mt-1 text-[13px]">전사문에서 다시 볼 부분의 시간 줄에 마우스를 올려 북마크하세요</p>
        </div>
      ) : (
        <div className="space-y-3">
          {marked.map((s) =>
            // a bookmarked 목차(heading) follows the chunk but renders as plain text — not a chunk card
            isHeading(s.text) ? (
              // 목차(heading): plain text only — strip the leading markdown heading markers, no markdown/KaTeX parsing
              <div
                key={s.tStart}
                className="cursor-pointer pt-1 text-[15px] font-semibold text-ink"
                onClick={() => jump(s.tStart)}
                title="전사문에서 이 부분 보기"
              >
                {s.text.replace(/^\s*#{1,6}\s*/, '').trim()}
              </div>
            ) : (
              <div key={s.tStart} className="group rounded-lg border border-black/5 bg-black/[0.015] p-3">
                <div className="mb-0.5 flex items-center gap-2">
                  <button onClick={() => jump(s.tStart)} className="clock flex items-center gap-1 text-[11px] text-subtle hover:text-accent" title="전사문에서 이 부분 보기">
                    <CornerDownRight size={11} /> {fmtRange(s.tStart, s.tEnd)}
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={() => void toggleBookmark(s.tStart)}
                    title="북마크 해제"
                    className="shrink-0 rounded p-0.5 text-accent hover:bg-black/5"
                  >
                    <Bookmark size={13} className="fill-current" />
                  </button>
                </div>
                <div className="cursor-pointer" onClick={() => jump(s.tStart)}>
                  <MarkdownMath className="!text-[15px] [&_p]:!my-0">{applyMathRules(s.text, mathRules, replacements)}</MarkdownMath>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}
