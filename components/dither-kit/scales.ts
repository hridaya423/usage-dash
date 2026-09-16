import { scaleBand, scaleLinear, scalePoint } from "d3-scale"
import { stack as d3Stack, stackOffsetExpand } from "d3-shape"
export type StackType = "default" | "stacked" | "percent"
type Row = Record<string, unknown>
const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : 0
export function computeBands(
  data: Row[],
  keys: string[],
  stackType: StackType
): { bands: Record<string, [number, number][]>; max: number; min: number } {
  if (stackType === "default") {
    const bands: Record<string, [number, number][]> = {}
    let max = 0
    let min = 0
    for (const key of keys) {
      bands[key] = data.map((row) => {
        const v = num(row[key])
        if (v > max) max = v
        if (v < min) min = v
        return [0, v]
      })
    }
    const flat = max === 0 && min === 0
    return { bands, max: flat ? 1 : max, min }
  }
  const series = d3Stack<Row>()
    .keys(keys)
    .value((row, key) => num(row[key]))
    .offset(stackType === "percent" ? stackOffsetExpand : (undefined as never))(
    data
  )
  const bands: Record<string, [number, number][]> = {}
  let max = 0
  let min = 0
  series.forEach((layer) => {
    bands[layer.key] = layer.map((point) => {
      if (point[1] > max) max = point[1]
      if (point[0] < min) min = point[0]
      return [point[0], point[1]]
    })
  })
  const flat = max === 0 && min === 0
  return { bands, max: flat ? 1 : max, min }
}
export function buildXScale(length: number, plotWidth: number) {
  return scalePoint<number>()
    .domain(Array.from({ length }, (_, i) => i))
    .range([0, plotWidth])
}
export function buildBandScale(length: number, plotWidth: number) {
  return scaleBand<number>()
    .domain(Array.from({ length }, (_, i) => i))
    .range([0, plotWidth])
    .paddingInner(0.28)
    .paddingOuter(0.18)
}
export function indexAtBand(px: number, length: number, plotWidth: number) {
  if (length <= 0 || plotWidth <= 0) return 0
  const t = Math.max(0, Math.min(0.999, px / plotWidth))
  return Math.min(length - 1, Math.floor(t * length))
}
export function buildYScale(min: number, max: number, plotHeight: number) {
  const lo = Math.min(0, min)
  const hi = Math.max(0, max)
  return scaleLinear()
    .domain([lo, hi === lo ? lo + 1 : hi])
    .nice()
    .range([plotHeight, 0])
}
export function nearestIndex(px: number, length: number, plotWidth: number) {
  if (length <= 1 || plotWidth <= 0) return 0
  const t = Math.max(0, Math.min(1, px / plotWidth))
  return Math.round(t * (length - 1))
}
