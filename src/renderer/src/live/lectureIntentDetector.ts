// "쉬는 시간 / 오늘은 여기까지" detector → cancellable countdown → pause / stop (/ auto-resume).
//
//   final chunk ─▶ rule gate (intentRules) ─▶ [hit] AI classifier (last 3 chunks) ─▶ countdown toast
//                                                  └ no AI: act on STRONG rule hits only
//
// Guards: nothing in the first 60 s of a recording; never from `partial` text; one pending action
// at a time; 5-minute cooldown after the user cancels; the toast disappearing early = cancel.
import { createElement } from 'react'
import { useStore } from '../store/useStore'
import { toast, toastStore } from '../lib/toastStore'
import { pauseRecording, resumeRecording, stopRecording } from '../audio/recorderController'
import { detectAnnouncement, type IntentKind } from './intentRules'
import { INTENT_INSTRUCTION, intentContent, parseJsonObject } from './livePrompts'
import { CountdownToast } from '../components/live/CountdownToast'

export const WARMUP_MS = 60_000
export const BREAK_COUNTDOWN_S = 5
export const END_COUNTDOWN_S = 10
export const CANCEL_COOLDOWN_MS = 5 * 60_000
export const AI_MIN_CONFIDENCE = 0.75
export const RESUME_GRACE_MIN = 1

export class LectureIntentDetector {
  private startedAt = Date.now()
  private stopped = false
  private busy = false
  private cooldownUntil = 0
  private countdown: { timer: number; toastId: number; kind: 'break' | 'end' } | null = null
  private resumeTimer: number | null = null
  private resumeToastId: number | null = null

  constructor(readonly memoId: number) {}

  onFinalSegment(idx: number): void {
    if (this.stopped || this.busy || this.countdown) return
    const st = useStore.getState()
    if (!st.lectureIntent.on) return
    if (Date.now() - this.startedAt < WARMUP_MS) return
    if (Date.now() < this.cooldownUntil) return
    const segs = st.rec.liveSegments
    const chunk = segs[idx]?.text ?? ''
    const hit = detectAnnouncement(chunk)
    if (hit.kind === 'none') return

    const ruleKind: 'break' | 'end' = hit.kind
    if (!st.aiReady) {
      if (hit.strength === 'strong') this.arm(ruleKind, hit.phrase, hit.minutes)
      return
    }
    // AI confirmation on the last few chunks (they are usually corrected by now)
    this.busy = true
    const recent = segs.slice(Math.max(0, idx - 2), idx + 1).map((s) => s.text)
    const sid = `intent_${Date.now()}`
    void window.api.ai
      .ask(sid, INTENT_INSTRUCTION, intentContent(recent), '', undefined, () => {})
      .then((raw) => {
        if (this.stopped) return
        const j = parseJsonObject<{ intent?: string; confidence?: number; minutes?: number | null }>(raw)
        const kind: IntentKind = j?.intent === 'break' || j?.intent === 'end' ? j.intent : 'none'
        const conf = Number(j?.confidence ?? 0)
        if (kind !== 'none' && conf >= AI_MIN_CONFIDENCE) {
          const minutes = typeof j?.minutes === 'number' && j.minutes > 0 ? Math.round(j.minutes) : hit.minutes
          this.arm(kind, hit.phrase, minutes)
        }
      })
      .catch(() => {
        // AI unavailable → strong rule alone
        if (!this.stopped && hit.strength === 'strong') this.arm(ruleKind, hit.phrase, hit.minutes)
      })
      .finally(() => {
        this.busy = false
      })
  }

  /** start the cancellable countdown */
  private arm(kind: 'break' | 'end', phrase: string, minutes: number | null): void {
    if (this.stopped || this.countdown) return
    const st = useStore.getState()
    if (kind === 'end' && st.lectureIntent.endAction === 'suggest') {
      // suggestion only — a persistent toast with a stop button, nothing automatic
      toast.warning(`수업 종료로 감지했어요 ("${phrase}")`, {
        preserve: true,
        action: '녹음 종료',
        onAction: () => void stopRecording()
      })
      this.cooldownUntil = Date.now() + CANCEL_COOLDOWN_MS
      return
    }
    const seconds = kind === 'break' ? BREAK_COUNTDOWN_S : END_COUNTDOWN_S
    const endsAt = Date.now() + seconds * 1000
    const toastId = toast.warning(createElement(CountdownToast, { kind, phrase, seconds, endsAt }), {
      preserve: true,
      action: '취소',
      onAction: () => this.cancel()
    })
    const timer = window.setTimeout(() => this.fire(), seconds * 1000)
    this.countdown = { timer, toastId, kind }
    st.setLectureIntent({ pending: { kind, minutes, toastId } })
  }

  private cancel(): void {
    if (!this.countdown) return
    window.clearTimeout(this.countdown.timer)
    toast.dismiss(this.countdown.toastId)
    this.countdown = null
    this.cooldownUntil = Date.now() + CANCEL_COOLDOWN_MS
    useStore.getState().setLectureIntent({ pending: null })
  }

  private fire(): void {
    const cd = this.countdown
    if (!cd || this.stopped) return
    this.countdown = null
    const st = useStore.getState()
    const pending = st.lectureIntent.pending
    st.setLectureIntent({ pending: null })
    // the toast was closed with "닫기" (no onAction) → treat as cancel
    const stillShown = toastStore.toasts.some((t) => t.id === cd.toastId)
    toast.dismiss(cd.toastId)
    if (!stillShown) {
      this.cooldownUntil = Date.now() + CANCEL_COOLDOWN_MS
      return
    }
    if (cd.kind === 'end') {
      void stopRecording()
      return
    }
    // break → pause (+ auto-resume when a length was announced)
    pauseRecording()
    this.cooldownUntil = Date.now() + CANCEL_COOLDOWN_MS
    const minutes = pending?.minutes ?? null
    if (minutes) this.scheduleResume(minutes + RESUME_GRACE_MIN)
    else {
      this.resumeToastId = toast.message('쉬는 시간 — 녹음 일시정지 중', { preserve: true, action: '지금 재개', onAction: () => this.resumeNow() })
    }
  }

  private scheduleResume(minutes: number): void {
    this.clearResume()
    const at = Date.now() + minutes * 60_000
    useStore.getState().setLectureIntent({ resumeAt: at })
    this.resumeToastId = toast.message(`쉬는 시간 — ${minutes}분 뒤 자동으로 녹음을 재개해요`, {
      preserve: true,
      action: '지금 재개',
      onAction: () => this.resumeNow()
    })
    this.resumeTimer = window.setTimeout(() => {
      this.resumeTimer = null
      if (this.stopped) return
      const st = useStore.getState()
      if (!st.rec.isRecording || !st.rec.paused) return // user already resumed / stopped
      if (this.resumeToastId != null) toast.dismiss(this.resumeToastId)
      this.resumeToastId = toast.message('쉬는 시간 끝 — 녹음을 다시 시작했어요', { duration: 6000, action: '5분 더 쉬기', onAction: () => this.extendBreak(5) })
      st.setLectureIntent({ resumeAt: null })
      resumeRecording()
    }, minutes * 60_000)
  }

  private extendBreak(minutes: number): void {
    const st = useStore.getState()
    if (!st.rec.isRecording) return
    if (!st.rec.paused) pauseRecording()
    this.scheduleResume(minutes)
  }

  private resumeNow(): void {
    this.clearResume()
    const st = useStore.getState()
    if (st.rec.isRecording && st.rec.paused) resumeRecording()
  }

  private clearResume(): void {
    if (this.resumeTimer != null) {
      window.clearTimeout(this.resumeTimer)
      this.resumeTimer = null
    }
    if (this.resumeToastId != null) {
      toast.dismiss(this.resumeToastId)
      this.resumeToastId = null
    }
    useStore.getState().setLectureIntent({ resumeAt: null })
  }

  /** user pressed ▶ themselves while a break was scheduled */
  onManualResume(): void {
    this.clearResume()
  }

  stop(): void {
    this.stopped = true
    if (this.countdown) {
      window.clearTimeout(this.countdown.timer)
      toast.dismiss(this.countdown.toastId)
      this.countdown = null
    }
    this.clearResume()
    useStore.getState().setLectureIntent({ pending: null, resumeAt: null })
  }
}
