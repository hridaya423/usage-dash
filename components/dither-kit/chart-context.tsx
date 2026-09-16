"use client"
import type { ScaleLinear } from "d3-scale"
import { createContext, use, useCallback, useMemo, useState } from "react"
import type { CommonChart } from "./common-context"
import type { BloomInput } from "./dither-paint"
import type { DitherColor, Seed } from "./palette"
import { seedOfColor } from "./palette"
import {
  buildBandScale,
  buildXScale,
  buildYScale,
  computeBands,
  indexAtBand,
  nearestIndex,
  type StackType,
} from "./scales"
import type { Dimensions } from "./use-chart-dimensions"
export type ChartType = "area" | "bar" | "line" | "pie" | "radar"
export type ChartConfig = Record<string, { label?: string; color: DitherColor }>
export type Margins = {
  top: number
  right: number
  bottom: number
  left: number
}
type Row = Record<string, unknown>
export type AreaVariant = "gradient" | "dotted" | "hatched" | "solid"
export type StrokeVariant = "solid" | "dashed"
export type SeriesKind = "area" | "line" | "bar"
export type SeriesSpec = {
  dataKey: string
  kind: SeriesKind
  variant: AreaVariant
  strokeVariant: StrokeVariant
}
export type ChartContextValue = {
  chartType: ChartType
  config: ChartConfig
  configKeys: string[]
  data: Row[]
  dataLength: number
  stackType: StackType
  margins: Margins
  plot: { width: number; height: number }
  ready: boolean
  xCenter: (index: number) => number
  bandwidth: number
  indexAtX: (px: number) => number
  barSlot: (
    index: number,
    seriesIndex: number,
    seriesCount: number
  ) => { x: number; width: number }
  y: ScaleLinear<number, number>
  bands: Record<string, [number, number][]>
  max: number
  min: number
  selectedDataKey: string | null
  selectDataKey: (key: string | null) => void
  focusDataKey: string | null
  setFocusDataKey: (key: string | null) => void
  hoverIndex: number | null
  setHoverIndex: (index: number | null) => void
  markerIndex: number | null
  cursorX: number
  setCursorX: (px: number) => void
  isMouseInChart: boolean
  setMouseInChart: (over: boolean) => void
  hovered: boolean
  bloom: BloomInput
  bloomOnHover: boolean
  seriesSpecs: Record<string, SeriesSpec>
  registerSeries: (spec: SeriesSpec) => void
  unregisterSeries: (dataKey: string) => void
  animate: boolean
  animationDuration: number
  revision: number
  entranceDone: boolean
  markEntranceDone: () => void
  seedOf: (key: string) => Seed
  common: CommonChart
}
const ChartContext = createContext<ChartContextValue | null>(null)
const ROOT_OF: Record<ChartType, string> = {
  area: "<AreaChart />",
  bar: "<BarChart />",
  line: "<LineChart />",
  pie: "<PieChart />",
  radar: "<RadarChart />",
}
export function useChart() {
  const ctx = use(ChartContext)
  if (!ctx) {
    throw new Error(
      "Chart parts must be used within a chart root (e.g. <AreaChart />)."
    )
  }
  return ctx
}
export function useChartPart(
  part: string,
  kind?: ChartType | ChartType[]
): ChartContextValue {
  const ctx = use(ChartContext)
  if (!ctx) {
    const where = kind
      ? ROOT_OF[Array.isArray(kind) ? kind[0] : kind]
      : "a chart root"
    throw new Error(`<${part} /> must be used within ${where}.`)
  }
  if (kind) {
    const allowed = Array.isArray(kind) ? kind : [kind]
    if (!allowed.includes(ctx.chartType)) {
      throw new Error(
        `<${part} /> is not valid inside ${ROOT_OF[ctx.chartType]} — it belongs in ${allowed
          .map((k) => ROOT_OF[k])
          .join(" or ")}.`
      )
    }
  }
  return ctx
}
export { ChartContext }
export function useRevision(data: unknown, token: number) {
  const [prev, setPrev] = useState({ data, token, revision: 0 })
  if (prev.data !== data || prev.token !== token) {
    const next = { data, token, revision: prev.revision + 1 }
    setPrev(next)
    return next.revision
  }
  return prev.revision
}
export function useChartController({
  chartType,
  data,
  config,
  stackType,
  dimensions,
  margins,
  animate = true,
  animationDuration = 900,
  replayToken = 0,
  markerIndex = null,
  hovered = false,
  bloom = "off",
  bloomOnHover = false,
  defaultSelectedDataKey = null,
  onSelectionChange,
}: {
  chartType: ChartType
  data: Row[]
  config: ChartConfig
  stackType: StackType
  dimensions: Dimensions
  margins: Margins
  animate?: boolean
  animationDuration?: number
  replayToken?: number
  markerIndex?: number | null
  hovered?: boolean
  bloom?: BloomInput
  bloomOnHover?: boolean
  defaultSelectedDataKey?: string | null
  onSelectionChange?: (key: string | null) => void
}): ChartContextValue {
  const configKeys = useMemo(() => Object.keys(config), [config])
  const revision = useRevision(data, replayToken)
  const [selectedDataKey, setSelectedDataKey] = useState<string | null>(
    defaultSelectedDataKey
  )
  const [focusDataKey, setFocusDataKey] = useState<string | null>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [cursorX, setCursorX] = useState(0)
  const [isMouseInChart, setMouseInChart] = useState(false)
  const [seriesSpecs, setSeriesSpecs] = useState<Record<string, SeriesSpec>>({})
  const registerSeries = useCallback((spec: SeriesSpec) => {
    setSeriesSpecs((prev) => {
      const cur = prev[spec.dataKey]
      return cur &&
        cur.kind === spec.kind &&
        cur.variant === spec.variant &&
        cur.strokeVariant === spec.strokeVariant
        ? prev
        : { ...prev, [spec.dataKey]: spec }
    })
  }, [])
  const unregisterSeries = useCallback((dataKey: string) => {
    setSeriesSpecs((prev) => {
      if (!(dataKey in prev)) return prev
      const next = { ...prev }
      delete next[dataKey]
      return next
    })
  }, [])
  const selectDataKey = useCallback(
    (key: string | null) => {
      setSelectedDataKey(key)
      onSelectionChange?.(key)
    },
    [onSelectionChange]
  )
  const { top: mTop, right: mRight, bottom: mBottom, left: mLeft } = margins
  const stableMargins = useMemo(
    () => ({ top: mTop, right: mRight, bottom: mBottom, left: mLeft }),
    [mTop, mRight, mBottom, mLeft]
  )
  const plotWidth = Math.max(0, dimensions.width - mLeft - mRight)
  const plotHeight = Math.max(0, dimensions.height - mTop - mBottom)
  const ready = plotWidth > 0 && plotHeight > 0
  const [entrance, setEntrance] = useState({ revision, done: !animate })
  if (entrance.revision !== revision) {
    setEntrance({ revision, done: !animate })
  }
  const entranceDone = entrance.revision === revision ? entrance.done : !animate
  const markEntranceDone = useCallback(
    () => setEntrance({ revision, done: true }),
    [revision]
  )
  const { bands, max, min } = useMemo(
    () => computeBands(data, configKeys, stackType),
    [data, configKeys, stackType]
  )
  const isBar = chartType === "bar"
  const xPoint = useMemo(
    () => buildXScale(data.length, plotWidth),
    [data.length, plotWidth]
  )
  const xBand = useMemo(
    () => buildBandScale(data.length, plotWidth),
    [data.length, plotWidth]
  )
  const bandwidth = isBar ? xBand.bandwidth() : 0
  const xCenter = useCallback(
    (i: number) =>
      isBar ? (xBand(i) ?? 0) + xBand.bandwidth() / 2 : (xPoint(i) ?? 0),
    [isBar, xBand, xPoint]
  )
  const indexAtX = useCallback(
    (px: number) =>
      isBar
        ? indexAtBand(px, data.length, plotWidth)
        : nearestIndex(px, data.length, plotWidth),
    [isBar, data.length, plotWidth]
  )
  const stacked = stackType === "stacked" || stackType === "percent"
  const barSlot = useCallback(
    (i: number, si: number, n: number) => {
      const center = xCenter(i)
      if (stacked) {
        const w = bandwidth * 0.9
        return { x: center - w / 2, width: w }
      }
      const slot = bandwidth / Math.max(n, 1)
      return {
        x: center - bandwidth / 2 + si * slot + slot * 0.08,
        width: slot * 0.84,
      }
    },
    [xCenter, stacked, bandwidth]
  )
  const y = useMemo(
    () => buildYScale(min, max, plotHeight),
    [min, max, plotHeight]
  )
  const seedOf = useCallback(
    (key: string) => seedOfColor(config[key]?.color ?? "grey"),
    [config]
  )
  const common: CommonChart = useMemo(() => ({
    names: configKeys,
    labelOf: (n) => config[n]?.label ?? n,
    seedOf,
    selectedDataKey,
    selectDataKey,
    focusDataKey,
    setFocusDataKey,
    hoverIndex,
    ready,
    tooltipLeft: Math.max(48, Math.min(plotWidth + mLeft - 48, cursorX)),
    tooltipTop: (() => {
      const floor = mTop + 44
      if (hoverIndex == null) return floor
      let minY = Number.POSITIVE_INFINITY
      for (const key of configKeys) {
        const b = bands[key]?.[hoverIndex]
        if (b) minY = Math.min(minY, y(b[1]))
      }
      if (!Number.isFinite(minY)) return floor
      return Math.max(floor, mTop + minY)
    })(),
    heading: (i, labelKey) =>
      labelKey ? String(data[i]?.[labelKey] ?? "") : null,
    itemsAt: (i) =>
      configKeys.map((name) => {
        const raw = data[i]?.[name]
        return {
          name,
          label: config[name]?.label ?? name,
          value: typeof raw === "number" ? raw : 0,
          seed: seedOf(name),
          dimmed: (() => {
            const emphasis = selectedDataKey ?? focusDataKey
            return emphasis !== null && emphasis !== name
          })(),
        }
      }),
  }), [
    configKeys,
    config,
    seedOf,
    selectedDataKey,
    selectDataKey,
    focusDataKey,
    setFocusDataKey,
    hoverIndex,
    ready,
    plotWidth,
    mLeft,
    mTop,
    cursorX,
    bands,
    y,
    data,
  ])
  return useMemo<ChartContextValue>(
    () => ({
      chartType,
      config,
      configKeys,
      data,
      dataLength: data.length,
      stackType,
      margins: stableMargins,
      plot: { width: plotWidth, height: plotHeight },
      ready,
      xCenter,
      bandwidth,
      indexAtX,
      barSlot,
      y,
      bands,
      max,
      min,
      selectedDataKey,
      selectDataKey,
      focusDataKey,
      setFocusDataKey,
      hoverIndex,
      setHoverIndex,
      markerIndex,
      cursorX,
      setCursorX,
      isMouseInChart,
      setMouseInChart,
      hovered,
      bloom,
      bloomOnHover,
      seriesSpecs,
      registerSeries,
      unregisterSeries,
      animate,
      animationDuration,
      revision,
      entranceDone,
      markEntranceDone,
      seedOf,
      common,
    }),
    [
      chartType,
      config,
      configKeys,
      data,
      stackType,
      stableMargins,
      plotWidth,
      plotHeight,
      ready,
      xCenter,
      bandwidth,
      indexAtX,
      barSlot,
      y,
      bands,
      max,
      min,
      selectedDataKey,
      selectDataKey,
      focusDataKey,
      setFocusDataKey,
      hoverIndex,
      setHoverIndex,
      markerIndex,
      cursorX,
      setCursorX,
      isMouseInChart,
      setMouseInChart,
      hovered,
      bloom,
      bloomOnHover,
      seriesSpecs,
      registerSeries,
      unregisterSeries,
      animate,
      animationDuration,
      revision,
      entranceDone,
      markEntranceDone,
      seedOf,
      common,
    ]
  )
}
