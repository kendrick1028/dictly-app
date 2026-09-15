import { RELEASE_NOTES_URL } from '@/content'
import { useLatestRelease } from '@/lib/release'

export function Footer() {
  const { version, primaryUrl } = useLatestRelease()
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-content flex-col items-center gap-4 px-5 py-12 text-center sm:flex-row sm:justify-between sm:px-8 sm:text-left">
        <div className="flex items-center gap-2 font-display text-[15px] font-bold tracking-tight">
          <img src="/media/logo.png" alt="Dictly" className="h-5 w-5 rounded" />
          Dictly
        </div>
        <p className="text-[13px] text-faint">© 2026 Dictly · 로컬 Whisper 기반 학습 노트 앱 · macOS · Windows · {version}</p>
        <div className="flex items-center gap-4">
          <a href={RELEASE_NOTES_URL} target="_blank" rel="noopener" className="text-[13px] font-semibold text-sub hover:text-ink hover:underline">
            릴리스 노트
          </a>
          <a href={primaryUrl} className="text-[13px] font-semibold text-ink hover:underline">
            다운로드
          </a>
        </div>
      </div>
    </footer>
  )
}
