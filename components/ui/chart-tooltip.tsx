"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Contenido de tooltip para recharts con los colores del tema (popover,
 * foreground, border): el default de recharts es blanco fijo y en modo oscuro
 * queda un recuadro blanco con texto gris claro.
 *
 * Uso: `<Tooltip content={<ChartTooltipContent />} formatter={…} />`. La grilla,
 * los ejes y el cursor toman el tema desde app/globals.css (`.recharts-*`).
 * Recharts le pasa al contenido sus propias props, así que `formatter` y
 * `labelFormatter` del `<Tooltip>` funcionan igual que con el tooltip default:
 * `formatter` puede devolver el valor o `[valor, nombre]`.
 */

type Formatted = ReactNode | [ReactNode, ReactNode]

interface PayloadItem {
  name?: string | number
  value?: number | string | Array<number | string>
  color?: string
  fill?: string
  dataKey?: string | number
  type?: string
  payload?: Record<string, unknown>
}

export interface ChartTooltipContentProps {
  active?: boolean
  payload?: PayloadItem[]
  label?: ReactNode
  // Firmas laxas a propósito: son las del <Tooltip> de recharts, que cada
  // gráfico tipa a su manera.
  formatter?: (value: any, name: any, item: any, index: number, payload: any) => Formatted
  labelFormatter?: (label: any, payload: any) => ReactNode
  /** Oculta el título (útil en tortas, donde el nombre ya va en cada fila). */
  hideLabel?: boolean
  className?: string
}

function colorDe(item: PayloadItem): string | undefined {
  const p = item.payload
  return (
    item.color ??
    item.fill ??
    (typeof p?.fill === "string" ? p.fill : undefined) ??
    (typeof p?.color === "string" ? p.color : undefined)
  )
}

export function ChartTooltipContent({
  active,
  payload,
  label,
  formatter,
  labelFormatter,
  hideLabel,
  className,
}: ChartTooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null

  const items = payload.filter((item) => item.type !== "none")
  const titulo = hideLabel ? null : labelFormatter ? labelFormatter(label, payload) : label

  return (
    <div
      className={cn(
        "rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md",
        className
      )}
    >
      {titulo !== null && titulo !== undefined && titulo !== "" && (
        <p className="mb-1 font-medium">{titulo}</p>
      )}
      <ul className="space-y-0.5">
        {items.map((item, index) => {
          const crudo = formatter
            ? formatter(item.value, item.name, item, index, payload)
            : (item.value as ReactNode)
          const [valor, nombre] = Array.isArray(crudo) ? crudo : [crudo, item.name]
          const color = colorDe(item)
          return (
            <li key={`${item.dataKey ?? item.name ?? index}`} className="flex items-center gap-2">
              {color && (
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: color }}
                />
              )}
              {nombre !== null && nombre !== undefined && nombre !== "" && (
                <span className="text-muted-foreground">{nombre}</span>
              )}
              <span className="ml-auto font-medium tabular-nums">{valor}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
