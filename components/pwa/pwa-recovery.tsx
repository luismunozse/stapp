"use client"

import { useEffect, useState, useCallback } from "react"
import { RefreshCw, WifiOff, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"

// Detectar si estamos en modo PWA standalone
function isStandalone() {
  if (typeof window === "undefined") return false
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true ||
    document.referrer.includes("android-app://")
  )
}

export function PWARecovery() {
  const [isOnline, setIsOnline] = useState(true)
  const [isPWA, setIsPWA] = useState(false)
  const [showRefreshHint, setShowRefreshHint] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Pull-to-refresh state
  const [touchStart, setTouchStart] = useState(0)
  const [pullDistance, setPullDistance] = useState(0)
  const PULL_THRESHOLD = 150

  useEffect(() => {
    setIsPWA(isStandalone())
    setIsOnline(navigator.onLine)

    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    // Detectar pantalla en blanco después de carga
    const checkBlankScreen = setTimeout(() => {
      const mainContent = document.querySelector("main")
      if (mainContent && mainContent.children.length === 0) {
        setShowRefreshHint(true)
      }
    }, 3000)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
      clearTimeout(checkBlankScreen)
    }
  }, [])

  // Pull-to-refresh handlers
  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (window.scrollY === 0) {
      setTouchStart(e.touches[0].clientY)
    }
  }, [])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (touchStart === 0) return

    const currentY = e.touches[0].clientY
    const distance = currentY - touchStart

    if (distance > 0 && window.scrollY === 0) {
      setPullDistance(Math.min(distance, PULL_THRESHOLD + 50))
    }
  }, [touchStart])

  const handleTouchEnd = useCallback(() => {
    if (pullDistance >= PULL_THRESHOLD) {
      handleRefresh()
    }
    setTouchStart(0)
    setPullDistance(0)
  }, [pullDistance])

  useEffect(() => {
    if (!isPWA) return

    document.addEventListener("touchstart", handleTouchStart, { passive: true })
    document.addEventListener("touchmove", handleTouchMove, { passive: true })
    document.addEventListener("touchend", handleTouchEnd, { passive: true })

    return () => {
      document.removeEventListener("touchstart", handleTouchStart)
      document.removeEventListener("touchmove", handleTouchMove)
      document.removeEventListener("touchend", handleTouchEnd)
    }
  }, [isPWA, handleTouchStart, handleTouchMove, handleTouchEnd])

  const handleRefresh = async () => {
    setIsRefreshing(true)

    // Limpiar caché del service worker si existe
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "CLEAR_CACHE" })
    }

    // Pequeño delay para mostrar el estado
    await new Promise(resolve => setTimeout(resolve, 300))

    window.location.reload()
  }

  const handleGoBack = () => {
    if (window.history.length > 1) {
      window.history.back()
    } else {
      window.location.href = "/dashboard"
    }
  }

  // No mostrar nada si no es PWA
  if (!isPWA) return null

  return (
    <>
      {/* Indicador de pull-to-refresh */}
      {pullDistance > 0 && (
        <div
          className="fixed top-0 left-0 right-0 z-[100] flex justify-center transition-transform"
          style={{ transform: `translateY(${Math.min(pullDistance - 50, 50)}px)` }}
        >
          <div className={`
            bg-primary text-primary-foreground rounded-full p-2 shadow-lg
            transition-all duration-200
            ${pullDistance >= PULL_THRESHOLD ? "scale-110" : "scale-100"}
          `}>
            <RefreshCw
              className={`h-5 w-5 ${pullDistance >= PULL_THRESHOLD ? "animate-spin" : ""}`}
              style={{
                transform: `rotate(${(pullDistance / PULL_THRESHOLD) * 360}deg)`,
                transition: pullDistance >= PULL_THRESHOLD ? "none" : "transform 0.1s"
              }}
            />
          </div>
        </div>
      )}

      {/* Banner offline ahora lo maneja OfflineBanner del contexto offline */}

      {/* Hint de refresh para pantalla blanca */}
      {showRefreshHint && (
        <div className="fixed inset-0 z-[70] bg-background/95 flex flex-col items-center justify-center p-6">
          <AlertTriangle className="h-12 w-12 text-yellow-500 mb-4" />
          <h2 className="text-lg font-semibold mb-2">Algo salió mal</h2>
          <p className="text-muted-foreground text-center mb-6">
            La página no cargó correctamente. Intenta refrescar.
          </p>
          <div className="flex gap-3">
            <Button variant="outline" onClick={handleGoBack}>
              Volver atrás
            </Button>
            <Button onClick={handleRefresh} disabled={isRefreshing}>
              {isRefreshing ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Refrescar
            </Button>
          </div>
        </div>
      )}

      {/* Botón flotante de refresh (siempre visible en PWA) */}
      <button
        onClick={handleRefresh}
        disabled={isRefreshing}
        className="fixed bottom-20 right-4 z-[50] lg:hidden bg-primary/10 hover:bg-primary/20 text-primary rounded-full p-3 shadow-lg backdrop-blur-sm transition-all active:scale-95 disabled:opacity-50"
        aria-label="Refrescar página"
      >
        <RefreshCw className={`h-5 w-5 ${isRefreshing ? "animate-spin" : ""}`} />
      </button>
    </>
  )
}
