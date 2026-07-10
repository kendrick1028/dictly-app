import { useEffect, useState } from 'react'
import { ChevronRight, FileText, Loader2, Plus, RotateCcw, Sparkles, Trash2, X } from 'lucide-react'
import { useStore } from '../store/useStore'
import { HelpTip } from './HelpTip'
import { loadPdfDoc } from '../lib/pdfText'
import { runMemoKeywordExtraction } from '../lib/memoKeywords'
import type { Agent, AutoRule } from '../../../shared/types'

/** read up to ~20k chars of text from a PDF file (reference textbook for agent generation) */
async function readPdfText(path: string): Promise<string> {
  const doc = await loadPdfDoc(path)
  let text = ''
  for (let i = 1; i <= Math.min(doc.numPages, 40) && text.length < 20000; i++) {
    const page = await doc.getPage(i)
    const tc = await page.getTextContent()
    text += tc.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n'
  }
  return text
}

type Draft = Omit<Agent, 'id' | 'createdAt'>

/** parse the agent-generation JSON (tolerates code fences / surrounding prose) */
function parseGenerated(raw: string): Partial<Draft> | null {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>
    return {
      name: typeof o.name === 'string' ? o.name : '',
      keywords: Array.isArray(o.keywords) ? (o.keywords as string[]).map(String) : [],
      mathRules: (o.mathRules && typeof o.mathRules === 'object' ? o.mathRules : {}) as Record<string, string>,
      replacements: (o.replacements && typeof o.replacements === 'object' ? o.replacements : {}) as Record<string, string>,
      systemPrompt: typeof o.systemPrompt === 'string' ? o.systemPrompt : ''
    }
  } catch {
    return null
  }
}

const EMPTY: Draft = { name: '', keywords: [], correctionKeywords: [], mathRules: {}, replacements: {}, systemPrompt: '', selfImprove: false }

function rulesToText(rules: Record<string, string>): string {
  return Object.entries(rules)
    .map(([k, v]) => `${k} = ${v}`)
    .join('\n')
}
function textToRules(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) {
      const k = line.slice(0, i).trim()
      const v = line.slice(i + 1).trim()
      if (k) out[k] = v
    }
  }
  return out
}

export function AgentManager(): JSX.Element | null {
  const { agentManagerOpen, agentManagerMemoScope, setAgentManagerOpen, agents, refreshAgents, showToast, aiReady, memo, reloadMemo } =
    useStore()
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [kwText, setKwText] = useState('')
  const [corrKwText, setCorrKwText] = useState('')
  const [ruleText, setRuleText] = useState('')
  const [repText, setRepText] = useState('')
  const [autoRules, setAutoRules] = useState<AutoRule[]>([])
  const [genOpen, setGenOpen] = useState(false)
  const [genLoading, setGenLoading] = useState(false)
  const [genName, setGenName] = useState('') // 에이전트 이름
  const [genSubject, setGenSubject] = useState('') // 과목
  const [genPurpose, setGenPurpose] = useState('') // 목적
  const [genNotes, setGenNotes] = useState('') // 기타 참고사항
  const [genPdfs, setGenPdfs] = useState<{ path: string; name: string }[]>([]) // reference textbooks
  const [memoKwText, setMemoKwText] = useState('') // current note's per-note keywords (separate field)
  const [memoKwLoading, setMemoKwLoading] = useState(false) // AI extraction in progress
  const [advOpen, setAdvOpen] = useState(false) // 세부 규칙·자동화 섹션 접기 (기본 접힘)

  useEffect(() => {
    if (!agentManagerOpen) return
    const st = useStore.getState()
    // opened from the note pill (memo scope) → preselect the agent linked to this note
    const linkedId = agentManagerMemoScope ? (st.memo?.agentId ?? st.activeAgentId) : null
    const target = (linkedId != null ? agents.find((a) => a.id === linkedId) : undefined) ?? agents[0]
    if (target) loadAgent(target)
    else startNew()
    setMemoKwText((st.memo?.keywords ?? []).join(', '))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentManagerOpen])

  const saveMemoKeywords = async (): Promise<void> => {
    if (!memo) return
    const kws = memoKwText
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
    await window.api.memos.setKeywords(memo.id, kws)
    await reloadMemo()
    showToast('이 메모 전용 키워드 저장됨')
  }

  // AI: extract keywords from this note's linked PDFs, then sync the field to the saved result
  const extractMemoKeywords = async (): Promise<void> => {
    if (!memo || memoKwLoading) return
    setMemoKwLoading(true)
    try {
      await runMemoKeywordExtraction(memo.id)
      setMemoKwText((useStore.getState().memo?.keywords ?? []).join(', '))
    } finally {
      setMemoKwLoading(false)
    }
  }

  if (!agentManagerOpen) return null

  const loadAgent = (a: Agent): void => {
    setSelectedId(a.id)
    setDraft({
      name: a.name,
      keywords: a.keywords,
      correctionKeywords: a.correctionKeywords ?? [],
      mathRules: a.mathRules,
      replacements: a.replacements,
      systemPrompt: a.systemPrompt,
      selfImprove: a.selfImprove ?? false
    })
    setKwText(a.keywords.join(', '))
    setCorrKwText((a.correctionKeywords ?? []).join(', '))
    setRuleText(rulesToText(a.mathRules))
    setRepText(rulesToText(a.replacements ?? {}))
    // optional-chained so a stale preload (missing this method) can't crash the modal
    void window.api.agents.listAutoRules?.(a.id)?.then(setAutoRules).catch(() => setAutoRules([]))
  }
  const startNew = (): void => {
    setSelectedId('new')
    setDraft(EMPTY)
    setKwText('')
    setCorrKwText('')
    setRuleText('')
    setRepText('')
    setAutoRules([])
  }

  const syncRuleTextFromAgent = (): void => {
    const fresh = useStore.getState().agents.find((a) => a.id === selectedId)
    if (fresh) {
      setRuleText(rulesToText(fresh.mathRules))
      setRepText(rulesToText(fresh.replacements ?? {}))
    }
  }

  const undoAutoRule = async (r: AutoRule): Promise<void> => {
    if (typeof selectedId !== 'number') return
    await window.api.agents.removeAutoRule(selectedId, r.from, r.to)
    setAutoRules(await window.api.agents.listAutoRules(selectedId))
    await refreshAgents()
    syncRuleTextFromAgent()
  }

  // directly edit the corrected value of an auto-learned rule (from → newTo)
  const editAutoRule = async (r: AutoRule, newTo: string): Promise<void> => {
    const v = newTo.trim()
    if (typeof selectedId !== 'number' || !v || v === r.to) return
    await window.api.agents.updateAutoRule(selectedId, r.from, r.to, v)
    setAutoRules(await window.api.agents.listAutoRules(selectedId))
    await refreshAgents()
    syncRuleTextFromAgent()
  }

  const closeGen = (): void => {
    setGenOpen(false)
    setGenName('')
    setGenSubject('')
    setGenPurpose('')
    setGenNotes('')
    setGenPdfs([])
  }

  const generate = async (): Promise<void> => {
    if (!genSubject.trim()) return
    const desc = [
      genName.trim() ? `에이전트 이름: ${genName.trim()}` : '',
      `과목: ${genSubject.trim()}`,
      genPurpose.trim() ? `목적: ${genPurpose.trim()}` : '',
      genNotes.trim() ? `기타 참고사항: ${genNotes.trim()}` : ''
    ]
      .filter(Boolean)
      .join('\n')
    setGenLoading(true)
    try {
      let pdfText: string | undefined
      if (genPdfs.length) {
        // split the ~20k-char excerpt budget evenly so every attached textbook contributes
        const budget = Math.floor(20000 / genPdfs.length)
        const parts: string[] = []
        let failed = 0
        for (const p of genPdfs) {
          try {
            parts.push(`## ${p.name}\n${(await readPdfText(p.path)).slice(0, budget)}`)
          } catch {
            failed++
          }
        }
        if (parts.length) pdfText = parts.join('\n\n')
        if (failed) showToast(failed === genPdfs.length ? 'PDF를 읽지 못해 설명만으로 생성합니다' : `PDF ${failed}개를 읽지 못했습니다`)
      }
      const raw = await window.api.agents.generate(desc, pdfText)
      const g = parseGenerated(raw)
      if (!g) {
        showToast('생성 결과를 해석하지 못했습니다')
        return
      }
      startNew() // fresh draft to hold the generated agent (review before save)
      setDraft((d) => ({
        ...d,
        name: genName.trim() || g.name || d.name,
        mathRules: g.mathRules ?? {},
        replacements: g.replacements ?? {},
        systemPrompt: g.systemPrompt ?? d.systemPrompt
      }))
      setKwText((g.keywords ?? []).join(', '))
      setRuleText(rulesToText(g.mathRules ?? {}))
      setRepText(rulesToText(g.replacements ?? {}))
      closeGen()
      showToast('에이전트 초안을 생성했어요 — 검토 후 저장하세요')
    } catch (e) {
      showToast(`생성 실패: ${(e as Error).message}`)
    } finally {
      setGenLoading(false)
    }
  }

  const save = async (): Promise<void> => {
    const payload: Draft = {
      name: draft.name.trim() || '새 에이전트',
      keywords: kwText
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
      correctionKeywords: corrKwText
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
      mathRules: textToRules(ruleText),
      replacements: textToRules(repText),
      systemPrompt: draft.systemPrompt,
      selfImprove: draft.selfImprove
    }
    if (selectedId === 'new' || selectedId === null) {
      const created = await window.api.agents.create(payload)
      await refreshAgents()
      setSelectedId(created.id)
    } else {
      await window.api.agents.update(selectedId, payload)
      await refreshAgents()
    }
    showToast(`"${payload.name}" 저장됨`)
  }

  const remove = (): void => {
    if (typeof selectedId !== 'number') return
    useStore.getState().requestConfirm('이 에이전트를 삭제할까요?', async () => {
      await window.api.agents.delete(selectedId)
      await refreshAgents()
      const next = useStore.getState().agents[0]
      if (next) loadAgent(next)
      else startNew()
    })
  }

  return (
    <>
    <div className="dictly-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/30" onMouseDown={() => setAgentManagerOpen(false)}>
      <div
        className="dictly-modal-in flex h-[560px] w-[820px] overflow-hidden rounded-2xl bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* list */}
        <div className="flex w-56 shrink-0 flex-col border-r border-black/5 bg-sidebar">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[13px] font-semibold">에이전트</span>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => setGenOpen(true)}
                disabled={!aiReady}
                title={aiReady ? 'AI로 에이전트 생성' : 'AI 미연결 — 상단에서 연결하세요'}
                className="rounded p-1 text-accent hover:bg-accent/10 disabled:opacity-40"
              >
                <Sparkles size={15} />
              </button>
              <button onClick={startNew} className="rounded p-1 hover:bg-black/5" title="새 에이전트">
                <Plus size={15} />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-2">
            {agents.map((a) => (
              <button
                key={a.id}
                onClick={() => loadAgent(a)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] ${
                  selectedId === a.id ? 'bg-black/[0.06] font-medium' : 'hover:bg-black/[0.04]'
                }`}
              >
                🅰 <span className="flex-1 truncate">{a.name}</span>
              </button>
            ))}
            {selectedId === 'new' && (
              <div className="rounded-lg bg-accent/10 px-2 py-1.5 text-[13px] text-accent">새 에이전트</div>
            )}
          </div>
        </div>

        {/* editor */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-black/5 px-5 py-3">
            <span className="text-[14px] font-semibold">에이전트 설정</span>
            <button onClick={() => setAgentManagerOpen(false)} className="rounded p-1 text-subtle hover:bg-black/5">
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <Field label="이름">
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="예: 재무관리"
                className="w-full rounded-lg border border-black/10 px-3 py-2 text-[14px] outline-none focus:border-accent"
              />
            </Field>

            {agentManagerMemoScope && memo && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-[12px] font-medium text-subtle">이 메모 전용 키워드</label>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => void extractMemoKeywords()}
                      disabled={memoKwLoading || !aiReady}
                      title="연결된 PDF에서 이 메모 전용 키워드를 AI로 추출"
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-40"
                    >
                      {memoKwLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} AI 추출
                    </button>
                    <button
                      onClick={() => void saveMemoKeywords()}
                      className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent/90"
                    >
                      저장
                    </button>
                  </div>
                </div>
                <textarea
                  value={memoKwText}
                  onChange={(e) => setMemoKwText(e.target.value)}
                  rows={2}
                  placeholder={`‘${memo.title}’ 노트에만 적용할 키워드 (쉼표·줄바꿈 구분, 전사·교정 시 우선)`}
                  className="w-full resize-none rounded-lg border border-black/10 px-3 py-2 text-[13px] outline-none focus:border-accent"
                />
              </div>
            )}

            {/* ── 음성인식(전사): Whisper 인식 편향 사전 ── */}
            <div className="!mt-5 border-t border-black/10 pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-subtle/70">음성인식 (전사)</p>
            </div>
            <Field
              label="키워드"
              help="이 과목에서 자주 나오는 용어를 적어두면 녹음할 때 그 단어들을 더 정확하게 알아들어요. 인식 사전에는 앞에서부터 약 350자까지만 들어가니 중요한 용어를 앞쪽에 두세요. 쉼표나 줄바꿈으로 구분."
            >
              <textarea
                value={kwText}
                onChange={(e) => setKwText(e.target.value)}
                rows={4}
                placeholder="자기자본비용, 가중평균자본비용, WACC, CAPM, 베타…"
                className="w-full resize-none rounded-lg border border-black/10 px-3 py-2 text-[13px] outline-none focus:border-accent"
              />
            </Field>

            {/* ── AI 교정·요약·채팅: 시스템 프롬프트 + 교정 힌트 ── */}
            <div className="!mt-5 border-t border-black/10 pt-4">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-subtle/70">AI 교정 · 요약 · 채팅</p>
              <Field
                label="시스템 프롬프트"
                help="실시간 교정·요약·퀴즈·채팅 AI가 항상 따르는 이 과목 전용 지침이에요. ① 과목 맥락 ② 표기 규칙(용어·수식) ③ 교정 태도 순으로 적을수록 정확해져요."
              >
                <textarea
                  value={draft.systemPrompt}
                  onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
                  rows={5}
                  placeholder={'예) CPA 재무관리 강의 전사입니다.\n용어는 표준 표기로: 당기순이익, 가중평균자본비용(WACC), $\\beta_L$, 이연법인세…\n수식은 $...$ KaTeX로 표기하세요.\n확신 없는 용어는 바꾸지 말고 그대로 두고, 구어체 말투는 유지하세요.'}
                  className="w-full resize-none rounded-lg border border-black/10 px-3 py-2 text-[13px] outline-none focus:border-accent"
                />
              </Field>

              <div className="mt-4">
                <Field
                  label="실시간 교정용 키워드"
                  help="녹음 중 실시간 교정 AI에게만 알려주는 용어예요. 위쪽 전사용 키워드와는 따로, 수식이나 선호하는 표기 위주로 적으면 교정이 더 정확해져요. 쉼표나 줄바꿈으로 구분하세요."
                >
                  <textarea
                    value={corrKwText}
                    onChange={(e) => setCorrKwText(e.target.value)}
                    rows={3}
                    placeholder="예: K_e, \\beta_u, \\frac{}{}, 당기순이익, 이연법인세 — 수식/표기 위주로"
                    className="w-full resize-none rounded-lg border border-black/10 px-3 py-2 text-[13px] outline-none focus:border-accent"
                  />
                </Field>
              </div>
            </div>

            {/* ── 세부 규칙 · 자동화: 결정적 치환 규칙 + 자기 학습 (기본 접힘 — 초보는 볼 일 없음) ── */}
            <div className="!mt-5 border-t border-black/10 pt-4">
              <button
                onClick={() => setAdvOpen((v) => !v)}
                className="flex w-full items-center gap-1 text-left text-[12px] font-semibold text-subtle hover:text-ink"
              >
                <ChevronRight size={13} className={`shrink-0 transition ${advOpen ? 'rotate-90' : ''}`} />
                세부 규칙 · 자동화
              </button>
              {advOpen && (
                <div className="mt-3 space-y-4">
                  <Field
                    label="용어 교정 규칙"
                    help="자주 잘못 알아듣는 단어를 자동으로 고쳐줘요. 한 줄에 하나씩 '잘못 나온 말 = 올바른 표기' 형태로 적어주세요. 예: 비채 = 부채"
                  >
                    <textarea
                      value={repText}
                      onChange={(e) => setRepText(e.target.value)}
                      rows={4}
                      placeholder={'단기순이익 = 당기순이익\n비채 = 부채\n이연 법인세 = 이연법인세'}
                      className="w-full resize-none rounded-lg border border-black/10 px-3 py-2 font-mono text-[13px] outline-none focus:border-accent"
                    />
                  </Field>

                  <Field
                    label="수식 변환 규칙"
                    help="말로 읽은 수식을 기호로 자동으로 바꿔줘요. 한 줄에 하나씩 '읽는 법 = 기호' 형태로 적어주세요. 예: 케이 이 = K_e"
                  >
                    <textarea
                      value={ruleText}
                      onChange={(e) => setRuleText(e.target.value)}
                      rows={5}
                      placeholder={'케이 이 = K_e\n베타 유 = \\beta_u\n와카 = WACC'}
                      className="w-full resize-none rounded-lg border border-black/10 px-3 py-2 font-mono text-[13px] outline-none focus:border-accent"
                    />
                  </Field>

                  <div>
                    <label className="flex cursor-pointer items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={!!draft.selfImprove}
                        onChange={(e) => setDraft({ ...draft, selfImprove: e.target.checked })}
                        className="mt-0.5 h-4 w-4 accent-accent"
                      />
                      <span>
                        <span className="text-[13px] font-medium">에이전트 자기 개선</span>
                        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-subtle">
                          일괄·실시간 교정에서 같은 교정을 2번 이상 하면 용어/수식 규칙에 자동 반영해요. 아래에서 검토·수정·되돌릴 수 있어요.
                        </span>
                      </span>
                    </label>

                    {autoRules.length > 0 && (
                      <div className="mt-3 rounded-lg border border-black/10 bg-black/[0.015] p-2">
                        <p className="mb-1.5 px-1 text-[11px] font-semibold text-subtle">자동 학습된 규칙 {autoRules.length}</p>
                        <div className="max-h-32 space-y-0.5 overflow-y-auto">
                          {autoRules.map((r) => (
                            <div key={`${r.kind}:${r.from}`} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-black/5">
                              <span className="rounded bg-black/[0.06] px-1 text-[10px] text-subtle">{r.kind === 'math' ? '수식' : '용어'}</span>
                              <span className="flex min-w-0 flex-1 items-center gap-1 font-mono text-[12px]">
                                <span className="max-w-[40%] shrink-0 truncate text-subtle">{r.from}</span>
                                <span className="shrink-0 text-subtle">→</span>
                                <input
                                  key={`${r.kind}:${r.from}:${r.to}`}
                                  defaultValue={r.to}
                                  title="교정 결과를 직접 수정 (Enter 또는 포커스 해제 시 저장)"
                                  onKeyDown={(e) => {
                                    if (e.nativeEvent.isComposing || e.keyCode === 229) return
                                    if (e.key === 'Enter') {
                                      e.preventDefault()
                                      ;(e.target as HTMLInputElement).blur()
                                    }
                                  }}
                                  onBlur={(e) => void editAutoRule(r, e.target.value)}
                                  className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-ink hover:border-black/10 focus:border-accent focus:bg-white focus:outline-none"
                                />
                              </span>
                              <button
                                onClick={() => void undoAutoRule(r)}
                                title="이 규칙 되돌리기"
                                className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-subtle hover:bg-black/5 hover:text-ink"
                              >
                                <RotateCcw size={11} /> 되돌리기
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-black/5 px-5 py-3">
            <button
              onClick={remove}
              disabled={typeof selectedId !== 'number'}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[13px] text-red-500 hover:bg-red-50 disabled:opacity-40"
            >
              <Trash2 size={14} /> 삭제
            </button>
            <button onClick={save} className="rounded-lg bg-accent px-4 py-1.5 text-[13px] font-medium text-white hover:bg-accent/90">
              저장
            </button>
          </div>
        </div>
      </div>
    </div>

    {/* AI generation popup (separate dialog) */}
    {genOpen && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onMouseDown={closeGen}>
        <div className="w-[460px] rounded-2xl bg-white p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
          <div className="mb-1 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[15px] font-semibold">
              <Sparkles size={16} className="text-accent" /> AI로 에이전트 생성
            </span>
            <button onClick={closeGen} className="rounded p-1 text-subtle hover:bg-black/5">
              <X size={18} />
            </button>
          </div>
          <p className="mb-3 text-[12px] leading-relaxed text-subtle">과목·목적을 알려주면 키워드(100+)·수식·용어·프롬프트를 자동 생성해요. (검토 후 저장)</p>
          <div className="space-y-3">
            <Field label="에이전트 이름">
              <input
                value={genName}
                onChange={(e) => setGenName(e.target.value)}
                placeholder="예: 재무관리 (비우면 자동 생성)"
                className="w-full rounded-lg border border-black/10 px-3 py-2 text-[14px] outline-none focus:border-accent"
              />
            </Field>
            <Field label="과목">
              <input
                value={genSubject}
                onChange={(e) => setGenSubject(e.target.value)}
                placeholder="예: 공인회계사 2차 재무관리"
                className="w-full rounded-lg border border-black/10 px-3 py-2 text-[14px] outline-none focus:border-accent"
              />
            </Field>
            <Field label="목적">
              <input
                value={genPurpose}
                onChange={(e) => setGenPurpose(e.target.value)}
                placeholder="예: 시험 대비 강의 전사·요약"
                className="w-full rounded-lg border border-black/10 px-3 py-2 text-[14px] outline-none focus:border-accent"
              />
            </Field>
            <Field label="기타 참고사항">
              <textarea
                value={genNotes}
                onChange={(e) => setGenNotes(e.target.value)}
                rows={2}
                placeholder="예: 자본구조·CAPM·옵션가격결정 중심, 교수 표기 선호 등"
                className="w-full resize-none rounded-lg border border-black/10 px-3 py-2 text-[13px] outline-none focus:border-accent"
              />
            </Field>
            <Field label="참고 교재 (PDF · 여러 개 가능)">
              <div className="space-y-1.5">
                {genPdfs.map((p, i) => (
                  <div key={p.path} className="flex min-w-0 items-center gap-1.5 rounded-lg border border-black/10 px-2.5 py-1.5 text-[12px]">
                    <FileText size={13} className="shrink-0 text-accent" />
                    <span className="min-w-0 flex-1 truncate" title={p.name}>{p.name}</span>
                    <button
                      onClick={() => setGenPdfs((prev) => prev.filter((_, j) => j !== i))}
                      className="shrink-0 text-subtle hover:text-ink"
                      title="첨부 해제"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={async () => {
                    const r = await window.api.pdfs.choose()
                    if (r.length) setGenPdfs((prev) => [...prev, ...r.filter((n) => !prev.some((e) => e.path === n.path))])
                  }}
                  className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-black/15 px-3 py-2 text-[12px] text-subtle hover:bg-black/[0.02]"
                >
                  <Plus size={13} /> {genPdfs.length ? '교재 PDF 더 추가' : '교재 PDF 첨부 (선택)'}
                </button>
              </div>
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={closeGen} className="rounded-lg px-3 py-1.5 text-[13px] text-subtle hover:bg-black/5">
              취소
            </button>
            <button
              onClick={() => void generate()}
              disabled={genLoading || !genSubject.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-[13px] font-medium text-white hover:bg-accent/90 disabled:opacity-40"
            >
              {genLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} 생성
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1">
        <label className="block text-[12px] font-medium text-subtle">{label}</label>
        {help && <HelpTip text={help} />}
      </div>
      {children}
    </div>
  )
}
