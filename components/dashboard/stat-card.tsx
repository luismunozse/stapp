import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export type StatTone = "default" | "info" | "success" | "warning" | "danger"

export interface StatChange {
  pct: number
  direction: "up" | "down" | "neutral"
}

export interface StatCardProps {
  title: string
  value: string
  description?: string
  icon: LucideIcon
  /** Semantic tone — drives the icon chip and the urgent ring. Avoids the
   *  per-stat rainbow of hardcoded purple/cyan/orange colors. */
  tone?: StatTone
  /** Raises the card's prominence (ring + border) without a side-stripe. */
  urgent?: boolean
  href?: string
  /** Month-over-month change. `null` renders the "sin datos" hint. */
  change?: StatChange | null
  /** Demoted visual treatment for secondary KPIs (smaller padding + value). */
  compact?: boolean
}

// Icon-chip tint per tone, mapped to the semantic token scales (no ad-hoc hues).
const TONE_CHIP: Record<StatTone, string> = {
  default: "bg-accent text-primary",
  info: "bg-info-50 text-info-600 dark:bg-info-100/50 dark:text-info-500",
  success:
    "bg-success-50 text-success-600 dark:bg-success-100/50 dark:text-success-500",
  warning:
    "bg-warning-50 text-warning-600 dark:bg-warning-100/50 dark:text-warning-600",
  danger: "bg-destructive/10 text-destructive",
}

// Urgent ring per tone — a calm ring instead of the banned border-left stripe.
const TONE_RING: Record<StatTone, string> = {
  default: "ring-primary/15",
  info: "ring-info/20",
  success: "ring-success/20",
  warning: "ring-warning/25",
  danger: "ring-destructive/25",
}

export function StatCard({
  title,
  value,
  description,
  icon: Icon,
  tone = "default",
  urgent = false,
  href,
  change,
  compact = false,
}: StatCardProps) {
  const card = (
    <Card
      className={cn(
        compact
          ? "group h-full p-3 transition-all duration-200 sm:p-4"
          : "group h-full p-3 transition-all duration-200 sm:p-5",
        href && "cursor-pointer hover:-translate-y-0.5 hover:shadow-md",
        urgent && cn("ring-1", TONE_RING[tone])
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground sm:text-sm">
          {title}
        </p>
        <span
          className={cn(
            "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg",
            TONE_CHIP[tone]
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>

      <p className={cn(compact ? "mt-2 text-xl font-semibold tabular-nums tracking-tight text-foreground sm:text-2xl" : "mt-2 text-2xl font-semibold tabular-nums tracking-tight text-foreground sm:text-3xl")}>
        {value}
      </p>

      {description && (
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      )}

      {change ? (
        <p
          className={cn(
            "mt-2 inline-flex items-center gap-1 text-xs font-medium",
            change.direction === "up"
              ? "text-success-600 dark:text-success-500"
              : change.direction === "down"
                ? "text-destructive"
                : "text-muted-foreground"
          )}
        >
          {change.direction === "up"
            ? "↑"
            : change.direction === "down"
              ? "↓"
              : "→"}{" "}
          {change.pct}% vs. mes anterior
        </p>
      ) : change === null ? (
        <p className="mt-2 text-xs text-muted-foreground/60">
          — sin datos anteriores
        </p>
      ) : null}

      {href && (
        <p className="mt-2 text-xs text-muted-foreground/0 transition-colors duration-200 group-hover:text-muted-foreground">
          Ver detalle →
        </p>
      )}
    </Card>
  )

  return href ? (
    <Link href={href} className="block">
      {card}
    </Link>
  ) : (
    card
  )
}
