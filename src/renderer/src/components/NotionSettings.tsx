// 설정 → Notion 연결: internal-integration token + destination page picker.
// Flow: (1) 통합 만들기 (notion.so/my-integrations) → (2) 토큰 저장 → (3) Notion에서 내보낼 페이지의
// ··· → 연결 → 통합 추가 → (4) 여기서 그 페이지를 검색해 선택. 스튜디오 ⋮ → "Notion으로 내보내기"가
// 그 페이지 아래에 새 하위 페이지를 만든다.
import { useEffect, useRef, useState } from 'react'
import { Check, Database, ExternalLink, FileText, Loader2, RotateCcw, Search, Unplug } from 'lucide-react'
import { useStore } from '../store/useStore'
import { HelpTip } from './HelpTip'
import type { NotionStatus, NotionTarget } from '../../../shared/types'

const INTEGRATIONS_URL = 'https://www.notion.so/my-integrations'

export function NotionSettings(): JSX.Element {
  const showToast = useStore((s) => s.showToast)
  const [st, setSt] = useState<NotionStatus | null>(null)
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<NotionTarget[] | null>(null)
  const [searching, setSearching] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void window.api.notion.status().then(setSt)
  }, [])

  // debounced search while the picker is open (empty query = recent pages shared with the integration)
  useEffect(() => {
    if (!picking || !st?.tokenSet) return
    let alive = true
    setSearching(true)
    const t = setTimeout(() => {
      window.api.notion
        .search(query)
        .then((r) => alive && setResults(r))
        .catch((e: Error) => alive && showToast(`Notion 검색 실패: ${e.message}`))
        .finally(() => alive && setSearching(false))
    }, 280)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [picking, query, st?.tokenSet, showToast])

  useEffect(() => {
    if (picking) setTimeout(() => searchRef.current?.focus(), 20)
  }, [picking])

  const saveToken = async (): Promise<void> => {
    const v = token.trim()
    if (!v) return
    setSaving(true)
    try {
      const next = await window.api.notion.setToken(v)
      setSt(next)
      setToken('')
      setPicking(!next.parent) // go straight to picking a destination on first connect
      showToast(`Notion 연결됨${next.workspace ? ` · ${next.workspace}` : ''}`)
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const disconnect = async (): Promise<void> => {
    await window.api.notion.clear()
    setSt(await window.api.notion.status())
    setPicking(false)
    setResults(null)
  }
  const pick = async (t: NotionTarget): Promise<void> => {
    setSt(await window.api.notion.setParent(t))
    setPicking(false)
    setQuery('')
  }

  const connected = !!st?.tokenSet

  return (
    <div className="border-t border-black/5 pt-4">
      <div className="mb-2 flex items-center gap-1">
        <span className="text-[13px] font-semibold">Notion 연결</span>
        <HelpTip text="스튜디오 메모(요약·퀴즈·표 등)를 Notion 페이지로 내보내요. Notion 통합(Integration) 토큰으로 연결하고, 내보낼 상위 페이지를 고르면 그 아래에 새 페이지가 만들어져요." />
        <span className={`ml-1 inline-block h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-gray-300'}`} />
        {connected && <span className="text-[11px] text-emerald-600">연결됨{st?.workspace ? ` · ${st.workspace}` : ''}</span>}
        <div className="flex-1" />
        <button
          onClick={() => void window.api.shell.openExternal(INTEGRATIONS_URL)}
          className="flex items-center gap-1 rounded-lg border border-black/10 bg-white px-2 py-1 text-[11.5px] text-subtle hover:bg-black/5"
          title="notion.so/my-integrations 열기"
        >
          <ExternalLink size={12} /> 통합 만들기
        </button>
      </div>

      {!connected ? (
        <>
          <div className="flex gap-1">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void saveToken()}
              placeholder="Internal Integration Secret (ntn_… / secret_…)"
              className="flex-1 rounded-lg border border-black/10 bg-white px-2.5 py-2 text-[12px] outline-none focus:border-accent"
            />
            <button
              onClick={() => void saveToken()}
              disabled={saving || !token.trim()}
              className="flex shrink-0 items-center gap-1 rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} 연결
            </button>
          </div>
          <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-[11.5px] leading-relaxed text-subtle">
            <li>위 "통합 만들기"에서 새 통합을 만들고 <b>Internal Integration Secret</b>을 복사해 붙여넣어요.</li>
            <li>Notion에서 내보낼 페이지를 열고 <b>··· → 연결 → 방금 만든 통합</b>을 추가해요.</li>
            <li>연결 후 여기서 그 페이지를 검색해 내보낼 위치로 선택해요.</li>
          </ol>
        </>
      ) : (
        <>
          {/* destination */}
          <div className="flex items-center gap-2">
            <span className="w-[72px] shrink-0 text-[12px] text-subtle">내보낼 위치</span>
            {st?.parent && !picking ? (
              <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-black/10 bg-black/[0.02] px-2.5 py-1.5 text-[12px]">
                <span className="shrink-0">{st.parent.icon ?? (st.parent.type === 'database' ? <Database size={13} className="text-subtle" /> : <FileText size={13} className="text-subtle" />)}</span>
                <span className="truncate text-ink" title={st.parent.title}>
                  {st.parent.title}
                </span>
                <span className="shrink-0 text-[10.5px] text-subtle">{st.parent.type === 'database' ? '데이터베이스' : '페이지'}</span>
              </div>
            ) : (
              <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-dashed border-black/15 px-2.5 py-1.5 text-[12px] text-subtle">
                {picking ? '아래에서 페이지를 선택하세요' : '아직 선택 안 함'}
              </div>
            )}
            <button
              onClick={() => setPicking((v) => !v)}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-[12px] hover:bg-black/5"
            >
              <Search size={12} /> {picking ? '닫기' : st?.parent ? '변경' : '선택'}
            </button>
            <button onClick={() => void disconnect()} title="연결 해제" className="rounded-lg border border-black/10 bg-white p-2 text-subtle hover:bg-red-50 hover:text-red-500">
              <Unplug size={13} />
            </button>
          </div>

          {picking && (
            <div className="mt-2 rounded-xl border border-black/10 bg-white">
              <div className="flex items-center gap-2 border-b border-black/5 px-2.5 py-1.5">
                <Search size={13} className="shrink-0 text-subtle" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="페이지 이름 검색 (통합에 연결된 페이지만 보여요)"
                  className="flex-1 bg-transparent text-[12px] outline-none"
                />
                {searching ? <Loader2 size={13} className="animate-spin text-subtle" /> : <RotateCcw size={13} className="cursor-pointer text-subtle" onClick={() => setQuery((q) => q + '')} />}
              </div>
              <div className="max-h-48 overflow-y-auto py-1">
                {results && results.length === 0 && !searching && (
                  <div className="px-3 py-3 text-[11.5px] leading-relaxed text-subtle">
                    보이는 페이지가 없어요. Notion에서 내보낼 페이지의 <b>··· → 연결</b>에 이 통합을 추가한 뒤 다시 검색하세요.
                  </div>
                )}
                {(results ?? []).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => void pick(t)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-black/5"
                  >
                    <span className="w-4 shrink-0 text-center">{t.icon ?? (t.type === 'database' ? <Database size={13} className="text-subtle" /> : <FileText size={13} className="text-subtle" />)}</span>
                    <span className="min-w-0 flex-1 truncate text-ink">{t.title}</span>
                    <span className="shrink-0 text-[10.5px] text-subtle">{t.type === 'database' ? '데이터베이스' : '페이지'}</span>
                    {st?.parent?.id === t.id && <Check size={13} className="shrink-0 text-accent" />}
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="mt-1.5 text-[11px] leading-relaxed text-subtle">
            스튜디오 메모의 <b>⋮ → Notion으로 내보내기</b>가 이 위치 아래에 새 페이지를 만들어요. 수식은 Notion 수식 블록으로, 표는 표 블록으로 옮겨져요.
          </p>
        </>
      )}
    </div>
  )
}
