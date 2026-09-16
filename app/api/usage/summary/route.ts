import { readFileSync } from "node:fs"
import path from "node:path"
import { loadUsage } from "@/lib/usage-cache"
import {
  buildDayAxis,
  deriveDashboard,
  type RangeKey,
} from "@/lib/derive"
import type { DailyRow, PeriodRow, UnifiedPayload } from "@/lib/ccusage-types"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const RANGES: readonly RangeKey[] = ["24h", "7d", "30d", "90d"]
function machines(): string[] {
  try {
    const cfg = JSON.parse(
      readFileSync(path.join(process.cwd(), "machines.config.json"), "utf8")
    ) as { localId?: string; machines?: { id: string }[] }
    return [cfg.localId ?? "local", ...(cfg.machines ?? []).map((m) => m.id)]
  } catch {
    return []
  }
}
function todayISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}
function sumRows(rows: DailyRow[]): { cost: number; tokens: number } {
  let cost = 0
  let tokens = 0
  for (const row of rows) {
    cost += row.totalCost
    tokens += row.totalTokens
  }
  return { cost, tokens }
}
function trimSplit(split: { agent: string; totalCost: number; totalTokens: number }) {
  return { agent: split.agent, cost: split.totalCost, tokens: split.totalTokens }
}
function trimRow(row: DailyRow | PeriodRow) {
  return {
    period: row.period,
    cost: row.totalCost,
    tokens: row.totalTokens,
    agents: (row.agents ?? []).map(trimSplit),
  }
}
function last24hBuckets(payload: UnifiedPayload) {
  const now = new Date()
  const buckets: {
    label: string
    at: number
    byAgent: Map<string, { cost: number; tokens: number }>
  }[] = []
  const byHour = new Map<number, (typeof buckets)[number]>()
  for (let i = 23; i >= 0; i--) {
    const at = new Date(now.getTime() - i * 3_600_000)
    at.setMinutes(0, 0, 0)
    const bucket = {
      label: `${String(at.getHours()).padStart(2, "0")}:00`,
      at: at.getTime(),
      byAgent: new Map<string, { cost: number; tokens: number }>(),
    }
    buckets.push(bucket)
    byHour.set(bucket.at, bucket)
  }
  for (const session of payload.session ?? []) {
    const last = session.metadata?.lastActivity
    if (!last) continue
    const at = new Date(last)
    at.setMinutes(0, 0, 0)
    const bucket = byHour.get(at.getTime())
    if (!bucket || at.getTime() > now.getTime()) continue
    const agent = session.agent || "other"
    const entry = bucket.byAgent.get(agent) ?? { cost: 0, tokens: 0 }
    entry.cost += session.totalCost
    entry.tokens += session.totalTokens
    bucket.byAgent.set(agent, entry)
  }
  return buckets.map((bucket) => ({
    label: bucket.label,
    agents: [...bucket.byAgent.entries()].map(([agent, v]) => ({
      agent,
      cost: v.cost,
      tokens: v.tokens,
    })),
  }))
}
function summarize(payload: UnifiedPayload) {
  const daily = payload.daily ?? []
  const axis = buildDayAxis(daily, 7)
  const todayPeriod = todayISO()
  const last = daily[daily.length - 1]
  const today = daily.find((row) => row.period === todayPeriod) ?? last
  const sessionsByAgent = new Map<string, number>()
  let sessionsToday = 0
  for (const row of payload.session ?? []) {
    if ((row.metadata?.lastActivity ?? "").slice(0, 10) === todayPeriod) {
      sessionsToday += 1
      const agent = row.agent || "other"
      sessionsByAgent.set(agent, (sessionsByAgent.get(agent) ?? 0) + 1)
    }
  }
  const cutoff = last ? last.period : todayPeriod
  const cutoffStart = new Date(`${cutoff}T00:00:00Z`)
  cutoffStart.setUTCDate(cutoffStart.getUTCDate() - 6)
  const start7 = cutoffStart.toISOString().slice(0, 10)
  cutoffStart.setUTCDate(cutoffStart.getUTCDate() - 23)
  const start30 = cutoffStart.toISOString().slice(0, 10)
  const weekly = [...(payload.weekly ?? [])]
    .sort((a, b) => a.period.localeCompare(b.period))
    .slice(-13)
  const ranges = Object.fromEntries(
    RANGES.map((range) => {
      const dash = deriveDashboard(payload, range)
      return [
        range,
        {
          label: dash.rangeLabel,
          totalCost: dash.totalCost,
          totalTokens: dash.totalTokens,
          sessions: dash.sessionCount,
          agents: dash.agents.map((agent) => ({
            agent: agent.agent,
            label: agent.label,
            color: agent.color,
            cost: agent.cost,
            tokens: agent.tokens,
            sessions: agent.sessions,
          })),
          models: dash.modelRows.map((row) => ({
            name: row.label,
            cost: row.cost,
            tokens: row.tokens,
            share: row.share,
          })),
        },
      ]
    })
  )
  return {
    sources: (payload as UnifiedPayload & { sources?: string[] }).sources ?? [],
    today: today
      ? {
          ...trimRow(today),
          sessions: sessionsToday,
          agents: (today.agents ?? []).map((split) => ({
            ...trimSplit(split),
            sessions: sessionsByAgent.get(split.agent) ?? 0,
          })),
        }
      : null,
    week: sumRows(daily.filter((row) => row.period >= start7)),
    month: sumRows(daily.filter((row) => row.period >= start30)),
    daily: axis.map(trimRow),
    weekly: weekly.map(trimRow),
    hourly: last24hBuckets(payload),
    ranges,
  }
}
export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("refresh") === "1"
  const state = await loadUsage(force)
  if (!state.envelope) {
    return Response.json({ error: "initial scan failed" }, { status: 502 })
  }
  return Response.json({
    fetchedAt: state.envelope.fetchedAt,
    refreshing: state.refreshing,
    machines: machines(),
    etaSeconds: state.etaSeconds,
    stale: state.stale,
    ...summarize(state.envelope.payload),
  })
}
