import { ArrowDown, ArrowUp, Minus } from "lucide-react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { Sparkline } from "@/components/dashboard/sparkline"
import type { StatChange } from "@/components/dashboard/stat-card"

interface HeroMetricProps {
  title: string
  value: string
  change?: StatChange | null
  secondaryLabel: string
  secondaryValue: string
  sparkline: number[]
}

export function HeroMetric({
  title,
  value,
  change,
  secondaryLabel,
  secondaryValue,
  sparkline,
}: HeroMetricProps) {
  return (
    <Card className="p-5 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        {/* Left column: label → hero number → delta chip → secondary */}
        <div className="min-w-0 flex-1">
          {/* Refined cap label — widest tracking for quiet authority */}
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {title}
          </p>

          {/* Hero number + delta on the same baseline row */}
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-2">
            {/*
             * tabular-nums prevents layout shift as digits change.
             * tracking-tight counters the looser default letterspacing
             * at large sizes so digits feel cohesive, not floating.
             */}
            <span className="text-4xl font-bold tracking-tight tabular-nums text-foreground sm:text-5xl lg:text-6xl">
              {value}
            </span>

            {/* Delta chip — pill shape + semantic bg tint (Emil: unseen details compound) */}
            {change && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                  change.direction === "up" &&
                    "bg-success/10 text-success-600 dark:text-success-500",
                  change.direction === "down" &&
                    "bg-destructive/10 text-destructive",
                  change.direction === "neutral" &&
                    "bg-muted text-muted-foreground"
                )}
              >
                {change.direction === "up" && (
                  <ArrowUp className="h-3 w-3 flex-shrink-0" />
                )}
                {change.direction === "down" && (
                  <ArrowDown className="h-3 w-3 flex-shrink-0" />
                )}
                {change.direction === "neutral" && (
                  <Minus className="h-3 w-3 flex-shrink-0" />
                )}
                {change.pct}% vs mes anterior
              </span>
            )}

            {/* Explicit null → no prior data */}
            {change === null && (
              <span className="text-xs text-muted-foreground/60">
                — sin datos anteriores
              </span>
            )}
          </div>

          {/* Secondary stat: muted label + prominent value */}
          <p className="mt-2.5 text-sm text-muted-foreground">
            {secondaryLabel}:{" "}
            <span className="font-semibold text-foreground">
              {secondaryValue}
            </span>
          </p>
        </div>

        {/* Right column: sparkline */}
        {sparkline.length > 0 && (
          <Sparkline
            data={sparkline}
            className="mt-2 h-14 w-full max-w-[260px] flex-shrink-0 sm:mt-0 sm:w-[200px] lg:w-[260px]"
          />
        )}
      </div>
    </Card>
  )
}
