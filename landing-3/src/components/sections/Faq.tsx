import { Plus } from 'lucide-react'
import { faqs } from '@/content'
import { Reveal } from '@/components/Reveal'

export function Faq() {
  return (
    <section id="faq" className="border-t border-line bg-wash">
      <div className="mx-auto max-w-3xl px-5 py-20 sm:px-8 sm:py-28">
        <Reveal>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-faint">자주 묻는 질문</p>
          <h2 className="mt-3 font-display text-3xl font-extrabold tracking-[-0.02em] sm:text-4xl">FAQ</h2>
        </Reveal>
        <div className="mt-10 divide-y divide-line border-y border-line">
          {faqs.map((f) => (
            <details key={f.q} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[16px] font-semibold marker:hidden">
                {f.q}
                <Plus className="h-4 w-4 flex-none text-faint transition-transform duration-300 group-open:rotate-45" />
              </summary>
              <p className="pb-5 text-[15px] leading-relaxed text-sub">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
