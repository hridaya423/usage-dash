"use client"
import { useMemo } from "react"
import { Area } from "./area"
import { AreaChart } from "./area-chart"
import type { AreaVariant } from "./chart-context"
import type { BloomInput } from "./dither-paint"
import type { DitherColor } from "./palette"
export type SparklineProps = {
  data: number[]
  color: DitherColor
  variant?: AreaVariant
  markerIndex?: number | null
  hovered?: boolean
  bloom?: BloomInput
  bloomOnHover?: boolean
  animate?: boolean
  className?: string
}
export function Sparkline({
  data,
  color,
  variant = "gradient",
  markerIndex = null,
  hovered = false,
  bloom = "off",
  bloomOnHover = false,
  animate = false,
  className,
}: SparklineProps) {
  const rows = useMemo(() => data.map((v) => ({ v })), [data])
  const config = useMemo(() => ({ v: { color } }), [color])
  return (
    <AreaChart
      data={rows}
      config={config}
      interactive={false}
      animate={animate}
      markerIndex={markerIndex}
      hovered={hovered}
      bloom={bloom}
      bloomOnHover={bloomOnHover}
      margins={{ top: 0, right: 0, bottom: 0, left: 0 }}
      className={className}
    >
      <Area dataKey="v" variant={variant} />
    </AreaChart>
  )
}
