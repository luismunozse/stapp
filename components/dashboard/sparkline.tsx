import { cn } from "@/lib/utils"

/**
 * Pure helper: maps numeric data to an SVG polyline `points` string.
 * Max value sits at y=0 (top), min at y=height (bottom). Flat input centers.
 */
export function sparklinePoints(data: number[], width: number, height: number): string {
  if (data.length === 0) return ""
  if (data.length === 1) return `0,${height / 2}`

  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min
  const stepX = width / (data.length - 1)

  return data
    .map((value, i) => {
      const x = i * stepX
      const y = range === 0 ? height / 2 : height - ((value - min) / range) * height
      return `${x},${y}`
    })
    .join(" ")
}

export function Sparkline({
  data,
  width = 280,
  height = 40,
  className,
}: {
  data: number[]
  width?: number
  height?: number
  className?: string
}) {
  const points = sparklinePoints(data, width, height)
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("text-primary", className)}
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
