import { HelpCircle } from 'lucide-react'

/** A small "?" icon that reveals an explanation on hover. Shared by the agent/settings/connect
 * panels so field descriptions live in a tooltip instead of cluttering the label. */
export function HelpTip({ text }: { text: string }): JSX.Element {
  return (
    <span className="group relative inline-flex align-middle">
      <HelpCircle size={13} className="cursor-help text-subtle/50 transition hover:text-subtle" />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-[70] mb-1.5 hidden w-64 whitespace-normal break-keep rounded-lg bg-white px-3 py-2 text-left text-[11px] font-normal leading-relaxed text-ink shadow-lg ring-1 ring-black/10 group-hover:block"
      >
        {text}
      </span>
    </span>
  )
}
