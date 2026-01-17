"use client"

import Link from "next/link"
import { Clock, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface TrialBannerProps {
  daysRemaining: number
}

export function TrialBanner({ daysRemaining }: TrialBannerProps) {
  const isUrgent = daysRemaining <= 7
  const isCritical = daysRemaining <= 3

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
        <Clock className="h-4 w-4" />
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
      </div>
    </div>
  )
}
