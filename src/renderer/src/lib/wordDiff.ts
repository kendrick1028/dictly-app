// Extract clean 1:1 word substitutions (old → new) between two strings via LCS alignment.
// Used by agent self-improvement to learn from live AI corrections: only single-word swaps
// flanked by unchanged words count, so multi-word rewrites / noise are ignored. The repeat
// threshold downstream further filters one-offs.
export function wordSubs(from: string, to: string): { from: string; to: string }[] {
  const a = from.trim().split(/\s+/).filter(Boolean)
  const b = to.trim().split(/\s+/).filter(Boolean)
  const m = a.length
  const n = b.length
  if (!m || !n || m > 200 || n > 200) return []

  // LCS length table (suffix form)
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])

  const subs: { from: string; to: string }[] = []
  const del: string[] = []
  const ins: string[] = []
  const flush = (): void => {
    if (del.length === 1 && ins.length === 1) subs.push({ from: del[0], to: ins[0] })
    del.length = 0
    ins.length = 0
  }
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      flush()
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      del.push(a[i++])
    } else {
      ins.push(b[j++])
    }
  }
  while (i < m) del.push(a[i++])
  while (j < n) ins.push(b[j++])
  flush()

  return subs.filter((s) => s.from !== s.to && s.from.length >= 2 && /[가-힣A-Za-z]/.test(s.from))
}
