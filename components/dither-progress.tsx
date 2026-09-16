"use client"
import { useEffect, useRef } from "react"
import { PALETTE, type DitherColor } from "@/components/dither-kit/palette"
import { BAYER4 } from "@/components/dither-kit/pixel"

const EDGE = 28

function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  progress: number | null,
  color: DitherColor,
  t: number
) {
  ctx.clearRect(0, 0, w, h)
  const [r, g, b] = PALETTE[color].line
  const solid = PALETTE[color].fill
  if (progress === null) {
    const band = w * 0.35
    const cycle = w + band
    const head = ((t / 1400) % 1) * cycle - band
    for (let x = Math.max(0, Math.floor(head)); x < Math.min(w, head + band); x++) {
      const edgeIn = Math.min(1, (x - head) / EDGE)
      const edgeOut = Math.min(1, (head + band - x) / EDGE)
      const density = Math.min(edgeIn, edgeOut)
      for (let y = 0; y < h; y++) {
        if (BAYER4[y & 3][x & 3] < density) {
          ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(1, density * 1.4)})`
          ctx.fillRect(x, y, 1, 1)
        }
      }
    }
    return
  }
  const end = Math.round(w * Math.min(1, Math.max(0, progress)))
  const edgeStart = Math.max(0, end - EDGE)
  ctx.fillStyle = `rgb(${solid[0]},${solid[1]},${solid[2]})`
  ctx.fillRect(0, 0, edgeStart, h)
  for (let x = edgeStart; x < end; x++) {
    const density = 1 - (x - edgeStart) / EDGE
    for (let y = 0; y < h; y++) {
      if (BAYER4[y & 3][x & 3] < density) {
        ctx.fillStyle = `rgba(${r},${g},${b},1)`
        ctx.fillRect(x, y, 1, 1)
      }
    }
  }
}

export function DitherProgress({
  progress,
  color = "orange",
  height = 3,
  className = "",
}: {
  progress: number | null
  color?: DitherColor
  height?: number
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const shown = useRef(0)
  const target = useRef(0)
  const raf = useRef(0)
  const indeterminate = progress === null
  target.current = progress ?? 1

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    let alive = true

    const paint = (t: number) => {
      const w = canvas.clientWidth
      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== Math.round(w * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(height * dpr)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
      if (indeterminate) {
        draw(ctx, w, height, null, color, t)
        if (alive && !reduced) raf.current = requestAnimationFrame(paint)
      } else {
        if (reduced || shown.current > target.current) shown.current = target.current
        shown.current += (target.current - shown.current) * 0.09
        if (Math.abs(target.current - shown.current) < 0.001) shown.current = target.current
        draw(ctx, w, height, shown.current, color, t)
        if (alive && shown.current !== target.current && !reduced) {
          raf.current = requestAnimationFrame(paint)
        }
      }
    }
    raf.current = requestAnimationFrame(paint)
    const onResize = () => paint(performance.now())
    window.addEventListener("resize", onResize)
    return () => {
      alive = false
      cancelAnimationFrame(raf.current)
      window.removeEventListener("resize", onResize)
    }
  }, [indeterminate, color, height, progress])

  return (
    <canvas
      ref={canvasRef}
      className={`block w-full ${className}`}
      style={{ height }}
      aria-hidden
    />
  )
}
