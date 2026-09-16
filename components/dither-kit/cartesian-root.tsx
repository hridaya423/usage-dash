"use client"
import {
  Children,
  type ComponentType,
  isValidElement,
  type ReactNode,
} from "react"
import {
  type ChartConfig,
  ChartContext,
  type ChartType,
  type Margins,
  useChartController,
} from "./chart-context"
import { CommonChartContext } from "./common-context"
import type { BloomInput } from "./dither-paint"
import { cn } from "./lib"
import type { StackType } from "./scales"
import { useChartDimensions } from "./use-chart-dimensions"
type Row = object
const DEFAULT_MARGINS: Margins = {
  top: 10,
  right: 12,
  bottom: 22,
  left: 36,
}
export type CartesianChartProps<TData extends Row> = {
  data: TData[]
  config: ChartConfig
  children: ReactNode
  stackType?: StackType
  margins?: Partial<Margins>
  className?: string
  animate?: boolean
  animationDuration?: number
  replayToken?: number
  interactive?: boolean
  markerIndex?: number | null
  hovered?: boolean
  bloom?: BloomInput
  bloomOnHover?: boolean
  onHoverChange?: (index: number | null) => void
  defaultSelectedDataKey?: string | null
  onSelectionChange?: (key: string | null) => void
}
function layerOf(node: ReactNode): "back" | "dom" | "svg" {
  if (!isValidElement(node) || typeof node.type === "string") return "svg"
  return (node.type as { chartLayer?: "back" | "dom" }).chartLayer ?? "svg"
}
export function CartesianRoot<TData extends Row>({
  chartType,
  Canvas,
  data,
  config,
  children,
  stackType = "default",
  margins: marginsProp,
  className,
  animate = true,
  animationDuration = 900,
  replayToken = 0,
  interactive = true,
  markerIndex = null,
  hovered = false,
  bloom = "off",
  bloomOnHover = false,
  onHoverChange,
  defaultSelectedDataKey = null,
  onSelectionChange,
}: CartesianChartProps<TData> & {
  chartType: ChartType
  Canvas: ComponentType
}) {
  const { ref, size } = useChartDimensions<HTMLDivElement>()
  const margins = { ...DEFAULT_MARGINS, ...marginsProp }
  const ctx = useChartController({
    chartType,
    data: data as Record<string, unknown>[],
    config,
    stackType,
    dimensions: size,
    margins,
    animate,
    animationDuration,
    replayToken,
    markerIndex,
    hovered,
    bloom,
    bloomOnHover,
    defaultSelectedDataKey,
    onSelectionChange,
  })
  const backChildren: ReactNode[] = []
  const svgChildren: ReactNode[] = []
  const domChildren: ReactNode[] = []
  Children.forEach(children, (child) => {
    const layer = layerOf(child)
    if (layer === "back") backChildren.push(child)
    else if (layer === "dom") domChildren.push(child)
    else svgChildren.push(child)
  })
  const onMove = (clientX: number) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const px = clientX - rect.left - margins.left
    const index = ctx.indexAtX(px)
    ctx.setHoverIndex(index)
    ctx.setCursorX(clientX - rect.left)
    onHoverChange?.(index)
  }
  return (
    <ChartContext value={ctx}>
      <CommonChartContext value={ctx.common}>
        <div
          ref={ref}
          className={cn("relative h-full w-full", className)}
          onPointerEnter={() => ctx.setMouseInChart(true)}
          onPointerMove={interactive ? (e) => onMove(e.clientX) : undefined}
          onPointerLeave={() => {
            ctx.setMouseInChart(false)
            ctx.setHoverIndex(null)
            onHoverChange?.(null)
          }}
        >
          {ctx.ready && backChildren.length > 0 && (
            <svg
              width={size.width}
              height={size.height}
              className="absolute inset-0 overflow-visible"
              aria-hidden
              role="presentation"
            >
              <g transform={`translate(${margins.left},${margins.top})`}>
                {backChildren}
              </g>
            </svg>
          )}
          <Canvas />
          {ctx.ready && (
            <svg
              width={size.width}
              height={size.height}
              className="absolute inset-0 overflow-visible"
              role="img"
              aria-label="Chart"
            >
              <g transform={`translate(${margins.left},${margins.top})`}>
                {svgChildren}
              </g>
            </svg>
          )}
          {domChildren}
        </div>
      </CommonChartContext>
    </ChartContext>
  )
}
export type AreaChartProps<TData extends Row> = CartesianChartProps<TData>
