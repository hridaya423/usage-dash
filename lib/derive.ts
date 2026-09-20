import type {
  DailyRow,
  ModelBreakdown,
  SessionRow,
  UnifiedPayload,
} from "@/lib/ccusage-types"
import type { DitherColor } from "@/components/dither-kit/palette"
import { cachedReadDiscount } from "@/lib/pricing"
export type Metric = "cost" | "tokens"
export type RangeKey = "24h" | "7d" | "30d" | "90d"
export type Grain = "daily" | "weekly" | "monthly"
export type BreakdownView = "model" | "day"
export function grainForRange(range: RangeKey): Grain {
  if (range === "90d") return "weekly"
  return "daily"
}
const AGENT_COLORS: Record<string, DitherColor> = {
  codex: "grey",
  claude: "orange",
  droid: "blue",
  amp: "purple",
  opencode: "green",
  pi: "pink",
}
const FALLBACK_COLORS: readonly DitherColor[] = ["red", "blue", "green", "purple", "pink"]
export function agentColor(agent: string): DitherColor {
  const known = AGENT_COLORS[agent]
  if (known) return known
  let hash = 0
  for (let i = 0; i < agent.length; i++) hash = (hash * 31 + agent.charCodeAt(i)) | 0
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length]
}
function titleCase(raw: string): string {
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}
function sessionsInRange(
  sessions: SessionRow[],
  start: string | null,
  end: string | null
): { total: number; perAgent: Map<string, number> } {
  const perAgent = new Map<string, number>()
  if (!start || !end) return { total: 0, perAgent }
  let total = 0
  for (const session of sessions) {
    const last = session.metadata?.lastActivity
    if (!last) continue
    const day = last.slice(0, 10)
    if (day < start || day > end) continue
    total += 1
    perAgent.set(session.agent, (perAgent.get(session.agent) ?? 0) + 1)
  }
  return { total, perAgent }
}
export interface AgentSummary {
  agent: string
  label: string
  color: DitherColor
  cost: number
  tokens: number
  sessions: number
}
export interface Totals {
  processedTokens: number
  cachedInput: number
  uncachedInput: number
  outputTokens: number
  cacheSavingsUSD: number
  totalCost: number
}
export interface BreakdownRow {
  key: string
  label: string
  cost: number
  tokens: number
  share: number
}
export interface Dashboard {
  days: DailyRow[]
  rangeDays: DailyRow[]
  rangeLabel: string
  totalCost: number
  totalTokens: number
  sessionCount: number
  agents: AgentSummary[]
  totals: Totals
  modelRows: BreakdownRow[]
  dayRows: BreakdownRow[]
}
const DAY_MS = 86_400_000
function todayISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}
function addDaysISO(iso: string, deltaDays: number): string {
  const at = new Date(`${iso}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + deltaDays)
  return at.toISOString().slice(0, 10)
}
function emptyDay(period: string): DailyRow {
  return {
    period,
    agent: "all",
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    modelsUsed: [],
    modelBreakdowns: [],
  }
}
export function buildDayAxis(days: DailyRow[], minSpan: number): DailyRow[] {
  if (days.length === 0) return []
  const sorted = [...days].sort((a, b) => a.period.localeCompare(b.period))
  let first = sorted[0].period
  const last = sorted[sorted.length - 1].period
  const span = Math.round(
    (new Date(`${last}T00:00:00Z`).getTime() - new Date(`${first}T00:00:00Z`).getTime()) / DAY_MS
  ) + 1
  if (span < minSpan) first = addDaysISO(last, -(minSpan - 1))
  const byPeriod = new Map(sorted.map((row) => [row.period, row]))
  const axis: DailyRow[] = []
  let cursor = first
  while (cursor <= last && axis.length < 400) {
    axis.push(byPeriod.get(cursor) ?? emptyDay(cursor))
    cursor = addDaysISO(cursor, 1)
  }
  return axis
}
const RANGE_SPAN: Record<RangeKey, number> = { "24h": 7, "7d": 7, "30d": 30, "90d": 90 }
export function sliceRange(axis: DailyRow[], range: RangeKey): DailyRow[] {
  if (range === "24h") return axis.slice(-1)
  return axis.slice(-RANGE_SPAN[range])
}
export function rowsForRange(payload: UnifiedPayload, range: RangeKey): DailyRow[] {
  if (range === "90d") {
    const weekly = [...(payload.weekly ?? [])].sort((a, b) =>
      a.period.localeCompare(b.period)
    )
    return weekly.slice(-13).map((row) => ({ ...row, agent: "all" }))
  }
  const axis = buildDayAxis(payload.daily ?? [], RANGE_SPAN[range])
  return sliceRange(axis, range)
}
export function rangeLabelFor(range: RangeKey, rows: DailyRow[]): string {
  if (rows.length === 0) return ""
  const fmt = (iso: string) => {
    const at = new Date(`${iso.slice(0, 10)}T00:00:00`)
    if (Number.isNaN(at.getTime())) return iso
    return `${at.toLocaleString("en-US", { month: "short" })} ${at.getDate()}`
  }
  if (range === "24h") return fmt(rows[rows.length - 1].period)
  if (range === "90d") {
    const start = new Date(`${rows[0].period.slice(0, 10)}T00:00:00Z`)
    const lastStart = new Date(
      `${rows[rows.length - 1].period.slice(0, 10)}T00:00:00Z`
    )
    lastStart.setUTCDate(lastStart.getUTCDate() + 6)
    return `${fmt(start.toISOString().slice(0, 10))} to ${fmt(lastStart.toISOString().slice(0, 10))}`
  }
  return `${fmt(rows[0].period)} to ${fmt(rows[rows.length - 1].period)}`
}
function collectAgentSplits(row: DailyRow, into: Map<string, AgentSummary>): void {  for (const split of row.agents ?? []) {
    const prev = into.get(split.agent)
    if (prev) {
      prev.cost += split.totalCost
      prev.tokens += split.totalTokens
      prev.sessions += 1
    } else {
      into.set(split.agent, {
        agent: split.agent,
        label: titleCase(split.agent),
        color: agentColor(split.agent),
        cost: split.totalCost,
        tokens: split.totalTokens,
        sessions: 1,
      })
    }
  }
}
export function deriveDashboard(
  payload: UnifiedPayload,
  range: RangeKey
): Dashboard {
  const rangeDays = rowsForRange(payload, range)
  const days = buildDayAxis(payload.daily ?? [], RANGE_SPAN[range])
  const agents = new Map<string, AgentSummary>()
  let totalCost = 0
  let processedTokens = 0
  let cachedInput = 0
  let uncachedInput = 0
  let outputTokens = 0
  let cacheSavingsUSD = 0
  const models = new Map<string, ModelBreakdown>()
  for (const row of rangeDays) {
    totalCost += row.totalCost
    processedTokens += row.totalTokens
    uncachedInput += row.inputTokens
    cachedInput += row.cacheReadTokens + row.cacheCreationTokens
    outputTokens += row.outputTokens
    for (const breakdown of row.modelBreakdowns) {
      cacheSavingsUSD += breakdown.cacheReadTokens * cachedReadDiscount(breakdown.modelName) / 1e6
      const prev = models.get(breakdown.modelName)
      if (prev) {
        prev.inputTokens += breakdown.inputTokens
        prev.outputTokens += breakdown.outputTokens
        prev.cacheCreationTokens += breakdown.cacheCreationTokens
        prev.cacheReadTokens += breakdown.cacheReadTokens
        prev.totalTokens += breakdown.totalTokens
        prev.cost += breakdown.cost
      } else {
        models.set(breakdown.modelName, { ...breakdown })
      }
    }
    collectAgentSplits(row, agents)
  }
  const agentList = [...agents.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
  const rangeStart = rangeDays.length > 0 ? rangeDays[0].period : null
  let rangeEnd = rangeDays.length > 0 ? rangeDays[rangeDays.length - 1].period : null
  if (range === "90d" && rangeEnd) rangeEnd = addDaysISO(rangeEnd, 6)
  const { total: sessionCount, perAgent: sessionsPerAgent } = sessionsInRange(
    payload.session ?? [],
    rangeStart,
    rangeEnd
  )
  for (const agent of agentList) {
    agent.sessions = sessionsPerAgent.get(agent.agent) ?? 0
  }
  const modelRows: BreakdownRow[] = [...models.values()]
    .map((m) => {
      const tokens =
        m.totalTokens > 0
          ? m.totalTokens
          : m.inputTokens + m.outputTokens + m.cacheCreationTokens + m.cacheReadTokens
      return {
        key: m.modelName,
        label: m.modelName,
        cost: m.cost,
        tokens,
        share: 0,
      }
    })
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
  const dayRows: BreakdownRow[] = rangeDays
    .map((row) => ({
      key: row.period,
      label: row.period,
      cost: row.totalCost,
      tokens: row.totalTokens,
      share: 0,
    }))
    .sort((a, b) => b.label.localeCompare(a.label))
  for (const list of [modelRows, dayRows]) {
    for (const row of list) {
      row.share = totalCost > 0 ? (row.cost / totalCost) * 100 : 0
    }
  }
  return {
    days,
    rangeDays,
    rangeLabel: rangeLabelFor(range, rangeDays),
    totalCost,
    totalTokens: processedTokens,
    sessionCount,
    agents: agentList,
    totals: {
      processedTokens,
      cachedInput,
      uncachedInput,
      outputTokens,
      cacheSavingsUSD,
      totalCost,
    },
    modelRows,
    dayRows,
  }
}
