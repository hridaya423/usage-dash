"use client"
import { useEffect, useMemo, useRef } from "react"
import { PALETTE, rgb, type DitherColor } from "@/components/dither-kit/palette"
import type { Dashboard, Metric } from "@/lib/derive"
import { formatCompactTokens, formatMoney, formatPct } from "@/lib/format"
const SHARE_COLORS: Record<string, DitherColor> = {
  codex: "grey",
  claude: "orange",
  droid: "blue",
  amp: "purple",
  opencode: "green",
  pi: "pink",
}
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => (v + 0.5) / 16))
function makeDitherPattern(fill: string): CanvasPattern | null {
  const canvas = document.createElement("canvas")
  canvas.width = 4
  canvas.height = 4
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      if (BAYER[y][x] <= 0.625) {
        ctx.fillStyle = fill
        ctx.fillRect(x, y, 1, 1)
      }
    }
  }
  return ctx.createPattern(canvas, "repeat") ?? null
}
function DitherBar({ fill }: { fill: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const canvas = document.createElement("canvas")
    canvas.width = 4
    canvas.height = 4
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        if (BAYER[y][x] <= 0.625) {
          ctx.fillStyle = fill
          ctx.fillRect(x, y, 1, 1)
        }
      }
    }
    node.style.backgroundImage = `url(${canvas.toDataURL()})`
    node.style.backgroundSize = "4px 4px"
  }, [fill])
  return <div ref={ref} className="h-full w-full" />
}
function sourceColor(agent: string): DitherColor {
  const known = SHARE_COLORS[agent]
  if (known) return known
  let hash = 0
  for (let i = 0; i < agent.length; i++) hash = (hash * 31 + agent.charCodeAt(i)) | 0
  const rest: DitherColor[] = ["red", "green", "purple", "blue", "pink"]
  return rest[Math.abs(hash) % rest.length]
}
export function SourcesBreakdown({
  dash,
  metric,
}: {
  dash: Dashboard
  metric: Metric
}) {
  const total = metric === "cost" ? dash.totalCost : dash.totalTokens
  const rows = useMemo(
    () =>
      [...dash.agents]
        .filter((agent) => agent.cost > 0 || agent.tokens > 0)
        .sort((a, b) =>
          metric === "cost" ? b.cost - a.cost : b.tokens - a.tokens
        )
        .map((agent) => ({
          label: agent.label,
          value: metric === "cost" ? agent.cost : agent.tokens,
          share: total > 0 ? ((metric === "cost" ? agent.cost : agent.tokens) / total) * 100 : 0,
          color: sourceColor(agent.agent),
        })),
    [dash.agents, metric, total]
  )
  const formatValue = (value: number) =>
    metric === "cost" ? formatMoney(value) : `${formatCompactTokens(value)} tokens`
  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Sources</h2>
        <span className="font-mono text-[10px] text-muted-foreground">
          by {metric === "cost" ? "cost" : "tokens"}
        </span>
      </div>
      <div className="flex h-5 w-full gap-[2px] overflow-hidden rounded-md">
        {rows.map((row) => (
          <div
            key={row.label}
            title={`${row.label} · ${formatValue(row.value)} (${formatPct(row.share)})`}
            style={{ width: `calc(${row.share}% - 1.6px)` }}
            className="h-full overflow-hidden rounded-[3px] first:rounded-l-md last:rounded-r-md"
          >
            <DitherBar fill={rgb(PALETTE[row.color].fill)} />
          </div>
        ))}
      </div>
      <ul className="mt-6 grid gap-x-10 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-3">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: rgb(PALETTE[row.color].fill) }}
            />
            <span className="min-w-0 flex-1 truncate font-mono text-xs">
              {row.label}
            </span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {formatValue(row.value)}
            </span>
            <span className="w-12 text-right font-mono text-xs font-semibold tabular-nums">
              {formatPct(row.share)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
