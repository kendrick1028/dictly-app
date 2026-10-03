// 설정 → 전사 서버: run transcription (and live correction) on another Mac over Tailscale + SSH.
// The remote Mac never shows anything on screen: the app starts the server over SSH only while it
// needs it, and it exits when this app disconnects.
import { useEffect, useState } from 'react'
import { Check, Loader2, Server, AlertTriangle } from 'lucide-react'
import { useStore } from '../store/useStore'
import type { SttRemoteConfig, SttRemoteTest, SttSidecarState } from '../../../shared/types'

function Switch({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }): JSX.Element {
  return (
    <button
      onClick={() => onChange(!on)}
      disabled={disabled}
      className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-40 ${on ? 'bg-accent' : 'bg-black/15'}`}
      role="switch"
      aria-checked={on}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  )
}

export function RemoteSttSettings(): JSX.Element {
  const recording = useStore((s) => s.rec.isRecording || s.rec.finalizing)
  const [cfg, setCfg] = useState<SttRemoteConfig | null>(null)
  const [host, setHost] = useState('')
  const [status, setStatus] = useState<SttSidecarState | null>(null)
  const [test, setTest] = useState<SttRemoteTest | null>(null)
  const [testing, setTesting] = useState(false)
  const [install, setInstall] = useState<{ busy: boolean; msg: string; error?: string } | null>(null)

  const refreshStatus = (): void => void window.api.stt.status().then(setStatus)
  useEffect(() => {
    void window.api.stt.getRemote().then((c) => {
      setCfg(c)
      setHost(c.host)
    })
    refreshStatus()
    const off = window.api.stt.onInstallProgress((msg) => setInstall((v) => ({ busy: true, msg, error: v?.error })))
    const t = window.setInterval(refreshStatus, 3000)
    return () => {
      off()
      window.clearInterval(t)
    }
  }, [])

  if (!cfg) return <div />

  const save = async (patch: Partial<SttRemoteConfig>): Promise<void> => {
    const next = await window.api.stt.setRemote(patch)
    setCfg(next)
    setHost(next.host)
    window.setTimeout(refreshStatus, 400)
  }
  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTest(null)
    try {
      setTest(await window.api.stt.testRemote(host.trim() || cfg.host))
    } finally {
      setTesting(false)
    }
  }
  const runInstall = async (): Promise<void> => {
    setInstall({ busy: true, msg: '준비 중…' })
    const r = await window.api.stt.installRemote(host.trim() || cfg.host)
    setInstall({ busy: false, msg: r.ok ? '설치 완료' : '설치 실패', error: r.error })
    if (r.ok) void runTest()
  }
  const reconnect = async (): Promise<void> => {
    setStatus(await window.api.stt.restart())
  }

  const where = status?.running ? (status.remote ? '맥미니에서 전사 중' : '이 Mac에서 전사 중') : '대기 중'
  const fallback = !!status?.running && cfg.on && !status.remote

  return (
    <div className="space-y-3 border-t border-black/5 pt-4">
      <div className="flex items-center gap-2">
        <Server size={14} className="text-subtle" />
        <span className="text-[13px] font-semibold">전사 서버</span>
        <span className="text-[11px] text-subtle">· {where}</span>
      </div>

      <label className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] text-ink">다른 Mac(맥미니)에서 전사하기</div>
          <div className="text-[11px] leading-snug text-subtle">
            음성을 Tailscale로 보내 그 Mac의 GPU로 전사하고 결과만 받아요. 이 Mac의 배터리와 발열이 줄어요. 그 Mac 화면에는 아무것도 뜨지 않아요.
          </div>
        </div>
        <Switch on={cfg.on} onChange={(v) => void save({ on: v })} disabled={recording} />
      </label>

      <label className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] text-ink">실시간 교정도 그 Mac의 Claude로</div>
          <div className="text-[11px] leading-snug text-subtle">그 Mac 계정에 로그인된 Claude CLI로 교정해요. 실패하면 이 Mac에서 교정해요.</div>
        </div>
        <Switch on={cfg.correct} onChange={(v) => void save({ correct: v })} disabled={!cfg.on} />
      </label>

      <div className="flex items-center gap-2">
        <span className="w-[72px] shrink-0 text-[11.5px] text-subtle">SSH 호스트</span>
        <input
          value={host}
          onChange={(e) => setHost(e.target.value)}
          onBlur={() => host.trim() && host.trim() !== cfg.host && void save({ host: host.trim() })}
          disabled={recording}
          placeholder="macmini-se"
          className="min-w-0 flex-1 rounded-lg border border-black/10 bg-white px-2 py-1.5 font-mono text-[12px] outline-none focus:border-accent"
        />
        <button onClick={() => void runTest()} disabled={testing} className="shrink-0 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-[12px] hover:bg-black/5 disabled:opacity-50">
          {testing ? <Loader2 size={13} className="animate-spin" /> : '연결 테스트'}
        </button>
      </div>
      <p className="text-[10.5px] leading-snug text-subtle/80">~/.ssh/config 의 Host 이름이에요. 그 Mac에 SSH 키로 접속할 수 있어야 해요.</p>

      {test && (
        <div className={`rounded-lg px-3 py-2 text-[11.5px] leading-relaxed ${test.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
          {test.ok ? (
            <>
              <div className="flex items-center gap-1 font-medium">
                <Check size={12} /> 연결됨 · 응답 {test.latencyMs}ms
              </div>
              <div>
                {test.chip} · 메모리 {test.memoryGb}GB · GPU {test.gpu ? '사용 가능' : '확인 필요'}
              </div>
              <div>
                전사 런타임 {test.runtime ? '설치됨' : '없음'} · 모델 {test.models ? '준비됨' : '없음'} · Claude CLI {test.claude ? test.claude : '없음'}
              </div>
            </>
          ) : (
            <div className="flex items-start gap-1">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {test.error}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void runInstall()}
          disabled={!!install?.busy || recording}
          className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-[12px] hover:bg-black/5 disabled:opacity-50"
          title="전사 런타임과 모델을 그 Mac에 설치하거나 고쳐요 (그 Mac이 직접 인터넷에서 받아요)"
        >
          {install?.busy ? <Loader2 size={13} className="inline animate-spin" /> : null} 그 Mac에 설치 / 복구
        </button>
        {fallback && (
          <button onClick={() => void reconnect()} disabled={recording} className="rounded-lg bg-accent px-2.5 py-1.5 text-[12px] font-medium text-white hover:bg-accent/90 disabled:opacity-50">
            맥미니에 다시 연결
          </button>
        )}
        {install && <span className={`text-[11px] ${install.error ? 'text-red-600' : 'text-subtle'}`}>{install.error ?? install.msg}</span>}
      </div>
      {fallback && status?.note && <p className="text-[11px] text-amber-700">{status.note}</p>}
      {recording && <p className="text-[11px] text-subtle">녹음 중에는 전사 서버를 바꿀 수 없어요.</p>}
    </div>
  )
}
