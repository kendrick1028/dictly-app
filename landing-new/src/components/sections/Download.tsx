'use client'

import { Download as DownloadIcon } from 'lucide-react'
import { Reveal } from '@/components/ui/reveal'
import { Sparkles } from '@/components/ui/sparkles'
import { ShaderLine } from '@/components/ui/shader-line'

// ⬇ DMG 외부 호스팅 URL을 여기에 넣으세요 (예: GitHub Release .dmg). 비우면 안내 토스트.
const DMG_URL = '#'

export function Download() {
  const onClick = (e: React.MouseEvent) => {
    if (DMG_URL !== '#') return
    e.preventDefault()
    const el = document.createElement('div')
    el.textContent = '다운로드 링크는 곧 연결됩니다 — DMG 호스팅 후 활성화'
    el.style.cssText =
      'position:fixed;left:50%;bottom:32px;transform:translateX(-50%);background:rgba(20,20,28,.95);color:#fff;padding:13px 22px;border-radius:999px;font-size:14px;font-weight:600;z-index:999;border:1px solid rgba(255,255,255,.14);box-shadow:0 12px 40px -10px rgba(0,0,0,.6)'
    document.body.appendChild(el)
    setTimeout(() => el.remove(), 2600)
  }

  return (
    <section id="download" className="relative isolate overflow-hidden px-5 py-28 sm:py-36">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="aurora absolute left-1/2 top-1/2 h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(124,108,255,0.3), transparent 60%)' }}
        />
        <div className="absolute inset-0 opacity-60">
          <Sparkles density={50} />
        </div>
      </div>

      <ShaderLine className="mx-auto mb-16 max-w-3xl" />

      <Reveal className="mx-auto max-w-2xl text-center">
        <img src="/media/logo.png" alt="Dictly" className="mx-auto h-16 w-16 rounded-2xl glow" />
        <h2 className="mt-7 text-balance font-display text-4xl font-extrabold tracking-tight sm:text-6xl">
          지금, <span className="text-gradient">강의의 중심</span>에서.
        </h2>
        <p className="mt-5 text-pretty text-white/65">
          강의 하나를 녹음하는 순간, 노트 · 요약 · 복습이 한 번에 따라옵니다.
        </p>

        <div className="mt-9 flex justify-center">
          <a
            href={DMG_URL}
            onClick={onClick}
            className="group inline-flex items-center gap-2.5 rounded-full bg-white px-7 py-3.5 text-base font-semibold text-black transition-transform hover:-translate-y-0.5"
          >
            <DownloadIcon className="h-5 w-5" />
            macOS용 다운로드 (.dmg)
          </a>
        </div>
        <p className="mt-5 text-sm text-white/40">Apple Silicon · macOS 14+ · 약 500MB · v0.1.0</p>
        <p className="mx-auto mt-3 max-w-md text-pretty text-[13px] leading-relaxed text-white/50">
          DMG를 열어 Dictly를 <b className="text-white/70">응용 프로그램</b>으로 드래그하세요. 첫 실행 시
          마이크·화면 녹화 권한을 허용하면 됩니다.
        </p>
      </Reveal>
    </section>
  )
}
