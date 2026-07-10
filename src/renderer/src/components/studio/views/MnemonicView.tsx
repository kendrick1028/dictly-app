import { CitedMarkdown } from '../cite/CitedMarkdown'
import type { MnemonicContent, StudioItem } from '../../../../../shared/types'

/** mnemonic cards: concept + technique badge + punchy mnemonic + cited explanation */
export function MnemonicView({ item }: { item: StudioItem }): JSX.Element {
  const items = (item.content as MnemonicContent).items
  return (
    <div className="h-full space-y-3 overflow-y-auto px-4 py-3">
      {items.map((m, i) => (
        <div key={i} className="rounded-xl border border-black/5 bg-white p-3.5 shadow-sm">
          <div className="mb-1.5 flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <CitedMarkdown sources={item.sources} className="!text-[13.5px] font-semibold [&_p]:!my-0">
                {m.concept}
              </CitedMarkdown>
            </div>
            <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10.5px] font-medium text-accent">{m.technique}</span>
          </div>
          <div className="rounded-lg bg-amber-50 px-3 py-2">
            <CitedMarkdown sources={item.sources} className="!text-[14.5px] font-medium [&_p]:!my-0">
              {m.mnemonic}
            </CitedMarkdown>
          </div>
          {m.explanation && (
            <div className="mt-2 text-subtle">
              <CitedMarkdown sources={item.sources} className="!text-[12.5px] [&_p]:!my-0.5">
                {m.explanation}
              </CitedMarkdown>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
