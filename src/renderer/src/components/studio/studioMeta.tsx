import { Brain, FileText, GraduationCap, Headphones, Layers, Lightbulb, ListChecks, Network, Radar, Table2 } from 'lucide-react'
import type { StudioKind } from '../../../../shared/types'

export const STUDIO_KINDS: {
  kind: StudioKind
  label: string
  Icon: typeof FileText
  /** pastel tile bg (NotebookLM-style) */
  tile: string
  /** icon/text tint */
  tint: string
  /** not offered in the creation grid (created elsewhere, e.g. by the 실시간 튜터 at recording end) */
  hidden?: boolean
}[] = [
  { kind: 'summary', label: '요약', Icon: FileText, tile: 'bg-emerald-50', tint: 'text-emerald-700' },
  { kind: 'tutor', label: 'AI 튜터', Icon: GraduationCap, tile: 'bg-orange-50', tint: 'text-orange-700' },
  { kind: 'feynman', label: '파인만 복습', Icon: Lightbulb, tile: 'bg-teal-50', tint: 'text-teal-700' },
  { kind: 'exam_radar', label: '시험 레이더', Icon: Radar, tile: 'bg-cyan-50', tint: 'text-cyan-700' },
  { kind: 'quiz', label: '퀴즈', Icon: ListChecks, tile: 'bg-sky-50', tint: 'text-sky-700' },
  { kind: 'mindmap', label: '마인드맵', Icon: Network, tile: 'bg-violet-50', tint: 'text-violet-700' },
  { kind: 'flashcards', label: '플래시카드', Icon: Layers, tile: 'bg-amber-50', tint: 'text-amber-700' },
  { kind: 'table', label: '테이블', Icon: Table2, tile: 'bg-rose-50', tint: 'text-rose-700' },
  { kind: 'mnemonic', label: '암기노트', Icon: Brain, tile: 'bg-indigo-50', tint: 'text-indigo-700' },
  { kind: 'live_tutor', label: '코파일럿', Icon: Headphones, tile: 'bg-orange-50', tint: 'text-orange-700', hidden: true }
]

export function kindMeta(kind: StudioKind): (typeof STUDIO_KINDS)[number] {
  return STUDIO_KINDS.find((k) => k.kind === kind) ?? STUDIO_KINDS[0]
}
