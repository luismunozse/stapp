"use client"

import { useState, useEffect } from "react"
import { Smartphone, X, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { isNativePlatform } from "@/lib/capacitor"

const DISMISS_KEY = "apk-banner-dismissed"
const DISMISS_DURATION_DAYS = 7

const APK_DOWNLOAD_URL = "https://stapp.com.ar/descargar/android"

interface ApkDownloadBannerProps {
  variant: "sidebar" | "top"
}

export function ApkDownloadBanner({ variant }: ApkDownloadBannerProps) {
  const [isDismissed, setIsDismissed] = useState(true)

  useEffect(() => {
    // No mostrar en la app nativa
    if (isNativePlatform()) {
      setIsDismissed(true)
      return
    }

    const dismissedAt = localStorage.getItem(DISMISS_KEY)
    if (dismissedAt) {
      const dismissedTime = parseInt(dismissedAt, 10)
      const daysSinceDismiss = (Date.now() - dismissedTime) / (1000 * 60 * 60 * 24)
      if (daysSinceDismiss < DISMISS_DURATION_DAYS) {
        setIsDismissed(true)
        return
      }
    }
    setIsDismissed(false)
  }, [])

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, Date.now().toString())
    setIsDismissed(true)
  }

  if (isDismissed) return null

  if (variant === "sidebar") {
    return (
      <div className="mx-3 mb-2 p-3 rounded-lg bg-gradient-to-br from-green-500/10 to-emerald-500/10 border border-green-500/20 relative">
        <button
          onClick={handleDismiss}
          className="absolute top-1.5 right-1.5 p-0.5 rounded-full hover:bg-green-500/20 transition-colors text-muted-foreground hover:text-foreground"
          aria-label="Cerrar"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <div className="flex items-start gap-2.5 pr-4">
          <Smartphone className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-foreground leading-tight">
              Descargá la app para Android
            </p>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Llevá tu taller en el bolsillo
            </p>
            <a href={APK_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
              <Button
                size="sm"
                className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
              >
                <Download className="h-3 w-3 mr-1" />
                Descargar APK
              </Button>
            </a>
          </div>
        </div>
      </div>
    )
  }

  // variant === "top"
  return (
    <div className="lg:hidden fixed top-14 left-0 right-0 z-40 flex justify-center px-4 safe-area-inset-top">
      <div className="px-4 py-2 text-sm font-medium rounded-full shadow-lg flex items-center gap-2 bg-gradient-to-r from-green-500 to-emerald-500 text-white">
        <Smartphone className="h-4 w-4 shrink-0" />
        <span className="text-xs">Descargá la app para Android</span>
        <a href={APK_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs bg-white/20 border-white/30 text-white hover:bg-white/30"
          >
            <Download className="h-3 w-3 mr-1" />
            Descargar
          </Button>
        </a>
        <button
          onClick={handleDismiss}
          className="ml-1 p-1 rounded-full hover:bg-white/20 transition-colors"
          aria-label="Cerrar aviso"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
