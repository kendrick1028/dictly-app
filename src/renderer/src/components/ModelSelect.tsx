import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useStore } from '../store/useStore'

export const CLAUDE_MODELS = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' }
]
// GPT-5.6 three-tier family (Codex CLI model ids): Sol = flagship, Terra = balanced, Luna = fast/volume.
export const GPT_MODELS = [
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

/** Custom popover dropdown that opens upward (used in the bottom pill / chat bar). */
function Dropdown({ label, children }: { label: string; children: (close: () => void) => ReactNode }): JSX.Element {
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
        className={`flex items-center gap-1 rounded-full border px-3 py-1.5 text-[12px] transition ${open ? 'border-accent bg-accent/5' : 'border-black/10 bg-white hover:bg-black/[0.03]'}`}
      >
        <span className="max-w-[120px] truncate">{label}</span>
        <ChevronDown size={13} className="text-subtle" />
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
  const { rec, setRec } = useStore()
  return (
    <Dropdown label={rec.source === 'system' ? '시스템' : '마이크'}>
      {(close) => (
        <>
          <Row active={rec.source === 'system'} onClick={() => { setRec({ source: 'system' }); close() }}>
            시스템
          </Row>
          <Row active={rec.source === 'mic'} onClick={() => { setRec({ source: 'mic' }); close() }}>
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
    <Dropdown label={curLabel}>
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
  const { aiEngine, claudeModel, setClaudeModel, gptModel, setGptModel, gptReasoning, setGptReasoning, claudeEffort, setClaudeEffort } =
    useStore()
  const isGpt = aiEngine === 'gpt'
  const models = isGpt ? GPT_MODELS : CLAUDE_MODELS
  const curId = isGpt ? gptModel : claudeModel
  const curLabel = models.find((m) => m.id === curId)?.label ?? (isGpt ? 'GPT' : 'Claude')
  return (
    <Dropdown label={curLabel}>
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
