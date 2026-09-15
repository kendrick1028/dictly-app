import { useEffect, useState } from 'react'
import { X, Check, RefreshCw, Loader2, Terminal, Cloud, AlertTriangle, UserRound } from 'lucide-react'
import { useStore } from '../store/useStore'
import { HelpTip } from './HelpTip'
import { CLAUDE_MODELS, GPT_MODELS } from './ModelSelect'
import type { AiEngine, CliAccount } from '../../../shared/types'

/** human label for a CLI plan / auth method */
function planLabel(a: CliAccount): string | null {
  const p = (a.plan ?? '').toLowerCase()
  if (p === 'max') return 'Max'
  if (p === 'pro') return 'Pro'
  if (p === 'plus') return 'Plus'
  if (p === 'team') return 'Team'
  if (p === 'enterprise') return 'Enterprise'
  if (p === 'free') return 'Free'
  if (p === 'api' || a.method === 'apikey' || a.method === 'console') return 'API 키'
  return a.plan ? a.plan : null
}

/** "who is signed in" row under a CLI card — avatar initial · email · plan badge · org */
function AccountRow({ account, loginHint }: { account: CliAccount | null | undefined; loginHint: string }): JSX.Element {
  if (!account || (!account.email && !account.plan && !account.name)) {
    return (
      <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11.5px] text-amber-700">
        <AlertTriangle size={12} className="shrink-0" />
        로그인 계정을 확인할 수 없어요 — {loginHint}
      </div>
    )
  }
  const who = account.email ?? account.name ?? '로그인됨'
  const initial = (account.name ?? account.email ?? '?').trim().charAt(0).toUpperCase()
  const plan = planLabel(account)
  const org = account.org && account.email && !account.org.startsWith(account.email) ? account.org : null
  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg bg-black/[0.035] px-2.5 py-1.5">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">
        {initial || <UserRound size={12} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-ink" title={who}>
          {who}
        </span>
        {org && (
          <span className="block truncate text-[10.5px] text-subtle" title={org}>
            {org}
          </span>
        )}
      </span>
      {plan && <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700">{plan}</span>}
    </div>
  )
}

export function ConnectModal(): JSX.Element | null {
  const {
    connectOpen,
    setConnectOpen,
    claude,
    gpt,
    antigravity,
    agyModel,
    agyModels,
    setAgyModel,
    aiFallback,
    clearAiFallback,
    connectionMode,
    setConnectionMode,
    aiEngine,
    setAiEngine,
    refreshAiStatus,
    anthropicKeySet,
    openaiKeySet,
    geminiKeySet,
    metaKeySet,
    setMetaKey,
    anthropicApiModel,
    openaiApiModel,
    geminiApiModel,
    setAnthropicKey,
    setOpenaiKey,
    setGeminiKey,
    setApiModel,
    claudeModel,
    setClaudeModel,
    gptModel,
    setGptModel
  } = useStore()
  const [checking, setChecking] = useState(false)
  const [keyDraft, setKeyDraft] = useState({ claude: '', openai: '', gemini: '' })
  const [metaDraft, setMetaDraft] = useState('')
  const [modelDraft, setModelDraft] = useState({ claude: '', openai: '', gemini: '' })

  // sync editable model fields from the store each time the modal opens
  useEffect(() => {
    if (connectOpen) setModelDraft({ claude: anthropicApiModel, openai: openaiApiModel, gemini: geminiApiModel })
  }, [connectOpen, anthropicApiModel, openaiApiModel, geminiApiModel])

  // Opening this modal is itself a reconnect request. Avoid showing a stale disconnected state
  // captured while npm was in the middle of replacing the CLI package.
  useEffect(() => {
    if (!connectOpen) return
    setChecking(true)
    void refreshAiStatus().finally(() => setChecking(false))
  }, [connectOpen, refreshAiStatus])

  if (!connectOpen) return null

  const recheck = async (): Promise<void> => {
    setChecking(true)
    try {
      await refreshAiStatus()
    } finally {
      setChecking(false)
    }
  }

  const Dot = ({ ok }: { ok: boolean }): JSX.Element => (
    <span className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-gray-300'}`} />
  )

  // ---- CLI card (Claude Code / Codex) — checkmark only on the SELECTED engine ----
  // default model for a CLI engine — lives INSIDE its card, shown only on the selected one
  const ModelRow = ({ engine }: { engine: AiEngine }): JSX.Element => {
    const sel = 'rounded-lg border border-black/10 bg-white px-2 py-1 text-[12px] outline-none focus:border-accent'
    return (
      <div className="mt-2 flex items-center gap-2 border-t border-black/5 pt-2" onClick={(e) => e.stopPropagation()}>
        <span className="text-[12px] font-medium text-subtle">기본 모델</span>
        <HelpTip text="정리·요약·퀴즈·채팅 등에 기본으로 사용할 모델이에요. (채팅·교정에서 그때그때 바꿀 수도 있어요)" />
        <div className="flex-1" />
        {engine === 'antigravity' ? (
          <select value={agyModel} onChange={(e) => void setAgyModel(e.target.value)} className={`max-w-[220px] ${sel}`}>
            <option value="">CLI 기본 모델</option>
            {agyModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        ) : engine === 'gpt' ? (
          <select value={gptModel} onChange={(e) => void setGptModel(e.target.value)} className={sel}>
            {GPT_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        ) : (
          <select value={claudeModel} onChange={(e) => setClaudeModel(e.target.value)} className={sel}>
            {CLAUDE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        )}
      </div>
    )
  }

  const CliCard = ({
    engine,
    name,
    connected,
    selectable,
    hint,
    install,
    account,
    loginHint
  }: {
    engine: AiEngine
    name: string
    connected: boolean
    selectable: boolean
    hint: string
    install: JSX.Element
    account?: CliAccount | null
    loginHint: string
  }): JSX.Element => {
    const selected = aiEngine === engine
    // a div (not a button) so the model <select> inside the selected card is a real, clickable control
    return (
      <div
        role="button"
        tabIndex={selectable ? 0 : -1}
        aria-disabled={!selectable}
        onClick={() => selectable && !selected && void setAiEngine(engine)}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && selectable && !selected) {
            e.preventDefault()
            void setAiEngine(engine)
          }
        }}
        className={`w-full rounded-xl border p-3 text-left transition ${
          selected ? 'border-accent bg-accent/5' : selectable ? 'cursor-pointer border-black/10 hover:bg-black/[0.02]' : 'cursor-not-allowed border-black/10 opacity-60'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium">{name}</span>
          <Dot ok={connected} />
          {connected && <span className="text-[11px] text-emerald-600">연결됨</span>}
          <div className="flex-1" />
          {selected && <Check size={16} className="text-accent" />}
        </div>
        {/* engine speed/fit shown inline (not hidden behind a ? tooltip) — it's the key choice info */}
        <div className="mt-1 text-[12px] leading-snug text-subtle">{hint}</div>
        {!connected && <div className="mt-1 text-[12px] text-subtle">{install}</div>}
        {/* signed-in account — the thing people actually need to see at a glance */}
        {connected && <AccountRow account={account} loginHint={loginHint} />}
        {selected && <ModelRow engine={engine} />}
      </div>
    )
  }

  // ---- API provider card — key + optional model + select-as-engine ----
  const ApiCard = ({
    engine,
    name,
    keySet,
    keyField,
    onSaveKey,
    placeholder,
    modelPlaceholder
  }: {
    engine: 'claude' | 'gpt' | 'gemini'
    name: string
    keySet: boolean
    keyField: 'claude' | 'openai' | 'gemini'
    onSaveKey: (k: string) => Promise<void>
    placeholder: string
    modelPlaceholder: string
  }): JSX.Element => {
    const selected = aiEngine === engine
    return (
      <div className={`rounded-xl border p-3 transition ${selected ? 'border-accent bg-accent/5' : 'border-black/10'}`}>
        <button onClick={() => setAiEngine(engine)} className="flex w-full items-center gap-2 text-left">
          <span className="text-[14px] font-medium">{name}</span>
          <Dot ok={keySet} />
          {keySet && <span className="text-[11px] text-emerald-600">저장됨</span>}
          <div className="flex-1" />
          {selected && <Check size={16} className="text-accent" />}
        </button>
        <div className="mt-2 flex gap-1">
          <input
            type="password"
            value={keyDraft[keyField]}
            onChange={(e) => setKeyDraft((d) => ({ ...d, [keyField]: e.target.value }))}
            placeholder={keySet ? '••••••••  (저장됨, 변경하려면 입력)' : placeholder}
            className="flex-1 rounded-lg border border-black/10 bg-white px-2 py-1.5 text-[12px] outline-none focus:border-accent"
          />
          <button
            onClick={() => {
              const v = keyDraft[keyField].trim()
              if (v) void onSaveKey(v)
              setKeyDraft((d) => ({ ...d, [keyField]: '' }))
            }}
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent/90"
          >
            저장
          </button>
        </div>
        <div className="mt-1.5 flex gap-1">
          <input
            value={modelDraft[keyField]}
            onChange={(e) => setModelDraft((d) => ({ ...d, [keyField]: e.target.value }))}
            onBlur={() => void setApiModel(engine, modelDraft[keyField].trim())}
            placeholder={`모델 (기본: ${modelPlaceholder})`}
            className="flex-1 rounded-lg border border-black/10 bg-white px-2 py-1.5 text-[12px] outline-none focus:border-accent"
          />
        </div>
      </div>
    )
  }

  const Seg = ({ mode, icon, label }: { mode: 'cli' | 'api'; icon: JSX.Element; label: string }): JSX.Element => (
    <button
      onClick={() => {
        if (mode === 'cli' && aiEngine === 'gemini') void setAiEngine('claude') // gemini has no CLI
        if (mode === 'api' && aiEngine === 'antigravity') void setAiEngine('claude') // antigravity has no API
        void setConnectionMode(mode)
      }}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
        connectionMode === mode ? 'bg-white text-ink shadow-sm' : 'text-subtle hover:text-ink'
      }`}
    >
      {icon} {label}
    </button>
  )

  return (
    <div className="dictly-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/30" onMouseDown={() => setConnectOpen(false)}>
      <div className="dictly-modal-in w-[480px] max-w-[92vw] rounded-2xl border border-black/10 bg-white p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <h2 className="text-[15px] font-semibold">AI 연결</h2>
            <HelpTip text="정리·요약·퀴즈·채팅·실시간 교정에 쓸 AI 연결 방식을 고르는 곳이에요. CLI 연결은 터미널 도구(Claude Code·Codex·Antigravity), API 연결은 각 제공사 API 키로 직접 연결해요." />
          </div>
          <div className="flex items-center gap-1">
            <button onClick={recheck} className="rounded-lg p-1.5 text-subtle hover:bg-black/5" title="상태 다시 확인">
              {checking ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            </button>
            <button onClick={() => setConnectOpen(false)} className="rounded-lg p-1.5 text-subtle hover:bg-black/5">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* sticky usage-limit fallback in effect → say so, and offer to go back */}
        {aiFallback && (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            <AlertTriangle size={14} className="shrink-0" />
            <span className="min-w-0 flex-1 leading-snug">
              <b>{aiFallback.from}</b> 사용량 한도 초과 — 지금은 <b>{aiFallback.to}</b>로 동작 중이에요. 한도가 풀릴 때까지 자동으로 유지돼요.
            </span>
            <button
              onClick={() => void clearAiFallback()}
              className="shrink-0 rounded-lg border border-amber-300 bg-white px-2 py-1 text-[11.5px] font-medium text-amber-800 hover:bg-amber-100"
              title="다음 작업부터 원래 프로바이더를 다시 시도해요"
            >
              {aiFallback.from}로 다시 시도
            </button>
          </div>
        )}

        {/* mode toggle */}
        <div className="mb-3 flex gap-1 rounded-xl bg-black/[0.04] p-1">
          <Seg mode="cli" icon={<Terminal size={14} />} label="CLI 연결" />
          <Seg mode="api" icon={<Cloud size={14} />} label="API 연결" />
        </div>

        {connectionMode === 'cli' ? (
          <div className="space-y-2">
            <CliCard
              engine="claude"
              name="Claude (Claude Code)"
              connected={!!claude?.installed}
              selectable
              hint="앤트로픽 Claude를 터미널 CLI로 사용해요. 응답이 빨라 실시간 교정에 가장 적합해요."
              install={
                <>
                  터미널에서 설치 후 로그인: <code className="rounded bg-black/5 px-1">npm i -g @anthropic-ai/claude-code</code> →{' '}
                  <code className="rounded bg-black/5 px-1">claude</code>
                </>
              }
              account={claude?.account}
              loginHint="터미널에서 claude 실행 → /login"
            />
            <CliCard
              engine="gpt"
              name="GPT (OpenAI Codex)"
              connected={!!gpt?.installed && !!gpt?.loggedIn}
              selectable={!!gpt?.installed && !!gpt?.loggedIn}
              hint="OpenAI Codex CLI(ChatGPT 구독)로 사용해요. 응답이 수십 초 걸려 실시간 교정엔 느려요."
              install={
                <>
                  ChatGPT 구독으로 사용: <code className="rounded bg-black/5 px-1">npm i -g @openai/codex</code> →{' '}
                  <code className="rounded bg-black/5 px-1">codex login</code>
                </>
              }
              account={gpt?.account}
              loginHint="터미널에서 codex login"
            />
            <CliCard
              engine="antigravity"
              name="Antigravity (Google agy)"
              connected={!!antigravity?.installed && !!antigravity?.loggedIn}
              selectable={!!antigravity?.installed && !!antigravity?.loggedIn}
              hint="Google Antigravity CLI(Google 계정)로 Gemini·Claude·GPT-OSS 모델을 써요. 호출마다 5~10초 걸려 실시간 교정엔 느려요."
              install={
                <>
                  설치 후 로그인: <code className="rounded bg-black/5 px-1">curl -fsSL https://antigravity.google/cli/install.sh | bash</code> →{' '}
                  <code className="rounded bg-black/5 px-1">agy</code>
                </>
              }
              account={antigravity?.account}
              loginHint="터미널에서 agy 실행 → Google 로그인"
            />
          </div>
        ) : (
          <div className="space-y-2">
            <p className="px-0.5 text-[12px] leading-relaxed text-subtle">
              API 키로 직접 연결해요. 선택한 제공사로 <b>모든 AI 기능</b>(정리·요약·퀴즈·채팅·교정·이미지)이 동작합니다.
            </p>
            <ApiCard
              engine="claude"
              name="Claude (Anthropic)"
              keySet={anthropicKeySet}
              keyField="claude"
              onSaveKey={setAnthropicKey}
              placeholder="sk-ant-..."
              modelPlaceholder="claude-3-5-sonnet-latest"
            />
            <ApiCard
              engine="gpt"
              name="OpenAI"
              keySet={openaiKeySet}
              keyField="openai"
              onSaveKey={setOpenaiKey}
              placeholder="sk-..."
              modelPlaceholder="gpt-4o"
            />
            <ApiCard
              engine="gemini"
              name="Gemini"
              keySet={geminiKeySet}
              keyField="gemini"
              onSaveKey={setGeminiKey}
              placeholder="AIza..."
              modelPlaceholder="gemini-2.0-flash"
            />
            <p className="px-0.5 text-[11px] leading-relaxed text-subtle">
              OpenAI 키는 실시간 전사(하단 ⚙)에도 함께 쓰여요. 사용한 만큼 각 제공사에 과금됩니다.
            </p>
          </div>
        )}
        {/* transcription-only provider: Meta Muse Voice Transcribe (선택 시 하단 ⚙ 전사 모델 → Meta) */}
        <div className="mt-3 rounded-xl border border-black/10 p-3">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-medium">Meta 음성 전사</span>
            <Dot ok={metaKeySet} />
            {metaKeySet && <span className="text-[11px] text-emerald-600">저장됨</span>}
            <span className="text-[11px] text-subtle">· 전사 전용 (Muse Voice Transcribe)</span>
          </div>
          <div className="mt-2 flex gap-1">
            <input
              type="password"
              value={metaDraft}
              onChange={(e) => setMetaDraft(e.target.value)}
              placeholder={metaKeySet ? '••••••••  (저장됨, 변경하려면 입력)' : 'Meta Model API 키 (dev.meta.ai)'}
              className="flex-1 rounded-lg border border-black/10 bg-white px-2 py-1.5 text-[12px] outline-none focus:border-accent"
            />
            <button
              onClick={() => {
                const v = metaDraft.trim()
                if (v) void setMetaKey(v)
                setMetaDraft('')
              }}
              className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent/90"
            >
              저장
            </button>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-subtle">
            녹음 옵션(⚙)의 전사 모델에서 <b>Meta</b>를 고르면 클라우드로 실시간 전사해요(시간당 $0.18). 에이전트·노트 키워드가 용어 사전으로 전달됩니다.
          </p>
        </div>
      </div>
    </div>
  )
}
