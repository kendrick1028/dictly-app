'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

const links = [
  { href: '#features', label: '기능' },
  { href: '#orbital', label: '한눈에' },
  { href: '#studio', label: '스튜디오' },
  { href: '#why', label: '차별점' },
]

export function Nav() {
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 32)
    addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-all duration-500',
        stuck ? 'border-b border-white/10 bg-[var(--bg)]/70 backdrop-blur-xl' : 'border-b border-transparent',
      )}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
        <a href="#top" className="flex items-center gap-2.5 font-bold">
          <img src="/media/logo.png" alt="Dictly" className="h-6 w-6 rounded-md" />
          <span className="text-[17px] tracking-tight">Dictly</span>
        </a>
        <nav className="hidden items-center gap-8 text-sm text-white/60 md:flex">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="transition-colors hover:text-white">
              {l.label}
            </a>
          ))}
        </nav>
        <a
          href="#download"
          className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition-transform hover:-translate-y-0.5"
        >
          다운로드
        </a>
      </div>
    </header>
  )
}
