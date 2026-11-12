import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { StatusTone } from "@/lib/status-tone"

export type { StatusTone } from "@/lib/status-tone"

/**
 * Clases por tono. Todas son "soft": fondo tintado y texto en tono 700 (300 en
 * oscuro), que da ≥4,5:1 en los dos modos. Los tonos semánticos usan los tokens
 * `success/warning/info-{50,200,700}`, que ya se invierten en `.dark`.
 *
 * - `text`/`bg`/`border`: para armar superficies propias (tarjeta del
 *   seguimiento, íconos en recuadro) con el mismo color que la píldora.
 * - `dot`: relleno sólido para puntos y barras (no lleva texto encima).
 */
export const STATUS_TONE_CLASSES: Record<
  StatusTone,
  { text: string; bg: string; border: string; dot: string }
> = {
  neutral: {
    text: "text-slate-700 dark:text-slate-300",
    bg: "bg-slate-100 dark:bg-slate-500/15",
    border: "border-slate-200 dark:border-slate-500/30",
    dot: "bg-slate-500",
  },
  muted: {
    text: "text-muted-foreground",
    bg: "bg-background",
    border: "border-border",
    dot: "bg-slate-400",
  },
  info: {
    text: "text-info-700",
    bg: "bg-info-50",
    border: "border-info-200",
    dot: "bg-info-500",
  },
  success: {
    text: "text-success-700",
    bg: "bg-success-50",
    border: "border-success-200",
    dot: "bg-success-500",
  },
  warning: {
    text: "text-warning-700",
    bg: "bg-warning-50",
    border: "border-warning-200",
    dot: "bg-warning-500",
  },
  danger: {
    text: "text-red-700 dark:text-red-300",
    bg: "bg-red-50 dark:bg-red-500/15",
    border: "border-red-200 dark:border-red-500/30",
    dot: "bg-red-500",
  },
  violet: {
    text: "text-violet-700 dark:text-violet-300",
    bg: "bg-violet-50 dark:bg-violet-500/15",
    border: "border-violet-200 dark:border-violet-500/30",
    dot: "bg-violet-500",
  },
  orange: {
    text: "text-orange-700 dark:text-orange-300",
    bg: "bg-orange-50 dark:bg-orange-500/15",
    border: "border-orange-200 dark:border-orange-500/30",
    dot: "bg-orange-500",
  },
  pink: {
    text: "text-pink-700 dark:text-pink-300",
    bg: "bg-pink-50 dark:bg-pink-500/15",
    border: "border-pink-200 dark:border-pink-500/30",
    dot: "bg-pink-500",
  },
  cyan: {
    text: "text-cyan-700 dark:text-cyan-300",
    bg: "bg-cyan-50 dark:bg-cyan-500/15",
    border: "border-cyan-200 dark:border-cyan-500/30",
    dot: "bg-cyan-500",
  },
  teal: {
    text: "text-teal-700 dark:text-teal-300",
    bg: "bg-teal-50 dark:bg-teal-500/15",
    border: "border-teal-200 dark:border-teal-500/30",
    dot: "bg-teal-500",
  },
  emerald: {
    text: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-emerald-50 dark:bg-emerald-500/15",
    border: "border-emerald-200 dark:border-emerald-500/30",
    dot: "bg-emerald-500",
  },
}

/** Clases completas de la píldora para un tono (para `<Badge className>` o `<span>` sueltos). */
export function statusToneClasses(tone: StatusTone): string {
  const t = STATUS_TONE_CLASSES[tone]
  return cn(t.text, t.bg, t.border)
}

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone: StatusTone
  /** Ícono opcional: el estado nunca debería depender solo del color. */
  icon?: LucideIcon | React.ComponentType<{ className?: string }>
  size?: "sm" | "md"
}

/**
 * Píldora de estado genérica, por tono. Sirve para órdenes, ventas, pagos,
 * garantías, cotizaciones, compras, tickets… La semántica (qué estado va con qué
 * tono) vive en cada dominio, por ejemplo `lib/estado-orden-ui.ts`.
 */
export const StatusPill = React.forwardRef<HTMLSpanElement, StatusPillProps>(
  function StatusPill({ tone, icon: Icon, size = "md", className, children, ...props }, ref) {
    return (
      <span
        ref={ref}
        data-tone={tone}
        className={cn(
          "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold text-xs",
          size === "sm" ? "px-2 py-0" : "px-2.5 py-0.5",
          statusToneClasses(tone),
          className
        )}
        {...props}
      >
        {Icon && <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />}
        {children}
      </span>
    )
  }
)
