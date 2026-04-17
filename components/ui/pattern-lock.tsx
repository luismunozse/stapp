"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { cn } from "@/lib/utils"
import { RotateCcw } from "lucide-react"
import { Button } from "./button"

interface PatternLockProps {
  value?: string
  onChange?: (pattern: string) => void
  size?: number
  disabled?: boolean
  className?: string
}

// Los puntos están numerados del 1 al 9:
// 1 2 3
// 4 5 6
// 7 8 9

export function PatternLock({
  value = "",
  onChange,
  size = 180,
  disabled = false,
  className,
}: PatternLockProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [pattern, setPattern] = useState<number[]>([])
  const [isDrawing, setIsDrawing] = useState(false)
  const [currentPoint, setCurrentPoint] = useState<{ x: number; y: number } | null>(null)

  const dotSize = size / 6
  const padding = size / 6
  const spacing = (size - 2 * padding) / 2

  // Posiciones de los 9 puntos
  const getPointPosition = useCallback((index: number) => {
    const row = Math.floor(index / 3)
    const col = index % 3
    return {
      x: padding + col * spacing,
      y: padding + row * spacing,
    }
  }, [padding, spacing])

  // Encontrar qué punto está cerca de una posición
  // Threshold chico (0.6 * dotSize) para no enganchar puntos laterales al trazar diagonales
  const findNearestPoint = useCallback((x: number, y: number): number | null => {
    const threshold = dotSize * 0.6
    let closestIdx: number | null = null
    let closestDist = threshold
    for (let i = 0; i < 9; i++) {
      const pos = getPointPosition(i)
      const distance = Math.sqrt(Math.pow(x - pos.x, 2) + Math.pow(y - pos.y, 2))
      if (distance < closestDist) {
        closestDist = distance
        closestIdx = i + 1
      }
    }
    return closestIdx
  }, [dotSize, getPointPosition])

  // Si entre A y B hay un punto colineal (horizontal, vertical o diagonal), devolverlo
  const getIntermediatePoint = (a: number, b: number): number | null => {
    const rA = Math.floor((a - 1) / 3), cA = (a - 1) % 3
    const rB = Math.floor((b - 1) / 3), cB = (b - 1) % 3
    const dr = rB - rA, dc = cB - cA
    if (Math.abs(dr) <= 1 && Math.abs(dc) <= 1) return null
    if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) return null
    const mr = (rA + rB) / 2, mc = (cA + cB) / 2
    if (!Number.isInteger(mr) || !Number.isInteger(mc)) return null
    return mr * 3 + mc + 1
  }

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
      ctx.lineWidth = 3
      ctx.lineCap = "round"
      ctx.lineJoin = "round"
      ctx.beginPath()

      const firstPos = getPointPosition(pattern[0] - 1)
      ctx.moveTo(firstPos.x, firstPos.y)

      for (let i = 1; i < pattern.length; i++) {
        const pos = getPointPosition(pattern[i] - 1)
        ctx.lineTo(pos.x, pos.y)
      }

      // Línea al punto actual mientras se dibuja
      if (isDrawing && currentPoint) {
        ctx.lineTo(currentPoint.x, currentPoint.y)
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
      ctx.arc(pos.x, pos.y, dotSize / 2, 0, Math.PI * 2)
      ctx.fillStyle = isSelected ? "#3b82f6" : "#e5e7eb"
      ctx.fill()

      // Círculo interior
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, dotSize / 4, 0, Math.PI * 2)
      ctx.fillStyle = isSelected ? "#1d4ed8" : "#9ca3af"
      ctx.fill()
    }
  }, [pattern, isDrawing, currentPoint, size, dotSize, getPointPosition])

  useEffect(() => {
    draw()
  }, [draw])

  // Parsear valor inicial
  useEffect(() => {
    if (value && value.startsWith("Patrón: ")) {
      const patternStr = value.replace("Patrón: ", "")
      const nums = patternStr.split("-").map(Number).filter(n => n >= 1 && n <= 9)
      if (nums.length > 0) {
        setPattern(nums)
      }
    }
  }, [])

  const getEventPosition = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return null

    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height

    if ("touches" in e) {
      const touch = e.touches[0]
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      }
    } else {
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      }
    }
  }

  const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (disabled) return
    e.preventDefault()

    const pos = getEventPosition(e)
    if (!pos) return

    const point = findNearestPoint(pos.x, pos.y)
    if (point) {
      setIsDrawing(true)
      setPattern([point])
      setCurrentPoint(pos)
    }
  }

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || disabled) return
    e.preventDefault()

    const pos = getEventPosition(e)
    if (!pos) return

    setCurrentPoint(pos)

    const point = findNearestPoint(pos.x, pos.y)
    if (point && !pattern.includes(point)) {
      setPattern((prev) => {
        const last = prev[prev.length - 1]
        const mid = last ? getIntermediatePoint(last, point) : null
        if (mid && !prev.includes(mid)) {
          return [...prev, mid, point]
        }
        return [...prev, point]
      })
    }
  }

  const handleEnd = () => {
    if (!isDrawing) return

    setIsDrawing(false)
    setCurrentPoint(null)

    if (pattern.length > 0 && onChange) {
      const patternStr = `Patrón: ${pattern.join("-")}`
      onChange(patternStr)
    }
  }

  const handleClear = () => {
    setPattern([])
    if (onChange) {
      onChange("")
    }
  }

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <div
        ref={containerRef}
        className={cn(
          "relative bg-gray-50 rounded-lg border-2 border-dashed",
          disabled && "opacity-50 cursor-not-allowed",
          !disabled && "cursor-pointer"
        )}
        style={{ width: size, height: size }}
      >
        <canvas
          ref={canvasRef}
          width={size}
          height={size}
          onMouseDown={handleStart}
          onMouseMove={handleMove}
          onMouseUp={handleEnd}
          onMouseLeave={handleEnd}
          onTouchStart={handleStart}
          onTouchMove={handleMove}
          onTouchEnd={handleEnd}
          className="touch-none"
        />
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {pattern.length > 0 ? (
          <>
            <span>Patrón: {pattern.join("-")}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClear}
              className="h-6 px-2"
              disabled={disabled}
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Limpiar
            </Button>
          </>
        ) : (
          <span>Dibuja conectando los puntos</span>
        )}
      </div>
    </div>
  )
}
