export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

export function fmtRange(a: number, b: number): string {
  return `${fmtClock(a)} - ${fmtClock(b)}`
}

/** relative timestamp for list rows: 방금 전 / N분 전 / N시간 전 / N일 전 / M월 D일 */
export function fmtRelative(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '방금 전'
  if (min < 60) return `${min}분 전`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}시간 전`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}일 전`
  const d = new Date(ts)
  return `${d.getMonth() + 1}월 ${d.getDate()}일`
}
