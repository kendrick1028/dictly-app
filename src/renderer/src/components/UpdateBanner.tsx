import { useEffect, useState } from 'react'
import { Download, Loader2, RefreshCw, X } from 'lucide-react'
import type { UpdateState } from '../../../shared/types'

/**
 * Auto-update indicator, rendered as a button row in the sidebar right above 새 노트 (compact icon
 * form on the collapsed rail). The main process checks GitHub Releases on launch and every 3 hours
 * and downloads in the background, so this only surfaces the two moments the user cares about: a
 * download in progress, and a version ready to restart into. Dismissing hides it until the next
 * state change (the update still installs on quit).
 */
/** dev-only: lets the DevTools hook inject fake update states (dev builds have no update feed) */
const devListeners = new Set<(s: UpdateState) => void>()
export const devUpdateBus = {
  set(s: UpdateState): void {
    devListeners.forEach((l) => l(s))
  }
}

function useUpdateStatus(): [UpdateState, string, (k: string) => void] {
  const [status, setStatus] = useState<UpdateState>({ state: 'idle' })
  const [dismissed, setDismissed] = useState('')
  useEffect(() => {
    void window.api.update.status().then(setStatus)
    const off = window.api.update.onStatus(setStatus)
    if (import.meta.env.DEV) devListeners.add(setStatus)
    return () => {
      off()
      devListeners.delete(setStatus)
    }
  }, [])
  const key = status.state + ('version' in status ? status.version : '')
  return [status, dismissed === key ? '' : key, setDismissed]
}

export function UpdateBanner({ compact = false }: { compact?: boolean }): JSX.Element | null {
  const [status, key, dismiss] = useUpdateStatus()
  if (!key) return null
  if (status.state !== 'downloading' && status.state !== 'ready') return null
  const ready = status.state === 'ready'

  if (compact) {
    // collapsed rail: one icon button (spinner while downloading, restart when ready)
    return (
      <button
        onClick={() => ready && void window.api.update.install()}
        className={`no-drag relative rounded-lg p-2 ${ready ? 'text-accent hover:bg-accent/10' : 'text-subtle'}`}
        title={ready ? `v${status.version} 업데이트 준비됨 — 클릭하면 재시작해서 새 버전으로 실행` : `업데이트 v${status.version} 내려받는 중 · ${Math.round(status.percent)}%`}
      >
        {ready ? <Download size={18} /> : <Loader2 size={18} className="animate-spin" />}
        {ready && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" />}
      </button>
    )
  }

  return (
    <div className="dictly-pop-in px-2 pt-2">
      {ready ? (
        <div className="flex items-center gap-1 rounded-xl border border-accent/10 bg-accent/[0.05] p-1">
          <button
            onClick={() => void window.api.update.install()}
            className="no-drag flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg py-1.5 text-[12.5px] font-semibold text-accent hover:bg-accent/10"
            title="지금 재시작해서 새 버전으로 실행"
          >
            <RefreshCw size={14} /> v{status.version} 업데이트 · 재시작
          </button>
          <button onClick={() => dismiss(key)} className="rounded-md p-1 text-subtle hover:bg-black/5 hover:text-ink" title="나중에 — 앱을 종료하면 자동 설치돼요">
            <X size={13} />
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-black/[0.04] bg-black/[0.03] px-3 py-2" title={`업데이트 v${status.version} 내려받는 중 · ${Math.round(status.percent)}%`}>
          <div className="flex items-center gap-2">
            <Loader2 size={14} className="shrink-0 animate-spin text-accent" />
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
              <b>v{status.version}</b> 업데이트 내려받는 중
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-subtle">{Math.round(status.percent)}%</span>
            <button onClick={() => dismiss(key)} className="rounded-md p-0.5 text-subtle hover:bg-black/5 hover:text-ink" title="숨기기">
              <X size={13} />
            </button>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-black/10">
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.max(2, Math.min(100, status.percent))}%` }} />
          </div>
        </div>
      )}
    </div>
  )
}
