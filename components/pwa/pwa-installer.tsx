"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Download, Share, X, Plus } from "lucide-react"
import { isNativePlatform } from "@/lib/capacitor"

type InstallState = "hidden" | "android" | "ios"

export function PWAInstaller() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [installState, setInstallState] = useState<InstallState>("hidden")
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // No mostrar si estamos en Capacitor (ya es app nativa)
    if (isNativePlatform()) return

    // Check if already installed or dismissed
    if (window.matchMedia("(display-mode: standalone)").matches) {
      return // Already installed as PWA
    }

    const wasDismissed = localStorage.getItem("pwa-install-dismissed")
    if (wasDismissed) {
      const dismissedTime = parseInt(wasDismissed)
      // Show again after 7 days
      if (Date.now() - dismissedTime < 7 * 24 * 60 * 60 * 1000) {
        return
      }
    }

    // Registrar service worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          console.log("Service Worker registrado:", registration)
        })
        .catch((error) => {
          console.log("Error al registrar Service Worker:", error)
        })
    }

    // Detect iOS
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)

    if (isIOS && isSafari) {
      // Show iOS install instructions after a small delay
      setTimeout(() => setInstallState("ios"), 2000)
      return
    }

    // Detectar evento de instalación (Android/Chrome)
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e)
      setInstallState("android")
    }

    window.addEventListener("beforeinstallprompt", handler)

    return () => {
      window.removeEventListener("beforeinstallprompt", handler)
    }
  }, [])

  const handleInstall = async () => {
    if (!deferredPrompt) return

    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice

    if (outcome === "accepted") {
      setInstallState("hidden")
    }

    setDeferredPrompt(null)
  }

  const handleDismiss = () => {
    setInstallState("hidden")
    setDismissed(true)
    localStorage.setItem("pwa-install-dismissed", Date.now().toString())
  }

  if (installState === "hidden" || dismissed) return null

  // iOS Install Banner
  if (installState === "ios") {
    return (
      <div className="fixed bottom-4 left-4 right-4 lg:left-auto lg:right-4 lg:max-w-sm bg-card border shadow-lg rounded-lg z-50 overflow-hidden">
        <div className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-lg">ST</span>
              </div>
              <div>
                <div className="font-bold">Instalar STApp</div>
                <div className="text-sm text-muted-foreground">
                  Agrega la app a tu pantalla de inicio
                </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 -mr-2 -mt-2"
              onClick={handleDismiss}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-3 p-2 rounded-lg bg-muted">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                1
              </div>
              <div className="flex items-center gap-2">
                <span>Toca el botón</span>
                <Share className="h-5 w-5 text-primary" />
                <span className="font-medium">Compartir</span>
              </div>
            </div>

            <div className="flex items-center gap-3 p-2 rounded-lg bg-muted">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                2
              </div>
              <div className="flex items-center gap-2">
                <span>Selecciona</span>
                <Plus className="h-5 w-5 text-primary" />
                <span className="font-medium">Agregar a inicio</span>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-muted/50 px-4 py-2 text-xs text-center text-muted-foreground">
          Acceso rápido sin necesidad de App Store
        </div>
      </div>
    )
  }

  // Android/Chrome Install Banner
  return (
    <div className="fixed bottom-4 left-4 right-4 lg:left-auto lg:right-4 lg:max-w-sm bg-card border shadow-lg rounded-lg z-50 overflow-hidden">
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-lg">ST</span>
            </div>
            <div>
              <div className="font-bold">Instalar STApp</div>
              <div className="text-sm text-muted-foreground">
                Instala para acceso rápido
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleDismiss}
            >
              <X className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              onClick={handleInstall}
            >
              <Download className="mr-2 h-4 w-4" />
              Instalar
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
