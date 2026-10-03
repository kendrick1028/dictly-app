import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Mic, Monitor, Sparkles, Users } from 'lucide-react'
import { useStore } from '../store/useStore'

/** When true, pill dropdowns collapse to icon-only (set by the record bar when it gets narrow). */
const CompactCtx = createContext(false)
export function PillCompactProvider({ compact, children }: { compact: boolean; children: ReactNode }): JSX.Element {
  return <CompactCtx.Provider value={compact}>{children}</CompactCtx.Provider>
}

// default = Sonnet 5.5 (store.claudeModel); Fable 5.1 = most capable, Haiku 4.5 = fastest
export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' }
]
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5-5'
// GPT-5.6 three-tier family (Codex CLI model ids): Sol = flagship, Terra = balanced, Luna = fast/volume.
// GPT-6 family first (needs Codex CLI 0.160+); the 5.6 models stay so existing choices keep working
export const GPT_MODELS = [
  { id: 'gpt-6-astra', label: 'GPT-6 Astra' },
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna' },
  { id: 'gpt-5.6-sol', label: 'gpt-5.6 Sol' },
  { id: 'gpt-5.6-terra', label: 'gpt-5.6 Terra' },
  { id: 'gpt-5.6-luna', label: 'gpt-5.6 Luna' }
]
// Codex reasoning effort (headless: `-c model_reasoning_effort=<id>`). GPT-5.6 dropped `minimal` and
// added `xhigh`(Extra High)·`max`·`ultra`. There is no separate "fast mode" flag — Low IS the fast path.
const REASONING = [
  { id: 'low', label: 'Low · 빠름' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra High' },
  { id: 'max', label: 'Max' },
  { id: 'ultra', label: 'Ultra' }
]
const CLAUDE_EFFORT = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra' },
  { id: 'max', label: 'Max' }
]

/** Label of the model the current engine will answer with (record pill's second line while recording). */
export function useModelLabel(): string {
  const aiEngine = useStore((s) => s.aiEngine)
  const claudeModel = useStore((s) => s.claudeModel)
  const gptModel = useStore((s) => s.gptModel)
  const agyModel = useStore((s) => s.agyModel)
  const agyModels = useStore((s) => s.agyModels)
  if (aiEngine === 'antigravity') return agyModels.find((m) => m.id === agyModel)?.label ?? (agyModel || 'Antigravity')
  const isGpt = aiEngine === 'gpt'
  const models = isGpt ? GPT_MODELS : CLAUDE_MODELS
  return models.find((m) => m.id === (isGpt ? gptModel : claudeModel))?.label ?? (isGpt ? 'GPT' : 'Claude')
}

/** Custom popover dropdown that opens upward (used in the bottom pill / chat bar). The trigger is
 *  borderless (icon · label · ⌄ with a hover tint) so it doesn't nest a second rounded outline
 *  inside the pill. In compact mode (narrow record bar) the label animates away, icon only. */
function Dropdown({ label, icon, children }: { label: string; icon?: ReactNode; children: (close: () => void) => ReactNode }): JSX.Element {
  const compact = useContext(CompactCtx) && !!icon
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={compact ? label : undefined}
        className={`flex items-center rounded-lg text-[12.5px] text-ink transition-all duration-200 hover:bg-black/[0.04] ${
          open ? 'bg-black/5' : ''
        } ${compact ? 'gap-0 px-2 py-[7px]' : 'gap-1.5 px-2.5 py-[7px]'}`}
      >
        {icon && <span className="flex shrink-0 items-center text-subtle">{icon}</span>}
        <span className={`truncate transition-all duration-200 ${compact ? 'max-w-0 opacity-0' : 'max-w-[110px] opacity-100'}`}>{label}</span>
        {/* chevron collapses away in compact mode → icon only */}
        <span className={`overflow-hidden transition-all duration-200 ${compact ? 'max-w-0 opacity-0' : 'max-w-[14px] opacity-100'}`}>
          <ChevronDown size={12} className="text-subtle" />
        </span>
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-2 w-52 overflow-hidden rounded-xl border border-black/10 bg-white py-1 shadow-xl">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

function Row({ active, onClick, children }: { active?: boolean; onClick: () => void; children: ReactNode }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[13px] hover:bg-black/[0.04]"
    >
      <span className="truncate">{children}</span>
      {active && <Check size={15} className="shrink-0 text-accent" />}
    </button>
  )
}

function SectionLabel({ children }: { children: ReactNode }): JSX.Element {
  return <div className="px-3 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">{children}</div>
}

/** Input source picker: 시스템 / 마이크. */
export function SourceMenu(): JSX.Element {
  const { rec, setAudioSource } = useStore()
  return (
    <Dropdown
      label={rec.source === 'system' ? '시스템' : '마이크'}
      icon={rec.source === 'system' ? <Monitor size={14} /> : <Mic size={14} />}
    >
      {(close) => (
        <>
          <Row active={rec.source === 'system'} onClick={() => { void setAudioSource('system'); close() }}>
            시스템
          </Row>
          <Row active={rec.source === 'mic'} onClick={() => { void setAudioSource('mic'); close() }}>
            마이크
          </Row>
        </>
      )}
    </Dropdown>
  )
}

/** Agent (keyword set) picker for the current note. Sets the open memo's agent, or the default. */
export function AgentMenu(): JSX.Element {
  const agents = useStore((s) => s.agents)
  const memoAgentId = useStore((s) => s.memo?.agentId)
  const activeAgentId = useStore((s) => s.activeAgentId)
  const setNoteAgent = useStore((s) => s.setNoteAgent)
  const setAgentManagerOpen = useStore((s) => s.setAgentManagerOpen)
  const curId = memoAgentId ?? activeAgentId
  const curLabel = agents.find((a) => a.id === curId)?.name ?? '에이전트 없음'
  return (
    <Dropdown label={curLabel} icon={<Users size={14} />}>
      {(close) => (
        <>
          <SectionLabel>에이전트 (키워드)</SectionLabel>
          <Row active={curId == null} onClick={() => { void setNoteAgent(null); close() }}>
            에이전트 없음
          </Row>
          {agents.map((a) => (
            <Row key={a.id} active={curId === a.id} onClick={() => { void setNoteAgent(a.id); close() }}>
              {a.name}
            </Row>
          ))}
          <div className="my-1 border-t border-black/5" />
          <Row onClick={() => { setAgentManagerOpen(true, true); close() }}>에이전트 관리…</Row>
        </>
      )}
    </Dropdown>
  )
}

/** Engine-aware model picker + provider speed control (Claude: 작업량/effort / GPT: 추론 강도). */
export function ModelMenu(): JSX.Element {
  const { aiEngine, claudeModel, setClaudeModel, gptModel, setGptModel, gptReasoning, setGptReasoning, claudeEffort, setClaudeEffort, agyModel, agyModels, setAgyModel } =
    useStore()
  if (aiEngine === 'antigravity') {
    // Antigravity: the CLI lists its models by display name (effort is part of the name, e.g. "(Low)")
    return (
      <Dropdown label={agyModels.find((m) => m.id === agyModel)?.label ?? (agyModel || 'Antigravity 기본')} icon={<Sparkles size={14} />}>
        {(close) => (
          <>
            <SectionLabel>모델 (Antigravity)</SectionLabel>
            <Row active={!agyModel} onClick={() => { void setAgyModel(''); close() }}>
              CLI 기본 모델
            </Row>
            {agyModels.map((m) => (
              <Row key={m.id} active={agyModel === m.id} onClick={() => { void setAgyModel(m.id); close() }}>
                {m.label}
              </Row>
            ))}
          </>
        )}
      </Dropdown>
    )
  }
  const isGpt = aiEngine === 'gpt'
  const models = isGpt ? GPT_MODELS : CLAUDE_MODELS
  const curId = isGpt ? gptModel : claudeModel
  const curLabel = models.find((m) => m.id === curId)?.label ?? (isGpt ? 'GPT' : 'Claude')
  return (
    <Dropdown label={curLabel} icon={<Sparkles size={14} />}>
      {(close) => (
        <>
          <SectionLabel>모델</SectionLabel>
          {models.map((m) => (
            <Row
              key={m.id}
              active={curId === m.id}
              onClick={() => {
                if (isGpt) void setGptModel(m.id)
                else setClaudeModel(m.id)
                close()
              }}
            >
              {m.label}
            </Row>
          ))}
          <div className="my-1 border-t border-black/5" />
          {isGpt ? (
            <>
              <SectionLabel>추론 강도 (낮을수록 빠름)</SectionLabel>
              {REASONING.map((r) => (
                <Row key={r.id} active={gptReasoning === r.id} onClick={() => { void setGptReasoning(r.id); close() }}>
                  {r.label}
                </Row>
              ))}
            </>
          ) : (
            <>
              <SectionLabel>작업량 (낮을수록 빠름)</SectionLabel>
              {CLAUDE_EFFORT.map((e) => (
                <Row key={e.id} active={claudeEffort === e.id} onClick={() => { void setClaudeEffort(e.id); close() }}>
                  {e.label}
                </Row>
              ))}
            </>
          )}
        </>
      )}
    </Dropdown>
  )
}
