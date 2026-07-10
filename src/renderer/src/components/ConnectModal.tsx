import { useEffect, useState } from 'react'
import { X, Check, RefreshCw, Loader2, Terminal, Cloud } from 'lucide-react'
import { useStore } from '../store/useStore'
import { HelpTip } from './HelpTip'
import { CLAUDE_MODELS, GPT_MODELS } from './ModelSelect'
import type { AiEngine } from '../../../shared/types'

export function ConnectModal(): JSX.Element | null {
  const {
    connectOpen,
    setConnectOpen,
    claude,
    gpt,
    connectionMode,
    setConnectionMode,
    aiEngine,
    setAiEngine,
    refreshAiStatus,
    anthropicKeySet,
    openaiKeySet,
    geminiKeySet,
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
  const [modelDraft, setModelDraft] = useState({ claude: '', openai: '', gemini: '' })

  // sync editable model fields from the store each time the modal opens
  useEffect(() => {
    if (connectOpen) setModelDraft({ claude: anthropicApiModel, openai: openaiApiModel, gemini: geminiApiModel })
  }, [connectOpen, anthropicApiModel, openaiApiModel, geminiApiModel])

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
  const CliCard = ({
    engine,
    name,
    connected,
    selectable,
    hint,
    install
  }: {
    engine: AiEngine
    name: string
    connected: boolean
    selectable: boolean
    hint: string
    install: JSX.Element
  }): JSX.Element => {
    const selected = aiEngine === engine
    return (
      <button
        onClick={() => selectable && setAiEngine(engine)}
        disabled={!selectable}
        className={`w-full rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
          selected ? 'border-accent bg-accent/5' : 'border-black/10 hover:bg-black/[0.02]'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium">{name}</span>
          <Dot ok={connected} />
          <div className="flex-1" />
          {selected && <Check size={16} className="text-accent" />}
        </div>
        {/* engine speed/fit shown inline (not hidden behind a ? tooltip) — it's the key choice info */}
        <div className="mt-1 text-[12px] leading-snug text-subtle">{hint}</div>
        {!connected && <div className="mt-1 text-[12px] text-subtle">{install}</div>}
      </button>
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
    engine: AiEngine
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
            <HelpTip text="정리·요약·퀴즈·채팅·실시간 교정에 쓸 AI 연결 방식을 고르는 곳이에요. CLI 연결은 터미널 도구(Claude Code·Codex), API 연결은 각 제공사 API 키로 직접 연결해요." />
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
            />
            {/* default model for the selected CLI engine */}
            <div className="flex items-center gap-2 px-0.5 pt-1">
              <span className="text-[12px] font-medium text-subtle">기본 모델</span>
              <HelpTip text="CLI로 정리·요약·퀴즈·채팅 등에 기본으로 사용할 모델이에요. (채팅·교정에서 그때그때 바꿀 수도 있어요)" />
              <div className="flex-1" />
              {aiEngine === 'gpt' ? (
                <select
                  value={gptModel}
                  onChange={(e) => void setGptModel(e.target.value)}
                  className="rounded-lg border border-black/10 bg-white px-2 py-1 text-[12px] outline-none focus:border-accent"
                >
                  {GPT_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  value={claudeModel}
                  onChange={(e) => setClaudeModel(e.target.value)}
                  className="rounded-lg border border-black/10 bg-white px-2 py-1 text-[12px] outline-none focus:border-accent"
                >
                  {CLAUDE_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
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
      </div>
    </div>
  )
}
