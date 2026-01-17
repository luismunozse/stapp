"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Clock, Sparkles, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface TrialBannerProps {
  daysRemaining: number
}

const BANNER_DISMISS_KEY = "trial-banner-dismissed"
const DISMISS_DURATION_HOURS = 24

export function TrialBanner({ daysRemaining }: TrialBannerProps) {
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
    <div
      className={cn(
        "lg:ml-64 fixed top-14 lg:top-0 left-0 right-0 z-40 px-4 py-2 text-center text-sm font-medium",
        isCritical
          ? "bg-red-500 text-white"
          : isUrgent
          ? "bg-yellow-500 text-yellow-950"
          : "bg-gradient-to-r from-blue-500 to-purple-500 text-white"
      )}
    >
      <div className="flex items-center justify-center gap-2 flex-wrap">
        <Clock className="h-4 w-4 shrink-0" />
        <span>
          {daysRemaining === 0
            ? "Tu prueba gratuita termina hoy"
            : daysRemaining === 1
            ? "Tu prueba gratuita termina mañana"
            : `Te quedan ${daysRemaining} días de prueba gratuita`}
        </span>
        <Link href="/configuracion/billing">
          <Button
            size="sm"
            variant={isCritical ? "secondary" : "outline"}
            className={cn(
              "h-7 text-xs",
              !isCritical && "bg-white/20 border-white/30 text-white hover:bg-white/30"
            )}
          >
            <Sparkles className="h-3 w-3 mr-1" />
            Suscribirse ahora
          </Button>
        </Link>
        <button
          onClick={handleDismiss}
          className={cn(
            "ml-2 p-1 rounded-full transition-colors",
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
