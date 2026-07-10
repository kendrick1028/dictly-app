// Pure helpers for the Feynman review feature: score-tail parsing, weighted-average
// scoring, and weak-area summarization for "복습하기" (review) rounds.
import type { FeynmanAnswer, FeynmanQuestion, FeynmanRound } from '../../../shared/types'
import { stripCiteTokens } from './citations'

/** Construct a fresh active round (shared by the background job + in-session review rounds). */
export function makeRound(index: number, questions: FeynmanRound['questions'], focus?: string): FeynmanRound {
  return {
    index,
    questions,
    answers: [],
    finalScore: null,
    status: 'active',
    createdAt: Date.now(),
    ...(focus ? { focus } : {})
  }
}

const SCORE_RE = /\[\[SCORE:\s*(-?\d+(?:\.\d+)?)\s*\]\]/gi

/**
 * Split a graded reply into the visible feedback body and the numeric score.
 * The grader appends `[[SCORE:n]]` on the last line; we strip every occurrence
 * (streaming may briefly show a partial token) and take the last complete one.
 */
export function parseScoreTail(text: string): { body: string; score: number | null } {
  let score: number | null = null
  let m: RegExpExecArray | null
  SCORE_RE.lastIndex = 0
  while ((m = SCORE_RE.exec(text))) {
    const n = Number(m[1])
    if (Number.isFinite(n)) score = Math.min(100, Math.max(0, Math.round(n)))
  }
  // remove the complete token + any trailing partial like "[[SCO" left mid-stream
  const body = text
    .replace(SCORE_RE, '')
    .replace(/\[\[\s*S?C?O?R?E?:?\s*\d*\s*$/i, '')
    .trimEnd()
  return { body, score }
}

/** weighted average over ANSWERED questions: Σ(score·weight)/Σweight, weight defaults to 1 */
export function weightedScore(answers: FeynmanAnswer[], questions: FeynmanQuestion[]): number {
  let num = 0
  let den = 0
  for (let i = 0; i < answers.length; i++) {
    const w = Math.max(1, questions[i]?.weight ?? 1)
    num += answers[i].score * w
    den += w
  }
  return den === 0 ? 0 : Math.round(num / den)
}

/**
 * Build a weak-area summary string to seed a review round — questions the user
 * scored below `threshold`, with the question text + the grader's feedback so the
 * next round can re-ask those concepts more deeply.
 */
export function buildFocusSummary(round: FeynmanRound, threshold = 70): string {
  const weak: string[] = []
  for (let i = 0; i < round.answers.length; i++) {
    const a = round.answers[i]
    if (a.score >= threshold) continue
    const q = round.questions[i]
    if (!q) continue
    const fb = stripCiteTokens(a.feedback).replace(/\s+/g, ' ').trim().slice(0, 400)
    weak.push(`- (${a.score}점) 질문: ${stripCiteTokens(q.question).trim()}\n  당시 피드백: ${fb}`)
  }
  return weak.join('\n')
}

/** are there any weak answers worth reviewing? (drives the 복습하기 button enabled state) */
export function hasWeakAnswers(round: FeynmanRound, threshold = 70): boolean {
  return round.answers.some((a) => a.score < threshold)
}
