import type { ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { useLatestRelease } from '@/lib/release'
import { Reveal } from '@/components/Reveal'
import { Terminal } from '@/components/Terminal'

function Step({ no, title, children }: { no: string; title: string; children: ReactNode }) {
  return (
    <Reveal className="grid gap-5 border-t border-line py-12 sm:grid-cols-[auto_1fr] sm:gap-10">
      <div className="font-display text-5xl font-extrabold leading-none tracking-tight text-line sm:text-6xl">{no}</div>
      <div>
        <h3 className="font-display text-2xl font-bold tracking-[-0.02em] sm:text-[28px]">{title}</h3>
        <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-sub">{children}</div>
      </div>
    </Reveal>
  )
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-medium text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
    >
      {children}
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  )
}

export function Setup() {
  const { dmgUrl, exeUrl } = useLatestRelease()
  return (
    <section id="setup" className="border-t border-line bg-white">
      <div className="mx-auto max-w-3xl px-5 py-20 sm:px-8 sm:py-28">
        <Reveal>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-faint">사용법</p>
          <h2 className="mt-3 text-balance font-display text-3xl font-extrabold tracking-[-0.02em] sm:text-4xl">
            설치부터 AI 기능까지.
          </h2>
          <p className="mt-5 max-w-xl text-pretty text-[16px] leading-relaxed text-sub">
            녹음과 전사는 설치하면 바로, 무료로 동작합니다. 요약·교정·파인만 복습 같은
            <b className="font-semibold text-ink"> AI 기능</b>만 아래 CLI 도구 중 하나가 필요해요.
          </p>
          <div className="mt-6 rounded-xl border border-line bg-wash p-4 text-[14px] leading-relaxed text-sub">
            <b className="font-semibold text-ink">한눈에</b> — ① 설치(Mac은 DMG, Windows는 exe) → ② 첫 실행 시 보안 허용(미서명) → ③ AI 쓰려면 Claude Code
            또는 Codex CLI 설치 + 로그인.
          </div>
        </Reveal>

        <div className="mt-8">
          <Step no="01" title="설치">
            <p>
              <b className="font-semibold text-ink">Mac</b> — <Ext href={dmgUrl}>DMG 파일 다운로드</Ext> 후 열어서{' '}
              <b className="font-semibold text-ink">Dictly</b>를 <b className="font-semibold text-ink">응용 프로그램</b> 폴더로 드래그하세요.
              Apple Silicon(M1 이상) · macOS 14+ 필요.
            </p>
            {exeUrl && (
              <p>
                <b className="font-semibold text-ink">Windows</b> — <Ext href={exeUrl}>설치 파일(.exe) 다운로드</Ext> 후 실행하세요. 코드 서명이
                없어 SmartScreen 경고가 뜨면 <b className="font-semibold text-ink">추가 정보 → 실행</b>을 누르면 됩니다. Windows 10/11 64비트 ·
                전사는 CPU(faster-whisper)로 동작하고, Live 전사는 Mac 전용입니다.
              </p>
            )}
          </Step>

          <Step no="02" title="첫 실행 — 보안 허용 (미공증 앱)">
            <p>
              현재 Dictly는 Apple 공증(notarization)을 받지 않아, 그냥 더블클릭하면{' '}
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[13px] text-ink">“확인되지 않은 개발자”</span>{' '}
              경고로 열리지 않습니다. 둘 중 한 방법으로 한 번만 허용하면 됩니다.
            </p>
            <p className="font-semibold text-ink">방법 A — 마우스</p>
            <p>
              응용 프로그램에서 <b className="font-semibold text-ink">Dictly 아이콘 우클릭 → 열기 → 열기</b>. (또는 첫 실행 후
              <b className="font-semibold text-ink"> 시스템 설정 → 개인정보 보호 및 보안</b>에서 “확인 없이 열기”를 클릭)
            </p>
            <p className="font-semibold text-ink">방법 B — 터미널 (더 확실)</p>
            <p>아래 명령으로 격리(quarantine) 속성을 제거하면 경고 없이 바로 실행됩니다.</p>
            <Terminal
              lines={[
                { type: 'comment', text: '# Dictly의 격리 속성 제거 (한 번만)' },
                { type: 'cmd', text: 'xattr -dr com.apple.quarantine /Applications/Dictly.app' },
              ]}
            />
            <p className="text-[13px] text-faint">
              경로가 다르면 <span className="font-mono">/Applications/Dictly.app</span> 부분을 실제 설치 위치로 바꿔 주세요.
            </p>
          </Step>

          <Step no="03" title="AI 기능 준비 — CLI + 계정">
            <p>
              요약·교정·채팅·AI 학습 스튜디오 같은 기능은 <b className="font-semibold text-ink">Claude Code CLI</b> 또는{' '}
              <b className="font-semibold text-ink">Codex CLI</b> 중 <b className="font-semibold text-ink">하나</b>가 설치·로그인되어
              있어야 동작합니다. 각 도구는 해당 서비스 <b className="font-semibold text-ink">계정(구독)</b>이 필요합니다. Dictly는
              이미 설치된 CLI를 호출할 뿐이라 별도 결제가 없습니다. (먼저{' '}
              <Ext href="https://nodejs.org/">Node.js 18+</Ext>가 필요합니다.)
            </p>

            <div className="!mt-6 space-y-3">
              <p className="font-semibold text-ink">옵션 1 — Claude Code (Anthropic)</p>
              <p>
                <Ext href="https://www.anthropic.com/">Anthropic 계정</Ext>(Claude Pro/Max 구독 또는 API)이 필요합니다. 설치 가이드:{' '}
                <Ext href="https://docs.claude.com/en/docs/claude-code/overview">docs.claude.com — Claude Code</Ext>.
              </p>
              <Terminal
                title="Terminal — Claude Code"
                lines={[
                  { type: 'comment', text: '# 설치' },
                  { type: 'cmd', text: 'npm install -g @anthropic-ai/claude-code' },
                  { type: 'comment', text: '# 실행 후 안내에 따라 계정 로그인' },
                  { type: 'cmd', text: 'claude' },
                ]}
              />
            </div>

            <div className="!mt-6 space-y-3">
              <p className="font-semibold text-ink">옵션 2 — Codex CLI (OpenAI)</p>
              <p>
                <Ext href="https://chatgpt.com/">OpenAI(ChatGPT) 계정</Ext> 또는 API 키가 필요합니다. 설치 가이드:{' '}
                <Ext href="https://github.com/openai/codex">github.com/openai/codex</Ext>.
              </p>
              <Terminal
                title="Terminal — Codex CLI"
                lines={[
                  { type: 'comment', text: '# 설치' },
                  { type: 'cmd', text: 'npm install -g @openai/codex' },
                  { type: 'comment', text: '# 실행 후 안내에 따라 계정 로그인' },
                  { type: 'cmd', text: 'codex' },
                ]}
              />
            </div>

            <p className="!mt-6">
              설치·로그인 후 Dictly를 다시 실행하면 설정에서 AI 제공자를 선택할 수 있고, 요약·교정·스튜디오 기능이 활성화됩니다.
            </p>
          </Step>
        </div>
      </div>
    </section>
  )
}
