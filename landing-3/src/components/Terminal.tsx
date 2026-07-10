import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

export interface TermLine {
  type: 'cmd' | 'comment' | 'out'
  text: string
}

/** A macOS-Terminal-styled block. Dark window with traffic lights + monospace lines.
 *  The copy button copies all command lines. */
export function Terminal({ title = 'Terminal — zsh', lines }: { title?: string; lines: TermLine[] }) {
  const [copied, setCopied] = useState(false)
  const cmds = lines.filter((l) => l.type === 'cmd').map((l) => l.text).join('\n')

  const copy = () => {
    navigator.clipboard?.writeText(cmds).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-[#0b0b0e] shadow-[0_20px_50px_-24px_rgba(0,0,0,0.5)]">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-[#161619] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        </div>
        <span className="font-mono text-xs text-zinc-500">{title}</span>
        <button
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200"
          aria-label="명령어 복사"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-[#28c840]" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? '복사됨' : '복사'}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[13px] leading-relaxed">
        {lines.map((l, i) => {
          if (l.type === 'comment')
            return (
              <div key={i} className="text-zinc-500">
                {l.text}
              </div>
            )
          if (l.type === 'out')
            return (
              <div key={i} className="text-zinc-400">
                {l.text}
              </div>
            )
          return (
            <div key={i} className="text-zinc-100">
              <span className="select-none text-[#28c840]">➜ </span>
              <span className="select-none text-sky-400">~ </span>
              {l.text}
            </div>
          )
        })}
      </pre>
    </div>
  )
}
