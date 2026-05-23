"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Clock, Sparkles, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface TrialBannerProps {
  daysRemaining: number
  planNombre?: string
}

const BANNER_DISMISS_KEY = "trial-banner-dismissed"
const DISMISS_DURATION_HOURS = 24

export function TrialBanner({ daysRemaining, planNombre = "Profesional" }: TrialBannerProps) {
  const [isDismissed, setIsDismissed] = useState(true) // Start hidden to prevent flash
  const isUrgent = daysRemaining <= 7
  const isCritical = daysRemaining <= 3

  useEffect(() => {
    const dismissedAt = localStorage.getItem(BANNER_DISMISS_KEY)
    if (dismissedAt) {
      const dismissedTime = parseInt(dismissedAt, 10)
      const hoursSinceDismiss = (Date.now() - dismissedTime) / (1000 * 60 * 60)
      // Show again after DISMISS_DURATION_HOURS or if critical
      if (hoursSinceDismiss < DISMISS_DURATION_HOURS && !isCritical) {
        setIsDismissed(true)
        return
      }
    }
    setIsDismissed(false)
  }, [isCritical])

  const handleDismiss = () => {
    localStorage.setItem(BANNER_DISMISS_KEY, Date.now().toString())
    setIsDismissed(true)
  }

  if (isDismissed) return null

  return (
    <div className="lg:ml-64 fixed top-[calc(3.5rem+env(safe-area-inset-top,0px))] lg:top-2 left-0 right-0 z-40 flex justify-center px-2 sm:px-4">
      <div
        className={cn(
          "px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium rounded-full shadow-lg flex items-center gap-1.5 sm:gap-2 max-w-full",
          isCritical
            ? "bg-red-500 text-white"
            : isUrgent
            ? "bg-yellow-500 text-yellow-950"
            : "bg-gradient-to-r from-blue-500 to-purple-500 text-white"
        )}
      >
        <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
        <span className="truncate min-w-0">
          {/* Compact text on mobile, full on sm+ */}
          <span className="sm:hidden">
            {daysRemaining === 0
              ? "Prueba termina hoy"
              : daysRemaining === 1
              ? "Prueba termina mañana"
              : `Prueba: ${daysRemaining} días`}
          </span>
          <span className="hidden sm:inline">
            {daysRemaining === 0
              ? `Tu prueba del plan ${planNombre} termina hoy`
              : daysRemaining === 1
              ? `Tu prueba del plan ${planNombre} termina mañana`
              : `Estás probando el plan ${planNombre} — te quedan ${daysRemaining} días`}
          </span>
        </span>
        <Link href="/configuracion/billing" className="shrink-0">
          <Button
            size="sm"
            variant={isCritical ? "secondary" : "outline"}
            className={cn(
              "h-7 text-xs px-2 sm:px-3",
              !isCritical && "bg-white/20 border-white/30 text-white hover:bg-white/30"
            )}
          >
            <Sparkles className="h-3 w-3 sm:mr-1" />
            <span className="hidden sm:inline">Suscribirse ahora</span>
          </Button>
        </Link>
        <button
          onClick={handleDismiss}
          className={cn(
            "p-1 rounded-full transition-colors shrink-0",
            isCritical
              ? "hover:bg-red-600"
              : isUrgent
              ? "hover:bg-yellow-600"
              : "hover:bg-white/20"
          )}
          aria-label="Cerrar aviso"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
