import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { RELEASE_NOTES_URL } from '@/content'
import { useLatestRelease } from '@/lib/release'
import { cn, goToSetup } from '@/lib/utils'

const links = [
  { href: '#features', label: '기능' },
  { href: '#studio', label: '스튜디오' },
  { href: '#setup', label: '사용법' },
  { href: '#faq', label: 'FAQ' },
  { href: RELEASE_NOTES_URL, label: '릴리스 노트' },
]

export function Nav() {
  const { primaryUrl } = useLatestRelease()
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const on = () => setStuck(window.scrollY > 8)
    addEventListener('scroll', on, { passive: true })
    on()
    return () => removeEventListener('scroll', on)
  }, [])
  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 border-b bg-white/80 backdrop-blur-xl transition-colors',
        stuck ? 'border-line' : 'border-transparent',
      )}
    >
      <div className="mx-auto flex h-14 max-w-content items-center justify-between px-5 sm:px-8">
        <a href="#top" className="flex items-center gap-2 font-display text-[17px] font-bold tracking-tight">
          <img src="/media/logo.png" alt="Dictly" className="h-6 w-6 rounded-md" />
          Dictly
        </a>
        <nav className="hidden items-center gap-8 text-sm text-sub md:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target={l.href.startsWith('http') ? '_blank' : undefined}
              rel={l.href.startsWith('http') ? 'noopener' : undefined}
              className="transition-colors hover:text-ink"
            >
              {l.label}
            </a>
          ))}
        </nav>
        <a
          href={primaryUrl}
          onClick={goToSetup}
          className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5"
        >
          <Download className="h-4 w-4" />
          다운로드
        </a>
      </div>
    </header>
  )
}
