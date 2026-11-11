import Link from "next/link"
import { AlertTriangle, DollarSign, MessageSquareWarning, Package, ShieldCheck, type LucideIcon } from "lucide-react"
import { Card } from "@/components/ui/card"
import { cn, formatCurrency } from "@/lib/utils"
import type { CurrencyCode } from "@/lib/currency"
import { ordenesHref } from "@/lib/ordenes/filtros-url"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActionTone = "danger" | "warning" | "info"

export interface ActionItem {
  id: string
  tone: ActionTone
  icon: LucideIcon
  label: string
  value: string
  href: string
}

export interface AdminActionInput {
  moneda: CurrencyCode
  cobrosCount: number
  deudaTotal: number
  slaVencidasCount: number
  garantiasCount: number
  /** Total de la pestaña "Reclamos abiertos" de /garantias (misma consulta). */
  reclamosAbiertosCount?: number
  stockBajoCount: number
}

// ---------------------------------------------------------------------------
// Pure helper — unit tested
// ---------------------------------------------------------------------------

export function buildAdminActions(input: AdminActionInput): ActionItem[] {
  const items: ActionItem[] = []

  if (input.cobrosCount > 0) {
    items.push({
      id: "cobros",
      tone: "danger",
      icon: DollarSign,
      label: "Cobros pendientes",
      value: `${formatCurrency(input.deudaTotal, input.moneda)} · ${input.cobrosCount} orden${input.cobrosCount !== 1 ? "es" : ""}`,
      href: ordenesHref({ filtro: "pendientesCobro" }),
    })
  }

  if (input.slaVencidasCount > 0) {
    items.push({
      id: "sla",
      tone: "danger",
      icon: AlertTriangle,
      label: "Fecha prometida vencida",
      value: `${input.slaVencidasCount} orden${input.slaVencidasCount !== 1 ? "es" : ""}`,
      href: ordenesHref({ filtro: "vencidas" }),
    })
  }

  if (input.garantiasCount > 0) {
    items.push({
      id: "garantias",
      tone: "warning",
      icon: ShieldCheck,
      label: "Garantías por vencer",
      value: `${input.garantiasCount}`,
      // El conteo del dashboard del ADMIN es de toda la org: la lista también.
      href: "/garantias?tab=por-vencer&sucursal=todas",
    })
  }

  const reclamos = input.reclamosAbiertosCount ?? 0
  if (reclamos > 0) {
    items.push({
      id: "reclamos",
      tone: "info",
      icon: MessageSquareWarning,
      label: "Reclamos abiertos",
      value: `${reclamos} reclamo${reclamos !== 1 ? "s" : ""} de garantía`,
      // Mismo alcance que el conteo (toda la org para el ADMIN).
      href: "/garantias?tab=reclamos&sucursal=todas",
    })
  }

  if (input.stockBajoCount > 0) {
    items.push({
      id: "stock",
      tone: "warning",
      icon: Package,
      label: "Stock bajo",
      value: `${input.stockBajoCount} item${input.stockBajoCount !== 1 ? "s" : ""}`,
      href: "/inventario",
    })
  }

  return items
}

// ---------------------------------------------------------------------------
// Visual tokens — mirrored from alert-item.tsx TONE map
// ---------------------------------------------------------------------------

const TONE_CHIP: Record<
  ActionTone,
  { box: string; hover: string; head: string; sub: string }
> = {
  danger: {
    box: "bg-destructive/10 border-destructive/25",
    hover: "hover:bg-destructive/15 active:bg-destructive/20",
    head: "text-destructive",
    sub: "text-destructive/85",
  },
  warning: {
    box: "bg-warning-50 border-warning/30 dark:bg-warning-100/40 dark:border-warning/20",
    hover: "hover:bg-warning-100 dark:hover:bg-warning-200/40 active:bg-warning-100 dark:active:bg-warning-200/60",
    head: "text-warning-700 dark:text-warning-600",
    sub: "text-warning-700/80 dark:text-warning-600/80",
  },
  info: {
    box: "bg-info-50 border-info/30 dark:bg-info-100/40 dark:border-info/20",
    hover: "hover:bg-info-100 dark:hover:bg-info-200/40 active:bg-info-100 dark:active:bg-info-200/60",
    head: "text-info-700 dark:text-info-500",
    sub: "text-info-600 dark:text-info-500",
  },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ActionStrip({ items }: { items: ActionItem[] }) {
  if (items.length === 0) {
    return (
      <Card className="flex items-center gap-2.5 px-4 py-3 text-sm text-muted-foreground">
        <ShieldCheck className="h-4 w-4 shrink-0 text-success" aria-hidden />
        <span>Todo en orden — no hay nada urgente.</span>
      </Card>
    )
  }

  return (
    <div
      role="list"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      {items.map((item) => {
        const Icon = item.icon
        const t = TONE_CHIP[item.tone]
        return (
          <Link
            key={item.id}
            href={item.href}
            role="listitem"
            className={cn(
              "group flex items-start gap-3 rounded-xl border p-4",
              "motion-safe:transition motion-safe:duration-150",
              "motion-safe:active:scale-[0.98]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              t.box,
              t.hover,
            )}
          >
            <Icon
              className={cn(
                "mt-0.5 h-5 w-5 shrink-0",
                "motion-safe:transition-transform motion-safe:duration-150",
                "motion-safe:[@media(hover:hover)]:group-hover:scale-110",
                t.head,
              )}
              aria-hidden
            />
            <div className="min-w-0">
              <p className={cn("text-sm font-semibold leading-tight", t.head)}>{item.label}</p>
              <p className={cn("mt-0.5 text-sm leading-snug", t.sub)}>{item.value}</p>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
