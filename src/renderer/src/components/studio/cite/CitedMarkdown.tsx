// Markdown renderer with inline citation chips.
// [t:75]/[p:1:15] tokens are converted to <cite> elements (lib/citations), which the
// `cite` component below renders as hoverable/clickable chips.
import { createContext, useContext, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Clock3, FileText } from 'lucide-react'
import type { Components } from 'react-markdown'
import { MarkdownMath } from '../../MarkdownMath'
import { citeTokensToHtml } from '../../../lib/citations'
import { useStore } from '../../../store/useStore'
import { CitePopover } from './CitePopover'
import type { StudioSourceMap } from '../../../../../shared/types'

const CiteCtx = createContext<StudioSourceMap | null>(null)

function CiteChip(props: Record<string, unknown>): JSX.Element | null {
  const sources = useContext(CiteCtx)
  const jumpToTime = useStore((s) => s.jumpToTime)
  const jumpToPdfPage = useStore((s) => s.jumpToPdfPage)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ref = useRef<HTMLButtonElement>(null)

  const tRaw = props.t ?? props['data-t']
  const memoRaw = props.memo ?? props['data-memo']
  const pdfRaw = props.pdf ?? props['data-pdf']
  const pageRaw = props.page ?? props['data-page']
  const t = tRaw != null ? Number(tRaw) : null
  const memoIndex = memoRaw != null ? Number(memoRaw) : undefined
  const pdfIndex = pdfRaw != null ? Number(pdfRaw) : null
  const page = pageRaw != null ? Number(pageRaw) : null

  const isTime = t != null && Number.isFinite(t)
  const pdfRefEntry = !isTime && pdfIndex != null ? (sources?.pdfs.find((p) => p.index === pdfIndex) ?? null) : null
  if (!isTime && !pdfRefEntry) return null
  // Resolve the cited source-memo from THIS chip's sources (chat manifests + stored viewer items).
  // Fall back to the first source memo even when the token has no memo index (a bare [t:초]) so the
  // 채팅 tab — where no memo is "open" in the store — still resolves the right transcript.
  // memo scope leaves sources.memos undefined → undefined → CitePopover uses the open store.memo.
  const citedMemo = memoIndex != null ? (sources?.memos?.find((m) => m.index === memoIndex) ?? sources?.memos?.[0]) : sources?.memos?.[0]
  const citedMemoId = citedMemo?.memoId

  const enter = (e: React.MouseEvent): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => setHover({ x: r.left + r.width / 2, y: r.bottom }), 250)
  }
  const leave = (): void => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => setHover(null), 120)
  }

  // icon-only mini chip — details (source name, page, preview) live in the hover popover
  return (
    <>
      <button
        ref={ref}
        data-cite-chip="1"
        onClick={(e) => {
          e.stopPropagation()
          if (isTime) jumpToTime(t, memoIndex, citedMemoId)
          else if (pdfRefEntry && page != null) jumpToPdfPage(pdfRefEntry.pdfId, page)
        }}
        onMouseEnter={enter}
        onMouseLeave={leave}
        className="mx-0.5 inline-flex cursor-pointer items-center rounded bg-accent/10 p-[3px] align-baseline text-accent transition hover:bg-accent/20"
        title=""
      >
        {isTime ? <Clock3 size={10} className="shrink-0" /> : <FileText size={10} className="shrink-0" />}
      </button>
      {hover &&
        createPortal(
          <div onMouseEnter={() => hoverTimer.current && clearTimeout(hoverTimer.current)} onMouseLeave={leave}>
            <CitePopover
              anchor={hover}
              kind={isTime ? 't' : 'pdf'}
              t={isTime ? t : undefined}
              memoId={citedMemoId}
              srcTitle={citedMemo?.title}
              pdfId={pdfRefEntry?.pdfId}
              pdfName={pdfRefEntry?.name}
              page={page ?? undefined}
            />
          </div>,
          document.body
        )}
    </>
  )
}

/** markdown + KaTeX + inline citation chips (sources resolve PDF index → pdfId/name) */
export function CitedMarkdown({
  children,
  sources,
  className
}: {
  children: string
  sources: StudioSourceMap | null
  className?: string
}): JSX.Element {
  const html = useMemo(() => citeTokensToHtml(children || ''), [children])
  const components = useMemo<Components>(() => ({ cite: CiteChip as Components['cite'] }), [])
  return (
    <CiteCtx.Provider value={sources}>
      <MarkdownMath className={className} components={components}>
        {html}
      </MarkdownMath>
    </CiteCtx.Provider>
  )
}
