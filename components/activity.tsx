"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import { AreaChart } from "@/components/dither-kit/area-chart"
import { Area } from "@/components/dither-kit/area"
import { Grid } from "@/components/dither-kit/grid"
import { XAxis } from "@/components/dither-kit/x-axis"
import { YAxis } from "@/components/dither-kit/y-axis"
import { Tooltip } from "@/components/dither-kit/tooltip"
import type { DitherColor } from "@/components/dither-kit/palette"
import type { DailyRow, SessionRow } from "@/lib/ccusage-types"
import { formatCompactTokens, formatMoney } from "@/lib/format"
import type { Metric } from "@/lib/derive"
const WEEKDAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""]
const ROWS = 7
const LABEL_W = 30
const MONTH_LABEL_H = 16
function intensity(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0
  const t = value / max
  if (t < 0.02) return 1
  if (t < 0.12) return 2
  if (t < 0.3) return 3
  if (t < 0.55) return 4
  return 5
}
const RAMP_RGB: Record<number, [number, number, number]> = {
  0: [92, 92, 100],
  1: [255, 90, 20],
  2: [255, 115, 10],
  3: [255, 140, 20],
  4: [255, 170, 45],
  5: [255, 205, 110],
}
const rgbStr = ([r, g, b]: [number, number, number], a = 1) =>
  `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => (v + 0.5) / 16))
const LEVEL_ALPHA = [0.12, 0.45, 0.6, 0.75, 0.88, 1]
function cellAlpha(level: number, gx: number, gy: number): number {
  return LEVEL_ALPHA[level] * (BAYER[gy & 3][gx & 3] <= 0.62 ? 1 : 0.55)
}
function todayISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}
interface DayCell {
  date: string
  value: number
  level: number
  cost: number
  tokens: number
  future: boolean
  col?: number
  row?: number
}
function fullDate(iso: string): string {
  const at = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(at.getTime())) return iso
  return at.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}
export function Last24hChart({
  sessions,
  metric,
}: {
  sessions: SessionRow[]
  metric: Metric
}) {
  const { rows, agents } = useMemo(() => {
    const now = new Date()
    const hourKeys: number[] = []
    const byHour = new Map<
      number,
      { label: string; sessions: Map<string, { cost: number; tokens: number }> }
    >()
    for (let i = 23; i >= 0; i--) {
      const at = new Date(now.getTime() - i * 3_600_000)
      at.setMinutes(0, 0, 0)
      hourKeys.push(at.getTime())
      byHour.set(at.getTime(), {
        label: `${String(at.getHours()).padStart(2, "0")}:00`,
        sessions: new Map(),
      })
    }
    const agentTotals = new Map<string, number>()
    for (const session of sessions) {
      const last = session.metadata?.lastActivity
      if (!last) continue
      const at = new Date(last)
      at.setMinutes(0, 0, 0)
      const bucket = byHour.get(at.getTime())
      if (!bucket || at.getTime() > now.getTime()) continue
      const agent = session.agent || "other"
      const entry = bucket.sessions.get(agent) ?? { cost: 0, tokens: 0 }
      entry.cost += session.totalCost
      entry.tokens += session.totalTokens
      bucket.sessions.set(agent, entry)
      agentTotals.set(
        agent,
        (agentTotals.get(agent) ?? 0) +
          (metric === "cost" ? session.totalCost : session.totalTokens)
      )
    }
    const agentList = [...agentTotals.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([name]) => name)
    const out = hourKeys.map((key) => {
      const hourBucket = byHour.get(key)
      if (!hourBucket) return null
      const row: Record<string, number | string> = { label: hourBucket.label }
      for (const agent of agentList) {
        const entry = hourBucket.sessions.get(agent)
        row[agent] = metric === "cost" ? (entry?.cost ?? 0) : (entry?.tokens ?? 0)
      }
      return row
    })
    return {
      rows: out.filter((row): row is Record<string, number | string> => row !== null),
      agents: agentList,
    }
  }, [sessions, metric])
  const config = useMemo(() => {
    const paletteOrder: DitherColor[] = [
      "orange",
      "grey",
      "blue",
      "purple",
      "green",
      "pink",
      "red",
    ]
    return Object.fromEntries(
      agents.map((agent, index) => [
        agent,
        {
          label: agent.charAt(0).toUpperCase() + agent.slice(1),
          color: paletteOrder[index % paletteOrder.length],
        },
      ])
    )
  }, [agents])
  if (rows.length === 0 || agents.length === 0) {
    return (
      <div className="grid h-[220px] place-items-center rounded-lg border border-border/60 font-mono text-xs text-muted-foreground">
        no sessions in the last 24 hours
      </div>
    )
  }
  return (
    <div className="relative h-[260px] overflow-visible rounded-lg border border-border/60 bg-card/40">
      <AreaChart
        key={`24h-${metric}-${agents.length}`}
        data={rows}
        config={config}
        stackType="stacked"
        bloom="low"
        margins={{ top: 16, right: 18, bottom: 28, left: 52 }}
        className="absolute inset-0 h-full w-full"
      >
        <Grid strokeDasharray="2 5" />
        {agents.map((agent) => (
          <Area key={agent} dataKey={agent} variant="gradient" />
        ))}
        <XAxis
          dataKey="label"
          maxTicks={6}
          tickFormatter={(value) => String(value).slice(0, 2)}
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
    </div>
  )
}
export function ActivityHeatmap({
  days,
  metric,
}: {
  days: DailyRow[]
  metric: Metric
}) {
  const [hovered, setHovered] = useState<DayCell | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const today = useMemo(() => todayISO(), [])
  const { columns, monthLabels, totalValue, maxValue } = useMemo(() => {
    const sorted = [...days].sort((a, b) => a.period.localeCompare(b.period))
    const maxValue = Math.max(
      1,
      ...sorted.map((row) => (metric === "cost" ? row.totalCost : row.totalTokens))
    )
    const cells = sorted.map<DayCell>((row) => {
      const cost = row.totalCost
      const tokens = row.totalTokens
      const value = metric === "cost" ? cost : tokens
      return {
        date: row.period,
        value,
        level: intensity(value, maxValue),
        cost,
        tokens,
        future: false,
      }
    })
    const firstDate = new Date(`${sorted[0].period}T00:00:00Z`)
    const lead = (firstDate.getUTCDay() + 6) % 7
    for (let i = 0; i < lead; i++) {
      const filler = new Date(firstDate)
      filler.setUTCDate(filler.getUTCDate() - (lead - i))
      cells.unshift({
        date: filler.toISOString().slice(0, 10),
        value: 0,
        level: -1,
        cost: 0,
        tokens: 0,
        future: false,
      })
    }
    const cols: DayCell[][] = []
    for (let i = 0; i < cells.length; i += ROWS) {
      cols.push(cells.slice(i, i + ROWS))
    }
    const labels: { x: number; label: string }[] = []
    let lastMonth = -1
    cols.forEach((col, index) => {
      const mid = col[Math.floor(col.length / 2)]
      if (!mid) return
      const month = new Date(`${mid.date}T00:00:00Z`).getUTCMonth()
      if (month !== lastMonth) {
        lastMonth = month
        labels.push({
          x: index,
          label: new Date(`${mid.date}T00:00:00Z`).toLocaleString("en-US", {
            month: "short",
            timeZone: "UTC",
          }),
        })
      }
    })
    const sum = cells.reduce((acc, cell) => acc + (cell.level >= 0 ? cell.value : 0), 0)
    return { columns: cols, monthLabels: labels, max: maxValue, totalValue: sum, maxValue }
  }, [days, metric])
  const gap = columns.length > 40 ? 4 : 2
  const cell =
    containerWidth > 0
      ? Math.max(10, Math.floor((containerWidth - LABEL_W - (columns.length - 1) * gap) / columns.length) & ~1)
      : 10
  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Activity</h2>
        <span className="font-mono text-[10px] text-muted-foreground">
          peak{" "}
          {metric === "cost"
            ? formatMoney(maxValue)
            : `${formatCompactTokens(maxValue)} tok`}
          {" · "}
          {metric === "cost"
            ? `${formatMoney(totalValue)} total`
            : `${formatCompactTokens(totalValue)} total`}
        </span>
      </div>
      <div
        className="relative overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        ref={(node) => {
          if (node && node.clientWidth !== containerWidth) {
            setContainerWidth(node.clientWidth)
          }
        }}
      >
        {hovered && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-border bg-popover px-2.5 py-1.5 shadow-lg"
            style={{
              left: LABEL_W + (hovered.col ?? 0) * (cell + gap) + cell / 2,
              top: Math.max(2, MONTH_LABEL_H + (hovered.row ?? 0) * (cell + gap) - 52),
            }}
          >
            <div className="font-mono text-[10px] text-muted-foreground">
              {fullDate(hovered.date)}
            </div>
            <div className="font-mono text-xs tabular-nums">
              {metric === "cost"
                ? formatMoney(hovered.cost)
                : `${formatCompactTokens(hovered.tokens)} tokens`}
            </div>
          </div>
        )}
        <div className="relative" style={{ width: LABEL_W + columns.length * cell + (columns.length - 1) * gap }}>
          {monthLabels.map((m) => (
            <span
              key={m.x}
              className="absolute select-none font-mono text-[9px] leading-none text-muted-foreground"
              style={{ left: LABEL_W + m.x * (cell + gap), top: 4 }}
            >
              {m.label}
            </span>
          ))}
          {WEEKDAY_LABELS.map((w, i) =>
            w ? (
              <span
                key={i}
                className="absolute -translate-y-1/2 select-none font-mono text-[9px] leading-none text-muted-foreground"
                style={{ left: 0, top: MONTH_LABEL_H + i * (cell + gap) + cell / 2 }}
              >
                {w}
              </span>
            ) : null
          )}
          <HeatCanvas
            columns={columns}
            cell={cell}
            gap={gap}
            hoveredDate={hovered?.date ?? null}
            today={today}
            onHover={(cellData, ci, ri) =>
              setHovered(cellData ? { ...cellData, col: ci, row: ri } : null)
            }
          />
        </div>
        <div className="mt-2 flex items-center justify-end gap-1.5">
          <span className="mr-1 font-mono text-[10px] text-muted-foreground">less</span>
          {[0, 1, 2, 3, 4, 5].map((level) => (
            <DitherSwatch key={level} level={level} size={11} />
          ))}
          <span className="ml-1 font-mono text-[10px] text-muted-foreground">more</span>
        </div>
      </div>
    </section>
  )
}
function HeatCanvas({
  columns,
  cell,
  gap,
  hoveredDate,
  today,
  onHover,
}: {
  columns: DayCell[][]
  cell: number
  gap: number
  hoveredDate: string | null
  today: string
  onHover: (cell: DayCell | null, col?: number, row?: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || cell <= 0) return
    const CELL_PX = 2
    const width = LABEL_W + columns.length * cell + (columns.length - 1) * gap
    const height = MONTH_LABEL_H + ROWS * cell + (ROWS - 1) * gap
    canvas.width = Math.ceil(width / CELL_PX)
    canvas.height = Math.ceil(height / CELL_PX)
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const px = (cssX: number) => cssX / CELL_PX
    columns.forEach((col, ci) => {
      col.forEach((cellData, ri) => {
        if (cellData.level < 0) return
        const x0 = px(LABEL_W + ci * (cell + gap))
        const y0 = px(MONTH_LABEL_H + ri * (cell + gap))
        const w = Math.max(1, px(cell))
        const h = Math.max(1, px(cell))
        const fill = RAMP_RGB[cellData.level]
        const hovered = cellData.date === hoveredDate
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) {
            const gx = Math.floor(x0) + dx
            const gy = Math.floor(y0) + dy
            ctx.fillStyle = rgbStr(fill, hovered ? 1 : cellAlpha(cellData.level, gx, gy))
            ctx.fillRect(gx, gy, 1, 1)
          }
        }
        if (cellData.date === today && !hovered) {
          for (let dx = 0; dx < w; dx++) {
            ctx.fillStyle = "rgba(255,255,255,0.55)"
            ctx.fillRect(Math.floor(x0) + dx, Math.floor(y0), 1, 1)
            ctx.fillRect(Math.floor(x0) + dx, Math.floor(y0) + h - 1, 1, 1)
          }
          for (let dy = 0; dy < h; dy++) {
            ctx.fillStyle = "rgba(255,255,255,0.55)"
            ctx.fillRect(Math.floor(x0), Math.floor(y0) + dy, 1, 1)
            ctx.fillRect(Math.floor(x0) + w - 1, Math.floor(y0) + dy, 1, 1)
          }
        }
      })
    })
  }, [columns, cell, gap, hoveredDate, today])
  const handleMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left - LABEL_W
    const y = event.clientY - rect.top - MONTH_LABEL_H
    if (x < 0 || y < 0) {
      onHover(null)
      return
    }
    const stride = cell + gap
    const ci = Math.floor(x / stride)
    const ri = Math.floor(y / stride)
    const inCellX = x - ci * stride <= cell
    const inCellY = y - ri * stride <= cell
    const hit = inCellX && inCellY ? columns[ci]?.[ri] : undefined
    if (hit && hit.level >= 0) onHover(hit, ci, ri)
    else onHover(null)
  }
  const width = LABEL_W + columns.length * cell + (columns.length - 1) * gap
  const height = MONTH_LABEL_H + ROWS * cell + (ROWS - 1) * gap
  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Daily activity heatmap"
      style={{ width, height, imageRendering: "pixelated" }}
      className="block cursor-pointer"
      onMouseMove={handleMove}
      onMouseLeave={() => onHover(null)}
    />
  )
}
function DitherSwatch({ level, size }: { level: number; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const CELL_PX = 2
    canvas.width = Math.ceil(size / CELL_PX)
    canvas.height = Math.ceil(size / CELL_PX)
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const fill = RAMP_RGB[level]
    const w = canvas.width
    const h = canvas.height
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        ctx.fillStyle = rgbStr(fill, cellAlpha(level, x, y))
        ctx.fillRect(x, y, 1, 1)
      }
    }
  }, [level, size])
  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{ width: size, height: size, imageRendering: "pixelated" }}
      className="rounded-[2px]"
    />
  )
}
