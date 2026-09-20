import type {
  AgentSplit,
  DailyRow,
  ModelBreakdown,
  PeriodRow,
  SessionRow,
  UnifiedPayload,
} from "../lib/ccusage-types"
import { customModelCost } from "../lib/pricing"
type Source = string
interface TokenFields {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  totalTokens: number
}
function parseEnvelope(raw: string): UnifiedPayload | null {
  const start = raw.indexOf("{")
  if (start < 0) return null
  try {
    return JSON.parse(raw.slice(start)) as UnifiedPayload
  } catch {
    return null
  }
}
function parseDevin(raw: string): DailyRow[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as DailyRow[]) : []
  } catch {
    return []
  }
}
function addTokensInto(target: TokenFields, source: TokenFields): void {
  target.inputTokens += source.inputTokens
  target.outputTokens += source.outputTokens
  target.cacheCreationTokens += source.cacheCreationTokens
  target.cacheReadTokens += source.cacheReadTokens
  target.totalTokens += source.totalTokens
}
function adjustedBreakdownCost(breakdown: ModelBreakdown): number {
  return customModelCost(breakdown.modelName, breakdown) ?? breakdown.cost
}
function adjustedRowCost(row: { totalCost: number; modelBreakdowns: ModelBreakdown[] }): number {
  return row.totalCost + row.modelBreakdowns.reduce((total, breakdown) => {
    const custom = customModelCost(breakdown.modelName, breakdown)
    return custom === null ? total : total + custom - breakdown.cost
  }, 0)
}
function adjustedAgentCost(split: AgentSplit): number {
  if (split.modelBreakdowns.length === 0) return split.totalCost
  return split.modelBreakdowns.reduce((total, breakdown) => total + adjustedBreakdownCost(breakdown), 0)
}
function mergeAgentSplits(groups: AgentSplit[][]): AgentSplit[] {
  const byAgent = new Map<string, AgentSplit>()
  for (const list of groups) {
    for (const split of list) {
      const totalCost = adjustedAgentCost(split)
      const hit = byAgent.get(split.agent)
      if (hit) {
        addTokensInto(hit, split)
        hit.totalCost += totalCost
      } else {
        byAgent.set(split.agent, { ...split, totalCost })
      }
    }
  }
  return [...byAgent.values()]
}
function mergeBreakdowns(groups: ModelBreakdown[][]): ModelBreakdown[] {
  const byModel = new Map<string, ModelBreakdown>()
  for (const list of groups) {
    for (const breakdown of list) {
      const cost = adjustedBreakdownCost(breakdown)
      const hit = byModel.get(breakdown.modelName)
      if (hit) {
        addTokensInto(hit, breakdown)
        hit.cost += cost
      } else {
        byModel.set(breakdown.modelName, { ...breakdown, cost })
      }
    }
  }
  return [...byModel.values()]
}
function mergeDailyGroups(rows: DailyRow[]): DailyRow {
  const machines = rows.flatMap(
    (row) => row.metadata?.machines ?? [row.metadata?.machine ?? "unknown"]
  )
  const base: DailyRow = {
    ...rows[0],
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    modelsUsed: [],
    modelBreakdowns: [],
    agents: [],
  }
  for (const row of rows) {
    addTokensInto(base, row)
    base.totalCost += adjustedRowCost(row)
    for (const model of row.modelsUsed) {
      if (!base.modelsUsed.includes(model)) base.modelsUsed.push(model)
    }
  }
  base.agents = mergeAgentSplits(rows.map((row) => row.agents ?? []))
  base.modelBreakdowns = mergeBreakdowns(
    rows.map((row) => row.modelBreakdowns)
  )
  base.modelsUsed.sort()
  base.metadata = { machines }
  return base
}
function tagRows<T extends { metadata?: { machine?: string } }>(
  rows: T[],
  source: Source
): T[] {
  return rows.map((row) => ({
    ...row,
    metadata: { ...(row.metadata ?? {}), machine: source },
  })) as T[]
}
function weekOf(iso: string): string {
  const at = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() - ((at.getUTCDay() + 6) % 7))
  return at.toISOString().slice(0, 10)
}
function rollupPeriods(rows: DailyRow[], keyOf: (period: string) => string): PeriodRow[] {
  const byKey = new Map<string, DailyRow[]>()
  for (const row of rows) {
    const key = keyOf(row.period)
    const list = byKey.get(key)
    if (list) list.push(row)
    else byKey.set(key, [row])
  }
  return [...byKey.entries()]
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([key, group]) => ({ ...mergeDailyGroups(group), period: key }) as PeriodRow)
}
function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}
function readPayload(path: string | undefined): UnifiedPayload | null {
  if (!path) return null
  try {
    const raw = require("node:fs").readFileSync(path, "utf8") as string
    return parseEnvelope(raw)
  } catch {
    return null
  }
}
const localId = argValue("--local-id") ?? "local"
const srcs: Array<{ id: string; payload: UnifiedPayload | null }> = [
  { id: localId, payload: readPayload(argValue("--local")) },
]
process.argv.forEach((arg, i) => {
  if (arg !== "--src") return
  const spec = process.argv[i + 1] ?? ""
  const eq = spec.indexOf("=")
  if (eq <= 0) return
  srcs.push({ id: spec.slice(0, eq), payload: readPayload(spec.slice(eq + 1)) })
})
const devinRows = argValue("--devin")
  ? (() => {
      try {
        const devinPath = argValue("--devin")
        return parseDevin(require("node:fs").readFileSync(devinPath, "utf8"))
      } catch {
        return []
      }
    })()
  : []
if (srcs.every((s) => !s.payload) && devinRows.length === 0) {
  console.error(JSON.stringify({ error: "no usable source payloads" }))
  process.exit(1)
}
const byDate = new Map<string, DailyRow[]>()
for (const row of [
  ...srcs.flatMap((s) => tagRows(s.payload?.daily ?? [], s.id)),
  ...devinRows,
]) {
  const list = byDate.get(row.period)
  if (list) list.push(row)
  else byDate.set(row.period, [row])
}
const daily = [...byDate.entries()]
  .sort(([x], [y]) => x.localeCompare(y))
  .map(([, rows]) => mergeDailyGroups(rows))
const merged: UnifiedPayload & { sources: Source[] } = {
  daily,
  // ponytail: weekly/monthly roll up from merged daily so every grain agrees and
  // devin rows are included; source history older than daily's first row is lost (~$0)
  weekly: rollupPeriods(daily, weekOf),
  monthly: rollupPeriods(daily, (period) => period.slice(0, 7)),
  session: srcs.flatMap((s) =>
    s.payload?.session ? tagRows(s.payload.session, s.id) : []
  ),
  totals: {
    inputTokens: daily.reduce((sum, row) => sum + row.inputTokens, 0),
    outputTokens: daily.reduce((sum, row) => sum + row.outputTokens, 0),
    cacheCreationTokens: daily.reduce(
      (sum, row) => sum + row.cacheCreationTokens,
      0
    ),
    cacheReadTokens: daily.reduce((sum, row) => sum + row.cacheReadTokens, 0),
    totalTokens: daily.reduce((sum, row) => sum + row.totalTokens, 0),
    totalCost: daily.reduce((sum, row) => sum + row.totalCost, 0),
  },
  sources: srcs.filter((s) => s.payload).map((s) => s.id),
}
console.log(JSON.stringify(merged))
