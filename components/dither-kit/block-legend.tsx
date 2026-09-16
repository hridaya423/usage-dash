"use client"
import type { ChartConfig } from "./chart-context"
import { cn } from "./lib"
import { rgb, seedOfColor } from "./palette"
export function BlockLegend({
  config,
  values,
  valueFormatter = (v) => String(v),
  align = "start",
  className,
}: {
  config: ChartConfig
  values?: Record<string, number>
  valueFormatter?: (value: number) => string
  align?: "start" | "center" | "end"
  className?: string
}) {
  return (
    <ul
      className={cn(
        "flex flex-wrap gap-x-4 gap-y-1.5 px-1",
        align === "center" && "justify-center",
        align === "end" && "justify-end",
        className
      )}
    >
      {Object.entries(config).map(([name, entry]) => {
        const seed = seedOfColor(entry.color)
        const value = values?.[name]
        return (
          <li
            key={name}
            className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground"
          >
            <span
              className="size-2 rounded-[1px]"
              style={{ backgroundColor: rgb(seed.fill) }}
            />
            <span>{entry.label ?? name}</span>
            {value !== undefined ? (
              <span className="text-foreground">{valueFormatter(value)}</span>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
