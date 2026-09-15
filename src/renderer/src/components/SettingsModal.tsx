import { useEffect, useState } from 'react'
import { FolderOpen, X, Pencil, RotateCcw, AlertTriangle, Check, Keyboard, ChevronRight, Sparkles } from 'lucide-react'
import { useStore } from '../store/useStore'
import { HelpTip } from './HelpTip'
import { ACCENT_THEMES } from '../lib/theme'
import { comboFromEvent, formatShortcut } from '../lib/shortcut'
import { NotionSettings } from './NotionSettings'

/** Click → press a key combo to rebind a shortcut. Captures before app-level shortcuts fire. */
function ShortcutCapture({ value, onChange }: { value: string; onChange: (s: string) => void }): JSX.Element {
  const [listening, setListening] = useState(false)
  useEffect(() => {
    if (!listening) return
    const h = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setListening(false)
        return
      }
      // require at least one modifier — a bare key would hijack normal typing app-wide
      if (!(e.metaKey || e.ctrlKey || e.altKey || e.shiftKey)) return
      const combo = comboFromEvent(e)
      if (combo) {
        onChange(combo)
        setListening(false)
      }
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [listening, onChange])
  return (
    <button
      onClick={() => setListening(true)}
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] transition ${
        listening ? 'border-accent bg-accent/10 text-accent' : 'border-black/10 bg-white text-ink hover:bg-black/5'
      }`}
    >
      <Keyboard size={14} className="text-subtle" />
      {listening ? '키 조합을 누르세요… (Esc 취소)' : <span className="font-mono">{formatShortcut(value)}</span>}
    </button>
  )
}

// safe ranges for the VAD knobs
const SIL = { min: 0.4, max: 3.0, lo: 0.8, hi: 2.0, step: 0.1 }
// Whisper encodes a fixed 30s window per chunk, so SHORT max-chunk values waste most of it
// and multiply the encoder passes → transcription falls behind on long recordings. Recommend
// 16–28s so each chunk fills the window efficiently (the live preview covers the latency).
const MAX = { min: 12, max: 40, lo: 16, hi: 28, step: 1 }

function VadSlider({
  label,
  help,
  value,
  onChange,
  cfg,
  unit,
  warnLow,
  warnHigh
}: {
  label: string
  help?: string
  value: number
  onChange: (v: number) => void
  cfg: { min: number; max: number; lo: number; hi: number; step: number }
  unit: string
  warnLow: string
  warnHigh: string
}): JSX.Element {
  const warn = value < cfg.lo ? warnLow : value > cfg.hi ? warnHigh : null
  const pct = (x: number): number => ((x - cfg.min) / (cfg.max - cfg.min)) * 100
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <label className="text-[12px] font-medium text-subtle">{label}</label>
          {help && <HelpTip text={help} />}
        </div>
        <span className="font-mono text-[12px] text-ink">
          {value}
          {unit}
        </span>
      </div>
      {/* track with a green "safe range" band */}
      <div className="relative">
        <div className="pointer-events-none absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-black/10" />
        <div
          className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent/30"
          style={{ left: `${pct(cfg.lo)}%`, right: `${100 - pct(cfg.hi)}%` }}
        />
        <input
          type="range"
          min={cfg.min}
          max={cfg.max}
          step={cfg.step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="relative w-full accent-accent"
        />
      </div>
      <div className="mt-0.5 text-[11px] text-subtle">
        권장 {cfg.lo}–{cfg.hi}
        {unit}
      </div>
      {warn && (
        <div className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-700">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>{warn}</span>
        </div>
      )}
    </div>
  )
}

export function SettingsModal(): JSX.Element | null {
  const { settingsOpen, setSettingsOpen, accentTheme, setAccentTheme, noteLineSpacing, setNoteLineSpacing, spotlightShortcut, setSpotlightShortcut, openWhatsNew, appVersion } =
    useStore()
  const [dir, setDir] = useState('')
  const [silenceSec, setSilenceSec] = useState(1.3)
  const [maxSec, setMaxSec] = useState(18)
  const [vadOpen, setVadOpen] = useState(false) // advanced VAD tuning is collapsed by default

  useEffect(() => {
    if (!settingsOpen) return
    window.api.settings.recordingsDir().then(setDir)
    window.api.settings.getVad().then((v) => {
      setSilenceSec(v.silenceSec)
      setMaxSec(v.maxSec)
    })
  }, [settingsOpen])

  if (!settingsOpen) return null

  const choose = async (): Promise<void> => setDir(await window.api.settings.chooseRecordingsDir())
  const reset = async (): Promise<void> => setDir(await window.api.settings.resetRecordingsDir())
  const saveVad = (sil: number, mx: number): void => {
    setSilenceSec(sil)
    setMaxSec(mx)
    window.api.settings.setVad(sil, mx)
  }

  return (
    <div className="dictly-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/30" onMouseDown={() => setSettingsOpen(false)}>
      <div className="dictly-modal-in max-h-[80vh] w-[560px] overflow-y-auto rounded-2xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-black/5 bg-white px-5 py-3">
          <span className="text-[14px] font-semibold">설정</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setSettingsOpen(false)
                openWhatsNew()
              }}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] text-subtle hover:bg-black/5 hover:text-ink"
              title="이 버전의 새 기능 소개를 다시 봐요"
            >
              <Sparkles size={13} /> v{appVersion || '…'} 새 기능
            </button>
            <button onClick={() => setSettingsOpen(false)} className="rounded p-1 text-subtle hover:bg-black/5">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="space-y-5 px-5 py-4">
          {/* recordings location */}
          <div>
            <div className="mb-1 flex items-center gap-1">
              <label className="block text-[12px] font-medium text-subtle">녹음 파일 저장 위치</label>
              <HelpTip text="녹음하는 동안 음성 파일이 이 폴더에 자동으로, 끊김 없이 계속 저장돼요." />
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 truncate rounded-lg border border-black/10 bg-black/[0.02] px-3 py-2 font-mono text-[12px]" title={dir}>
                {dir || '…'}
              </div>
              <button onClick={choose} className="flex items-center gap-1 rounded-lg border border-black/10 bg-white px-2.5 py-2 text-[12px] hover:bg-black/5">
                <Pencil size={13} /> 변경
              </button>
              <button
                onClick={() => window.api.settings.openRecordingsDir()}
                className="flex items-center gap-1 rounded-lg border border-black/10 bg-white px-2.5 py-2 text-[12px] hover:bg-black/5"
              >
                <FolderOpen size={13} /> 열기
              </button>
              <button onClick={reset} title="기본 위치로" className="rounded-lg border border-black/10 bg-white p-2 text-subtle hover:bg-black/5">
                <RotateCcw size={13} />
              </button>
            </div>
          </div>

          {/* accent color theme */}
          <div className="border-t border-black/5 pt-4">
            <div className="mb-2 flex items-center gap-1">
              <span className="text-[13px] font-semibold">색상 테마</span>
              <HelpTip text="앱 강조색(버튼·하이라이트·활성 표시)에 적용돼요. 기본은 네이비예요." />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {ACCENT_THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setAccentTheme(t.id)}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[12px] transition ${
                    accentTheme === t.id ? 'border-accent bg-accent/10 text-ink' : 'border-black/10 bg-white text-subtle hover:bg-black/5'
                  }`}
                >
                  <span className="h-4 w-4 shrink-0 rounded-full ring-1 ring-black/10" style={{ background: t.swatch }} />
                  {t.label}
                  {accentTheme === t.id && <Check size={13} className="text-accent" />}
                </button>
              ))}
            </div>
          </div>

          {/* note editor line spacing */}
          <div className="border-t border-black/5 pt-4">
            <div className="mb-2 flex items-center gap-1">
              <span className="text-[13px] font-semibold">노트 줄간격</span>
              <HelpTip text="메모(필기) 에디터의 줄 간격이에요." />
              <span className="ml-auto text-[12px] tabular-nums text-subtle">{noteLineSpacing.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={1.2}
              max={2.4}
              step={0.05}
              value={noteLineSpacing}
              onChange={(e) => setNoteLineSpacing(Number(e.target.value))}
              className="w-full accent-accent"
            />
          </div>

          {/* spotlight search shortcut */}
          <div className="border-t border-black/5 pt-4">
            <div className="mb-2 flex items-center gap-1">
              <span className="text-[13px] font-semibold">검색 단축키</span>
              <HelpTip text="노트·강의·PDF를 한 번에 검색하고, 결과가 없으면 AI에게 바로 질문하는 통합 검색창을 여는 단축키예요." />
            </div>
            <div className="flex items-center gap-2">
              <ShortcutCapture value={spotlightShortcut} onChange={setSpotlightShortcut} />
              <button
                onClick={() => setSpotlightShortcut('Meta+Shift+KeyF')}
                title="기본값(⌘⇧F)으로"
                className="rounded-lg border border-black/10 bg-white p-2 text-subtle hover:bg-black/5"
              >
                <RotateCcw size={13} />
              </button>
            </div>
          </div>

          {/* Notion export destination */}
          <NotionSettings />

          {/* VAD tuning — advanced, collapsed by default */}
          <div className="border-t border-black/5 pt-4">
            <button onClick={() => setVadOpen((v) => !v)} className="flex w-full items-center gap-1 text-left text-[13px] font-semibold hover:text-accent">
              <ChevronRight size={14} className={`shrink-0 text-subtle transition ${vadOpen ? 'rotate-90' : ''}`} />
              음성 인식 구간 설정
              <span className="text-[11px] font-normal text-subtle">· 고급</span>
            </button>
          </div>
          {vadOpen && (
          <div className="space-y-4">
            <VadSlider
              label="문장 끊기"
              help="말을 멈추고 이만큼 조용해지면 한 문장으로 끊어서 전사해요. 짧게 두면 빨리 끊기고, 길게 두면 한 문장을 더 길게 모읍니다."
              value={silenceSec}
              onChange={(v) => saveVad(v, maxSec)}
              cfg={SIL}
              unit="초"
              warnLow="너무 짧으면 말 중간의 짧은 쉼에도 끊겨 문장이 잘게 쪼개져요."
              warnHigh="너무 길면 말을 멈춰도 한참 뒤에야 청크가 떠서 반응이 느려져요."
            />
            <VadSlider
              label="최대 청크 길이"
              help="쉬지 않고 계속 말할 때, 이 길이가 되면 한 번 끊어서 전사해요. 짧으면 전사가 느려질 수 있고(컴퓨터가 청크마다 큰 비용을 치름), 길수록 한 번에 더 많이 처리해서 빨라요. 그 사이는 실시간 미리보기가 채워줘요."
              value={maxSec}
              onChange={(v) => saveVad(silenceSec, v)}
              cfg={MAX}
              unit="초"
              warnLow="너무 짧으면 전사 속도가 크게 느려지고(청크마다 고정 비용) 단어가 잘려 깨질 수 있어요. 16초 이상 권장해요."
              warnHigh="너무 길면 첫 결과가 늦게 떠요(미리보기로 보완)."
            />
            <p className="text-[11px] text-subtle">변경값은 다음 녹음부터 적용돼요.</p>
          </div>
          )}
        </div>
      </div>
    </div>
  )
}
