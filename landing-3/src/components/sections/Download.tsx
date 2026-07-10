import { Download as DownloadIcon, FileText } from 'lucide-react'
import { DMG_URL, RELEASE_NOTES_URL } from '@/content'
import { Reveal } from '@/components/Reveal'
import { goToSetup } from '@/lib/utils'

export function Download() {
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
        <div className="mt-9 flex justify-center">
          <a
            href={DMG_URL}
            onClick={goToSetup}
            className="inline-flex items-center gap-2.5 rounded-full bg-ink px-7 py-3.5 text-base font-semibold text-white transition-transform hover:-translate-y-0.5"
          >
            <DownloadIcon className="h-5 w-5" />
            macOS용 다운로드 (.dmg)
          </a>
        </div>
        <p className="mt-5 text-[13px] text-faint">Apple Silicon · macOS 14+ · 약 500MB · v0.4.0 · 무료</p>
        <div className="mt-4 flex justify-center">
          <a
            href={RELEASE_NOTES_URL}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-sub transition-colors hover:text-ink"
          >
            <FileText className="h-3.5 w-3.5" />
            v0.4.0 릴리스 노트 보기
          </a>
        </div>
        <p className="mx-auto mt-3 max-w-md text-pretty text-[13px] leading-relaxed text-sub">
          DMG를 열어 Dictly를 <b className="font-semibold text-ink">응용 프로그램</b> 폴더로 드래그하세요.
          첫 실행 시 아이콘을 <b className="font-semibold text-ink">우클릭 → 열기</b> 후 마이크·화면 녹화 권한을 허용하면 됩니다.
        </p>
      </Reveal>
    </section>
  )
}
