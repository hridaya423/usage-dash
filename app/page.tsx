"use client"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { RefreshCw } from "lucide-react"
import { AreaChart } from "@/components/dither-kit/area-chart"
import { Area } from "@/components/dither-kit/area"
import { Grid } from "@/components/dither-kit/grid"
import { XAxis } from "@/components/dither-kit/x-axis"
import { YAxis } from "@/components/dither-kit/y-axis"
import { Tooltip } from "@/components/dither-kit/tooltip"
import { PALETTE, rgb, type DitherColor } from "@/components/dither-kit/palette"
import { ActivityHeatmap, Last24hChart } from "@/components/activity"
import { SourcesBreakdown } from "@/components/sources"
import { DitherProgress } from "@/components/dither-progress"
import type { AgentSplit, UsageEnvelope } from "@/lib/ccusage-types"
import {
  deriveDashboard,
  type BreakdownView,
  type Dashboard,
  type Metric,
  type RangeKey,
} from "@/lib/derive"
import {
  formatClock,
  formatCompactTokens,
  formatMoney,
  formatPct,
  shortDay,
} from "@/lib/format"
type ApiEnvelope = UsageEnvelope & {
  stale?: boolean
  refreshing?: boolean
  etaSeconds?: number | null
  error?: string
}
const RANGES: readonly RangeKey[] = ["24h", "7d", "30d", "90d"]
const RANGE_LABELS: Record<RangeKey, string> = {
  "24h": "Past 24h",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
}
function agentConfig(agents: Dashboard["agents"]) {
  return Object.fromEntries(
    agents.map((agent) => [
      agent.agent,
      { label: agent.label, color: agent.color },
    ])
  )
}
function modelColor(name: string): DitherColor {
  if (name.startsWith("claude")) return "orange"
  return "grey"
}
function modelName(raw: string): string {
  return raw.replace(/-\d{8}$/, "")
}
function agentValue(
  splits: AgentSplit[] | undefined,
  agent: string,
  metric: Metric
): number {
  const hit = splits?.find((entry) => entry.agent === agent)
  if (!hit) return 0
  return metric === "cost" ? hit.totalCost : hit.totalTokens
}
export default function Page() {
  const [envelope, setEnvelope] = useState<UsageEnvelope | null>(null)
  const [stale, setStale] = useState(false)
  const [scanning, setScanning] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [metric, setMetric] = useState<Metric>("cost")
  const [range, setRange] = useState<RangeKey>("30d")
  const [view, setView] = useState<BreakdownView>("model")
  const [hiddenAgents, setHiddenAgents] = useState<Set<string>>(new Set())
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null)
  const inflight = useRef<AbortController | null>(null)
  const load = useCallback(async (refresh: boolean) => {
    inflight.current?.abort()
    const controller = new AbortController()
    inflight.current = controller
    if (refresh) setRefreshing(true)
    try {
      const res = await fetch(refresh ? "/api/usage?refresh=1" : "/api/usage", {
        signal: controller.signal,
      })
      const body = (await res.json()) as ApiEnvelope
      if (!res.ok || body.error) {
        setError(body.error ?? `Request failed (${res.status})`)
      } else {
        setError(null)
        setStale(body.stale === true)
        setScanning(body.refreshing === true)
        setEtaSeconds(body.etaSeconds ?? null)
        if (!body.refreshing) {
          setEnvelope({ payload: body.payload, fetchedAt: body.fetchedAt })
        } else {
          setEnvelope((prev) =>
            prev ? prev : { payload: body.payload, fetchedAt: body.fetchedAt }
          )
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError" && inflight.current === controller) {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      if (inflight.current === controller) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    void load(false)
  }, [load])
  useEffect(() => {
    if (!scanning) return
    const id = setInterval(() => void loadRef.current(false), 1500)
    return () => clearInterval(id)
  }, [scanning])
  const dash = useMemo(
    () => (envelope ? deriveDashboard(envelope.payload, range) : null),
    [envelope, range]
  )
  const visibleAgents = useMemo(
    () =>
      dash
        ? dash.agents.filter((agent) => !hiddenAgents.has(agent.agent))
        : [],
    [dash, hiddenAgents]
  )
  const toggleAgent = useCallback(
    (agent: string) => {
      setHiddenAgents((prev) => {
        const next = new Set(prev)
        if (next.has(agent)) {
          next.delete(agent)
          return next
        }
        if (dash && dash.agents.length - next.size <= 1) return prev
        next.add(agent)
        return next
      })
    },
    [dash]
  )
  const chartRows = useMemo(() => {
    if (!dash || visibleAgents.length === 0) return []
    const source =
      dash.rangeDays.length > 1 ? dash.rangeDays : dash.days.slice(-7)
    return source.map((row) => {
      const entry: Record<string, number | string> = {
        day: row.period,
        label:
          range === "90d"
            ? `wk ${shortDay(row.period)}`
            : shortDay(row.period),
      }
      for (const agent of visibleAgents) {
        entry[agent.agent] = agentValue(row.agents, agent.agent, metric)
      }
      return entry
    })
  }, [dash, metric, visibleAgents, range])
  const hero = !dash
    ? { value: "—", suffix: "" }
    : metric === "cost"
      ? { value: formatMoney(dash.totalCost), suffix: "" }
      : { value: formatCompactTokens(dash.totalTokens), suffix: "tokens" }
  const rows = view === "model" ? (dash?.modelRows ?? []) : (dash?.dayRows ?? [])
  const shareMax = Math.max(1, ...rows.map((row) => row.share))
  const etaTotalRef = useRef<number | null>(null)
  if (scanning && etaSeconds !== null && (etaTotalRef.current === null || etaSeconds > etaTotalRef.current)) {
    etaTotalRef.current = etaSeconds + 1
  }
  if (!scanning) etaTotalRef.current = null
  const etaTotal = etaTotalRef.current ?? 0
  const [lineFading, setLineFading] = useState(false)
  const wasScanning = useRef(false)
  useEffect(() => {
    if (wasScanning.current && !scanning) {
      setLineFading(true)
      const id = setTimeout(() => setLineFading(false), 700)
      return () => clearTimeout(id)
    }
    wasScanning.current = scanning
  }, [scanning])
  const lineProgress = scanning
    ? etaSeconds !== null && etaTotal > 0
      ? Math.min(0.98, Math.max(0.05, 1 - etaSeconds / etaTotal))
      : null
    : 1
  return (
    <main className="mx-auto w-full max-w-[1100px] flex-1 px-5 py-8 md:px-8">
      <div
        className={`mb-6 transition-opacity duration-500 ${
          scanning || lineFading ? "opacity-100" : "opacity-0"
        }`}
      >
        <DitherProgress progress={lineProgress} />
      </div>
      <header className="mb-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-sm font-medium">Usage</h1>
          <span className="font-mono text-xs text-muted-foreground">
            / {dash?.rangeLabel || "…"}
          </span>
          {scanning ? (
            <span className="inline-flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
              <span className="size-1.5 animate-pulse rounded-full bg-orange-400" />
              updating
              {etaSeconds !== null && (
                <span className="tabular-nums text-foreground">
                  · ~{etaSeconds}s
                </span>
              )}
            </span>
          ) : stale ? (
            <span className="font-mono text-[10px] text-muted-foreground">
              showing cached
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Segmented
            options={[
              ["cost", "Cost"],
              ["tokens", "Tokens"],
            ]}
            value={metric}
            onChange={(next) => setMetric(next as Metric)}
          />
          <div className="min-w-0 w-full -mx-5 overflow-x-auto px-5 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-auto sm:mx-0 sm:overflow-visible sm:px-0">
            <div className="flex items-center gap-0.5 rounded-md border border-border/70 p-0.5">
              {RANGES.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setRange(key)}
                className={`rounded-[5px] px-2 py-1 text-xs transition-colors ${
                  range === key
                    ? "bg-foreground font-medium text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {RANGE_LABELS[key]}
              </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {envelope && (
              <span className="hidden font-mono text-[10px] text-muted-foreground lg:inline">
                updated {formatClock(envelope.fetchedAt)}
              </span>
            )}
            <button
              type="button"
              aria-label="Refresh data"
              onClick={() => void load(true)}
              className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.09] hover:text-foreground disabled:opacity-40"
              disabled={refreshing}
            >
              <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </header>
      {error && (
        <div className="mb-6 rounded-lg border border-red-400/40 bg-red-400/10 px-4 py-3 font-mono text-xs text-red-300">
          {error}
        </div>
      )}
      {!dash && loading ? (
        <LoadingState />
      ) : !dash || dash.days.length === 0 ? (
        <div className="py-24 text-center font-mono text-sm text-muted-foreground">
          No usage data found. Run an agent CLI once, then hit refresh.
        </div>
      ) : (
        <>
          <section className="mb-10 grid items-stretch gap-10 lg:grid-cols-[minmax(280px,360px)_1fr]">
            <HeroBlock
              dash={dash}
              hero={hero}
              metric={metric}
              hiddenAgents={hiddenAgents}
              onToggleAgent={toggleAgent}
              onResetFilters={() => setHiddenAgents(new Set())}
            />
            <div className="relative h-[380px] overflow-visible rounded-lg border border-border/60 bg-card/40 lg:h-full">
              {refreshing && (
                <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-foreground/10">
                  <div className="h-full w-1/3 animate-[slide_1.2s_ease-in-out_infinite] bg-foreground/60" />
                </div>
              )}
              {range === "24h" ? (
                <Last24hChart sessions={envelope?.payload.session ?? []} metric={metric} />
              ) : (
              <AreaChart
                key={`${range}-${metric}-${visibleAgents.length}`}
                data={chartRows}
                config={agentConfig(visibleAgents)}
                stackType="stacked"
                bloom="low"
                margins={{ top: 16, right: 18, bottom: 28, left: 52 }}
                className="absolute inset-0 h-full w-full"
              >
                <Grid strokeDasharray="2 5" />
                {visibleAgents.map((agent) => (
                  <Area
                    key={agent.agent}
                    dataKey={agent.agent}
                    variant="gradient"
                  />
                ))}
                <XAxis
                  dataKey="day"
                  maxTicks={range === "90d" ? 6 : 4}
                  tickFormatter={(value) =>
                    range === "90d"
                      ? `wk ${shortDay(String(value))}`
                      : shortDay(String(value))
                  }
                />
                <YAxis
                  tickCount={4}
                  tickFormatter={(t) =>
                    metric === "cost" && t > 0
                      ? `$${t >= 100 ? Math.round(t / 10) * 10 : t.toFixed(0)}`
                      : formatCompactTokens(t)
                  }
                />
                <Tooltip
                  labelKey="label"
                  valueFormatter={(value) =>
                    metric === "cost"
                      ? formatMoney(value)
                      : `${formatCompactTokens(value)} tok`
                  }
                />
              </AreaChart>
              )}
            </div>
          </section>
          <div className="mt-12">
            <SourcesBreakdown dash={dash} metric={metric} />
          </div>
          <div className="mt-12">
            <ActivityHeatmap days={dash.days} metric={metric} />
          </div>
          <section className="mt-12">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-medium">Breakdown</h2>
              <Segmented
                options={[
                  ["model", "Model"],
                  ["day", "Day"],
                ]}
                value={view}
                onChange={(next) => setView(next as BreakdownView)}
              />
            </div>
            <div className="overflow-hidden rounded-lg border border-border/60">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border/60 font-mono text-[11px] text-muted-foreground">
                    <th className="px-4 py-2.5 text-left font-normal">
                      {view === "model"
                        ? "Model"
                        : range === "90d"
                          ? "Week"
                          : "Day"}
                    </th>
                    <th className="px-4 py-2.5 text-right font-normal">Cost</th>
                    <th className="hidden px-4 py-2.5 text-right font-normal sm:table-cell">
                      Share
                    </th>
                    <th className="px-4 py-2.5 text-right font-normal">Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const tint = rgb(PALETTE[modelColor(row.key)].fill, 1, 0.28)
                    return (
                      <tr
                        key={row.key}
                        className="border-b border-border/25 transition-colors last:border-0 hover:bg-white/[0.06]"
                      >
                        <td className="relative px-4 py-2.5">
                          <span
                            aria-hidden
                            className="absolute inset-y-[3px] left-1 right-1 rounded-[3px]"
                            style={{
                              backgroundImage: `repeating-linear-gradient(45deg, ${tint} 0 1px, transparent 1px 3px)`,
                              width: `calc(${(row.share / shareMax) * 100}% - 8px)`,
                              maxWidth: "calc(100% - 8px)",
                            }}
                          />
                          <span className="relative flex items-center gap-2.5">
                            <span
                              className="size-1.5 shrink-0 rounded-[1px]"
                              style={{
                                backgroundColor: rgb(PALETTE[modelColor(row.key)].line),
                              }}
                            />
                            <span className="truncate font-mono text-xs">
                              {view === "model"
                                ? modelName(row.label)
                                : range === "90d"
                                  ? `wk ${shortDay(row.label)}`
                                  : shortDay(row.label)}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                          {formatMoney(row.cost)}
                        </td>
                        <td className="hidden px-4 py-2.5 text-right font-mono text-xs tabular-nums text-muted-foreground sm:table-cell">
                          {formatPct(row.share)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {formatCompactTokens(row.tokens)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <footer className="mt-12 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
            <span>via ccusage · costs are API estimates computed from local JSONL</span>
            <span>dithered by tripwire dither-kit</span>
          </footer>
        </>
      )}
    </main>
  )
}
function LoadingState() {
  return (
    <section className="grid items-stretch gap-10 lg:grid-cols-[minmax(280px,360px)_1fr]">
      <div className="flex h-full flex-col justify-between gap-8 py-1">
        <div>
          <div className="h-[60px] w-[300px] animate-pulse rounded-lg bg-foreground/[0.06] md:h-[68px]" />
          <div className="mt-3 h-3 w-40 animate-pulse rounded bg-foreground/[0.05]" />
        </div>
        <div className="flex flex-col gap-4">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-3">
              <span className="size-2 animate-pulse rounded-full bg-foreground/15" />
              <div className="flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span
                    className="h-3.5 w-16 animate-pulse rounded bg-foreground/[0.06]"
                    style={{ animationDelay: `${row * 150}ms` }}
                  />
                  <span
                    className="h-3.5 w-20 animate-pulse rounded bg-foreground/[0.06]"
                    style={{ animationDelay: `${row * 150 + 75}ms` }}
                  />
                </div>
                <div className="mt-1.5 h-2.5 w-44 animate-pulse rounded bg-foreground/[0.04]" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="relative h-[380px] overflow-hidden rounded-lg border border-border/60 bg-card/40 lg:h-full">
        <div className="absolute inset-x-4 top-4">
          <DitherProgress progress={null} />
        </div>
        <div className="absolute inset-0 grid place-items-center">
          <p className="font-mono text-xs text-muted-foreground">
            scanning local transcripts via ccusage…
          </p>
        </div>
      </div>
    </section>
  )
}
function HeroBlock({
  dash,
  hero,
  metric,
  hiddenAgents,
  onToggleAgent,
  onResetFilters,
}: {
  dash: Dashboard
  hero: { value: string; suffix: string }
  metric: Metric
  hiddenAgents: Set<string>
  onToggleAgent: (agent: string) => void
  onResetFilters: () => void
}) {
  const hiddenCount = hiddenAgents.size
  return (
    <div className="flex h-full flex-col justify-between gap-8 py-1">
      <div>
        <div className="text-6xl font-semibold tracking-tight tabular-nums md:text-7xl">
          {hero.value}
          {hero.suffix && (
            <span className="ml-2 align-baseline text-base font-normal tracking-normal text-muted-foreground">
              {hero.suffix}
            </span>
          )}
        </div>
        <p className="mt-2 font-mono text-[11px] text-muted-foreground">
          {dash.sessionCount.toLocaleString()} sessions · API estimate
        </p>
      </div>
      <div className="flex flex-col gap-4">
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={onResetFilters}
            className="self-start rounded-md border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-white/[0.09] hover:text-foreground"
          >
            reset {hiddenCount} filter{hiddenCount > 1 ? "s" : ""}
          </button>
        )}
        <ul className="flex flex-col gap-3.5">
          {dash.agents.map((agent) => {
            const hidden = hiddenAgents.has(agent.agent)
            return (
              <li key={agent.agent}>
                <button
                  type="button"
                  onClick={() => onToggleAgent(agent.agent)}
                  title={
                    hidden ? "Show in chart" : "Hide from chart"
                  }
                  className={`group -mx-2 flex w-[calc(100%+16px)] items-start gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.09] ${
                    hidden ? "opacity-40" : ""
                  }`}
                >
                  <span
                    className={`mt-1 size-2 shrink-0 rounded-full transition-opacity ${
                      hidden ? "ring-1 ring-muted-foreground/50" : ""
                    }`}
                    style={{
                      backgroundColor: rgb(PALETTE[agent.color].fill),
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span
                        className={`text-sm ${
                          hidden
                            ? "text-muted-foreground line-through decoration-border"
                            : "font-medium"
                        }`}
                      >
                        {agent.label}
                      </span>
                      <span
                        className={`font-mono text-sm tabular-nums ${
                          hidden
                            ? "text-muted-foreground"
                            : "font-semibold"
                        }`}
                      >
                        {metric === "cost"
                          ? formatMoney(agent.cost)
                          : formatCompactTokens(agent.tokens)}
                      </span>
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                      {agent.sessions.toLocaleString()} sessions ·{" "}
                      {dash.totalCost > 0
                        ? formatPct((agent.cost / dash.totalCost) * 100)
                        : "0.0%"}{" "}
                      of cost ·{" "}
                      {dash.totalTokens > 0
                        ? formatPct((agent.tokens / dash.totalTokens) * 100)
                        : "0.0%"}{" "}
                      of tokens
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
function Segmented({
  options,
  value,
  onChange,
}: {
  options: readonly (readonly [string, string])[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-border/70 p-0.5">
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`rounded-[5px] px-2.5 py-1 text-xs transition-colors ${
            value === key
              ? "bg-foreground font-medium text-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
