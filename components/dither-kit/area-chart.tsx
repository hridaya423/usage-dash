"use client"
import { CartesianCanvas } from "./cartesian-canvas"
import { type CartesianChartProps, CartesianRoot } from "./cartesian-root"
type Row = object
export function AreaChart<TData extends Row>(
  props: CartesianChartProps<TData>
) {
  return <CartesianRoot chartType="area" Canvas={CartesianCanvas} {...props} />
}
export function LineChart<TData extends Row>(
  props: CartesianChartProps<TData>
) {
  return <CartesianRoot chartType="line" Canvas={CartesianCanvas} {...props} />
}
export type AreaChartProps<TData extends Row> = CartesianChartProps<TData>
