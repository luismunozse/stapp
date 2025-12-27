"use client"

import { useRef, useEffect, useCallback } from "react"
import { cn } from "@/lib/utils"

interface PatternDisplayProps {
  value: string // "Patrón: 1-2-3-5-7"
  size?: number
  className?: string
}

// Parsear el patrón del string
function parsePattern(value: string): number[] {
  if (!value) return []

  // Si es "Patrón: 1-2-3-5-7"
  if (value.startsWith("Patrón: ")) {
    const patternStr = value.replace("Patrón: ", "")
    return patternStr.split("-").map(Number).filter(n => n >= 1 && n <= 9)
  }

  return []
}

export function PatternDisplay({
  value,
  size = 100,
  className,
}: PatternDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const dotSize = size / 6
  const padding = size / 6
  const spacing = (size - 2 * padding) / 2

  const pattern = parsePattern(value)

  // Posiciones de los 9 puntos
  const getPointPosition = useCallback((index: number) => {
    const row = Math.floor(index / 3)
    const col = index % 3
    return {
      x: padding + col * spacing,
      y: padding + row * spacing,
    }
  }, [padding, spacing])

  // Dibujar el canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Limpiar canvas
    ctx.clearRect(0, 0, size, size)

    // Dibujar líneas del patrón
    if (pattern.length > 0) {
      ctx.strokeStyle = "#3b82f6"
      ctx.lineWidth = 2
      ctx.lineCap = "round"
      ctx.lineJoin = "round"
      ctx.beginPath()

      const firstPos = getPointPosition(pattern[0] - 1)
      ctx.moveTo(firstPos.x, firstPos.y)

      for (let i = 1; i < pattern.length; i++) {
        const pos = getPointPosition(pattern[i] - 1)
        ctx.lineTo(pos.x, pos.y)
      }

      ctx.stroke()
    }

    // Dibujar los 9 puntos
    for (let i = 0; i < 9; i++) {
      const pos = getPointPosition(i)
      const pointNum = i + 1
      const isSelected = pattern.includes(pointNum)

      // Círculo exterior
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, dotSize / 2.5, 0, Math.PI * 2)
      ctx.fillStyle = isSelected ? "#3b82f6" : "#e5e7eb"
      ctx.fill()

      // Círculo interior
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, dotSize / 5, 0, Math.PI * 2)
      ctx.fillStyle = isSelected ? "#1d4ed8" : "#9ca3af"
      ctx.fill()
    }
  }, [pattern, size, dotSize, getPointPosition])

  useEffect(() => {
    draw()
  }, [draw])

  if (pattern.length === 0) {
    return null
  }

  return (
    <div className={cn("inline-block", className)}>
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        className="bg-gray-50 rounded border"
      />
    </div>
  )
}

// Exportar función para uso en otros lugares (ej: generar imagen para PDF)
export { parsePattern }
