// Studio hub: NotebookLM-style 2-column feature grid + stacked list of saved studio memos.
// Generations run as background jobs (several at once) shown as progress rows in the list.
import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Loader2, MoreVertical, RotateCw, Square, Trash2, X } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { fmtRelative } from '../../lib/time'
import { stripCiteTokens } from '../../lib/citations'
import { MarkdownMath } from '../MarkdownMath'
import { cancelStudioJob, dismissStudioJob, retryStudioJob, startStudioJob, type StudioJob } from '../../lib/studioJobs'
import { studioKindLabel } from '../../lib/studioParse'
import { STUDIO_KINDS, kindMeta } from './studioMeta'
import { StudioOptionsModal } from './StudioOptionsModal'
import type { StudioItem, StudioKind } from '../../../../shared/types'

function JobRow({ job }: { job: StudioJob }): JSX.Element {
  const meta = kindMeta(job.kind)
  return (
    <div className="flex items-center gap-2.5 rounded-xl px-2 py-2">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${meta.tile}`}>
        {job.status === 'running' ? <Loader2 size={15} className={`animate-spin ${meta.tint}`} /> : <meta.Icon size={15} className={meta.tint} />}
      </span>
      {job.status === 'running' ? (
        <>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{studioKindLabel(job.kind)} 생성 중…</span>
          <button onClick={() => cancelStudioJob(job.id)} className="rounded-md p-1 text-subtle hover:bg-black/5 hover:text-red-500" title="생성 중단">
            <Square size={12} className="fill-current" />
          </button>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-red-500">{studioKindLabel(job.kind)} 생성 실패</span>
            <span className="block truncate text-[11px] text-subtle" title={job.error}>
              {job.error}
            </span>
          </span>
          <button onClick={() => retryStudioJob(job.id)} className="rounded-md p-1 text-subtle hover:bg-black/5" title="다시 시도">
            <RotateCw size={13} />
          </button>
          <button onClick={() => dismissStudioJob(job.id)} className="rounded-md p-1 text-subtle hover:bg-black/5" title="지우기">
            <X size={13} />
          </button>
        </>
      )}
    </div>
  )
}

function ItemRow({ item }: { item: StudioItem }): JSX.Element {
  const openStudioItem = useStore((s) => s.openStudioItem)
  const deleteStudioItemAction = useStore((s) => s.deleteStudioItemAction)
  const requestConfirm = useStore((s) => s.requestConfirm)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const meta = kindMeta(item.kind)
  // in-progress Feynman review → show a "진행 중" badge (clicking resumes the session)
  const fc = item.kind === 'feynman' ? (item.content as { rounds?: { status?: string }[]; currentRound?: number }) : null
  const active = fc?.rounds?.[fc.currentRound ?? (fc.rounds.length - 1)]?.status === 'active'

  useEffect(() => {
    if (!menuOpen) return
    const h = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [menuOpen])

  return (
    <div className="group/item relative flex items-center gap-2.5 rounded-xl px-2 py-2 transition hover:bg-black/[0.03]">
      <button onClick={() => openStudioItem(item)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${meta.tile}`}>
          <meta.Icon size={15} className={meta.tint} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <MarkdownMath className="!text-[13px] min-w-0 flex-1 font-medium text-ink [&_p]:!my-0 [&_p]:truncate">{stripCiteTokens(item.title)}</MarkdownMath>
            {active && <span className="shrink-0 rounded-full bg-teal-100 px-1.5 py-0.5 text-[10px] font-medium text-teal-700">진행 중</span>}
          </span>
          <span className="block text-[11px] text-subtle">
            소스 {item.sources.sourceCount}개 · {fmtRelative(item.createdAt)}
          </span>
        </span>
      </button>
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="rounded-md p-1 text-subtle opacity-0 transition hover:bg-black/5 group-hover/item:opacity-100"
        >
          <MoreVertical size={14} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full z-30 mt-1 w-32 rounded-lg border border-black/10 bg-white py-1 shadow-lg">
            <button
              onClick={() => {
                setMenuOpen(false)
                requestConfirm(`'${item.title}' 스튜디오 메모를 삭제할까요?`, () => void deleteStudioItemAction(item.id))
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-red-500 hover:bg-red-50"
            >
              <Trash2 size={12} /> 삭제
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function StudioHub(): JSX.Element {
  const memo = useStore((s) => s.memo)
  const aiReady = useStore((s) => s.aiReady)
  const studioItems = useStore((s) => s.studioItems)
  const jobs = useStore((s) => s.studioJobs)
  const studioScope = useStore((s) => s.studioScope)
  const selectedFolderId = useStore((s) => s.selectedFolderId)
  const folderSrcMemoIds = useStore((s) => s.folderSrcMemoIds)
  const folderSrcPdfIds = useStore((s) => s.folderSrcPdfIds)
  const folderSrcNoteIds = useStore((s) => s.folderSrcNoteIds)
  const [optionsFor, setOptionsFor] = useState<StudioKind | null>(null)

  // jobs belonging to the current scope target
  const scopeJobs = jobs.filter((j) =>
    studioScope === 'folder' ? j.target.kind === 'folder' && j.target.folderId === selectedFolderId : j.target.kind === 'memo' && j.target.memoId === memo?.id
  )

  const folderHasSel = folderSrcMemoIds.length > 0 || folderSrcPdfIds.length > 0 || folderSrcNoteIds.length > 0
  const hasSource =
    studioScope === 'folder' ? folderHasSel : !!memo && (memo.segments.length > 0 || memo.transcriptMd.trim().length > 0 || memo.pdfs.length > 0)
  const disabled = !hasSource || !aiReady
  const disabledTip = !aiReady
    ? 'AI 미연결 — 상단 "연결"에서 설정하세요'
    : studioScope === 'folder'
      ? '왼쪽 소스에서 전사문·PDF·노트를 체크하세요'
      : '전사문 또는 PDF가 필요합니다'

  return (
    <div className="dictly-anim-in flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 grid-cols-2 gap-2 px-3 pt-1">
        {STUDIO_KINDS.map((k) => (
          <button
            key={k.kind}
            disabled={disabled}
            title={disabled ? disabledTip : k.kind === 'feynman' ? '파인만 복습 생성 (백그라운드 — 목록에 추가됨)' : k.kind === 'exam_radar' ? '시험 레이더 생성 (중요도×난이도 맵)' : `${k.label} 만들기`}
            onClick={() => (k.kind === 'feynman' || k.kind === 'exam_radar' ? startStudioJob(k.kind, {}) : setOptionsFor(k.kind))}
            className={`group/card flex items-center gap-2 rounded-2xl p-3 text-left transition ${k.tile} ${
              disabled ? 'opacity-50' : 'hover:brightness-[0.98] active:scale-[0.99]'
            }`}
          >
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <k.Icon size={16} className={k.tint} />
              <span className={`truncate text-[12.5px] font-semibold ${k.tint}`}>{k.label}</span>
            </span>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/[0.06] opacity-60 transition group-hover/card:opacity-100">
              <ChevronRight size={14} className={k.tint} />
            </span>
          </button>
        ))}
      </div>

      {disabled && <div className="mx-3 mt-2 text-[11.5px] leading-snug text-subtle">{disabledTip}</div>}

      <div className="mx-3 mt-3 border-t border-black/5" />

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
        {scopeJobs.map((j) => (
          <JobRow key={j.id} job={j} />
        ))}
        {studioItems.length === 0 && scopeJobs.length === 0 ? (
          <div className="mt-8 px-4 text-center text-[12px] leading-relaxed text-subtle">
            아직 만든 스튜디오 메모가 없습니다.
            <br />위 기능으로 전사문·PDF 기반 학습 자료를 만들어 보세요.
          </div>
        ) : (
          studioItems.map((it) => <ItemRow key={it.id} item={it} />)
        )}
      </div>

      {optionsFor && (
        <StudioOptionsModal
          kind={optionsFor}
          onClose={() => setOptionsFor(null)}
          onCreate={(kind, opts) => {
            setOptionsFor(null)
            startStudioJob(kind, opts as Record<string, unknown>)
          }}
        />
      )}
    </div>
  )
}
