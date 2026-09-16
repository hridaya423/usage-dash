const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]
export function shortDay(iso: string): string {
  const parts = iso.split("-")
  const month = Number(parts[1])
  const day = Number(parts[2])
  if (!month || !day) return iso
  return `${MONTHS[month - 1]} ${day}`
}
function trimOneDecimal(value: number): string {
  const fixed = value.toFixed(1)
  return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed
}
export function formatCompactTokens(tokens: number): string {
  if (tokens >= 1e9) return `${trimOneDecimal(tokens / 1e9)}B`
  if (tokens >= 1e6) return `${trimOneDecimal(tokens / 1e6)}M`
  if (tokens >= 1e3) return `${trimOneDecimal(tokens / 1e3)}K`
  return String(Math.round(tokens))
}
export function formatMoney(amount: number): string {
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}
export function formatPct(share: number): string {
  return `${share.toFixed(1)}%`
}
export function formatClock(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ""
  const hh = String(at.getHours()).padStart(2, "0")
  const mm = String(at.getMinutes()).padStart(2, "0")
  return `${hh}:${mm}`
}
