// Text normalization for transcripts.
//
// 0.4.0: the rule-based spoken-Korean→KaTeX overlay was REMOVED. It only changed
// how text *looked* (the stored segment text was unchanged) and it mis-fired on
// ordinary particles — e.g. "여러분의 직장" rendered as a fraction. Spoken math is
// now converted for real by the AI live-correction pass (it edits the actual
// text and emits `$...$`), which the renderer shows via MarkdownMath. Anything
// already containing literal `$...$` still renders as math.
//
// What remains here is word-level recognition correction (오인식 → 올바른 표기),
// which fixes actual wrong words rather than faking display formatting.

/** Apply word-level auto-corrections (오인식 -> 올바른 표기), longest key first. */
export function applyReplacements(input: string, replacements: Record<string, string> = {}): string {
  if (!input) return input
  let text = input
  for (const [from, to] of Object.entries(replacements).sort((a, b) => b[0].length - a[0].length)) {
    if (from) text = text.split(from).join(to)
  }
  return text
}

/**
 * Normalize a segment for display/storage. Only word-level corrections are
 * applied now (no display-only math overlay). `_custom` (agent math rules) is
 * kept in the signature for call-site compatibility but intentionally unused.
 */
export function applyMathRules(
  input: string,
  _custom: Record<string, string> = {},
  replacements: Record<string, string> = {}
): string {
  return applyReplacements(input, replacements)
}

/** Convert an array of raw segment texts into a single editable markdown body. */
export function segmentsToMarkdown(
  segments: { text: string }[],
  _custom: Record<string, string> = {},
  replacements: Record<string, string> = {}
): string {
  return segments.map((s) => applyReplacements(s.text.trim(), replacements)).join('\n\n')
}
