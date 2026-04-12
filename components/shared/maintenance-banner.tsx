"use client"

import { useState, useEffect } from "react"
import { Wrench, X, Info, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"

const BANNER_DISMISS_KEY_PREFIX = "maintenance-banner-dismissed:"

type Severity = "INFO" | "WARNING" | "CRITICAL"

interface MaintenanceBannerProps {
  message: string
  severity?: Severity
}

const severityStyles: Record<Severity, string> = {
  INFO: "bg-blue-500 text-white border-blue-600 hover:bg-blue-600/40",
  WARNING: "bg-amber-500 text-amber-950 border-amber-600",
  CRITICAL: "bg-red-500 text-white border-red-600",
}

const severityDismissHover: Record<Severity, string> = {
  INFO: "hover:bg-blue-600/40",
  WARNING: "hover:bg-amber-600/40",
  CRITICAL: "hover:bg-red-600/40",
}

const severityIcons: Record<Severity, typeof Wrench> = {
  INFO: Info,
  WARNING: Wrench,
  CRITICAL: AlertTriangle,
}

export function MaintenanceBanner({ message, severity = "WARNING" }: MaintenanceBannerProps) {
  const [isDismissed, setIsDismissed] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Key per message hash so cambios del superadmin resetean el dismiss
  const dismissKey = `${BANNER_DISMISS_KEY_PREFIX}${message}`

  useEffect(() => {
    // Dismiss persiste por toda la sesión del navegador (sessionStorage)
    // Al cerrar pestaña/navegador se resetea automáticamente
    const dismissedInSession = sessionStorage.getItem(dismissKey)
    if (dismissedInSession && severity !== "CRITICAL") {
      setIsDismissed(true)
    }
    setMounted(true)
  }, [dismissKey, severity])

  const handleDismiss = () => {
    sessionStorage.setItem(dismissKey, "1")
    setIsDismissed(true)
  }

  if (!mounted || isDismissed) return null

  const Icon = severityIcons[severity]
  const isCritical = severity === "CRITICAL"

  return (
    <div className="lg:ml-64 fixed top-14 lg:top-2 left-0 right-0 z-40 flex justify-center px-4 pointer-events-none">
      <div
        className={cn(
          "px-4 py-2 text-sm font-medium rounded-full shadow-lg flex items-center gap-2 pointer-events-auto border max-w-full",
          severityStyles[severity]
        )}
        role="status"
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{message}</span>
        {!isCritical && (
          <button
            onClick={handleDismiss}
            className={cn(
              "ml-1 p-1 rounded-full transition-colors shrink-0",
              severityDismissHover[severity]
            )}
            aria-label="Cerrar aviso"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}
