import { Download as DownloadIcon, FileText } from 'lucide-react'
import { RELEASE_NOTES_URL } from '@/content'
import { Reveal } from '@/components/Reveal'
import { goToSetup } from '@/lib/utils'
import { useLatestRelease } from '@/lib/release'

export function Download() {
  const { version, dmgUrl, exeUrl } = useLatestRelease()
  return (
    <section id="download" className="mx-auto max-w-content px-5 py-24 sm:px-8 sm:py-32">
      <Reveal className="mx-auto max-w-2xl text-center">
        <img src="/media/logo.png" alt="Dictly" className="mx-auto h-14 w-14 rounded-2xl" />
        <h2 className="mt-7 text-balance font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">
          지금 바로 시작하세요.
        </h2>
        <p className="mx-auto mt-5 max-w-md text-pretty text-[16px] leading-relaxed text-sub">
          강의 하나를 녹음하는 순간, 노트 · 요약 · 복습이 한 번에 따라옵니다.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <a
            href={dmgUrl}
            onClick={goToSetup}
            className="inline-flex items-center gap-2.5 rounded-full bg-ink px-7 py-3.5 text-base font-semibold text-white transition-transform hover:-translate-y-0.5"
          >
            <DownloadIcon className="h-5 w-5" />
            macOS용 다운로드 (.dmg)
          </a>
          {exeUrl && (
            <a
              href={exeUrl}
              onClick={goToSetup}
              className="inline-flex items-center gap-2.5 rounded-full border border-line bg-white px-7 py-3.5 text-base font-semibold text-ink transition-colors hover:bg-wash"
            >
              <DownloadIcon className="h-5 w-5" />
              Windows용 다운로드 (.exe)
            </a>
          )}
        </div>
        <p className="mt-5 text-[13px] text-faint">
          macOS 14+ (Apple Silicon){exeUrl ? ' · Windows 10/11 (64비트)' : ''} · 약 500MB · {version} · 무료
        </p>
        <div className="mt-4 flex justify-center">
          <a
            href={RELEASE_NOTES_URL}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-sub transition-colors hover:text-ink"
          >
            <FileText className="h-3.5 w-3.5" />
            {version} 릴리스 노트 보기
          </a>
        </div>
        <p className="mx-auto mt-3 max-w-md text-pretty text-[13px] leading-relaxed text-sub">
          <b className="font-semibold text-ink">Mac</b> — DMG를 열어 Dictly를 응용 프로그램 폴더로 드래그하고, 첫 실행 시 아이콘을{' '}
          <b className="font-semibold text-ink">우클릭 → 열기</b> 후 마이크·화면 녹화 권한을 허용하세요.
          {exeUrl && (
            <>
              {' '}
              <b className="font-semibold text-ink">Windows</b> — 설치 파일을 실행하고 SmartScreen 경고가 뜨면{' '}
              <b className="font-semibold text-ink">추가 정보 → 실행</b>을 누르세요.
            </>
          )}
        </p>
      </Reveal>
    </section>
  )
}
