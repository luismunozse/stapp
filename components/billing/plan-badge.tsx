"use client"

import Link from "next/link"
import { Crown, Sparkles, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import { useSubscription } from "@/hooks/use-subscription"

interface PlanBadgeProps {
  className?: string
  // En desktop colapsado: mostrar solo icono. En sidebar expandido: con label.
  compact?: boolean
}

export function PlanBadge({ className, compact = false }: PlanBadgeProps) {
  const { planNombre, planTipo, isPremium, loading } = useSubscription()

  if (loading) return null

  // Profesional pago: badge dorado con Crown
  if (isPremium && planTipo === "PREMIUM") {
    return (
      <Link
        href="/configuracion/billing"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
          "bg-gradient-to-r from-amber-100 to-yellow-100 dark:from-amber-900/40 dark:to-yellow-900/40",
          "text-amber-900 dark:text-amber-200 border border-amber-300/60 dark:border-amber-700/60",
          "hover:from-amber-200 hover:to-yellow-200 dark:hover:from-amber-900/60 dark:hover:to-yellow-900/60",
          "transition-colors shrink-0",
          className
        )}
        title={`Plan ${planNombre}`}
      >
        <Crown className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
        {!compact && <span>{planNombre}</span>}
      </Link>
    )
  }

  // Free: badge gris con CTA upgrade
  return (
    <Link
      href="/configuracion/billing"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        "bg-muted text-muted-foreground border border-border",
        "hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-colors shrink-0",
        className
      )}
      title="Plan Free — Actualizar a Profesional"
    >
      <Sparkles className="h-3.5 w-3.5 shrink-0" />
      {!compact && (
        <>
          <span>Free</span>
          <Zap className="h-3 w-3 ml-0.5 opacity-60" />
        </>
      )}
    </Link>
  )
}
