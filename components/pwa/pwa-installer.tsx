"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Download } from "lucide-react"

export function PWAInstaller() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [showInstall, setShowInstall] = useState(false)

  useEffect(() => {
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

    // Detectar evento de instalación
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e)
      setShowInstall(true)
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
      setShowInstall(false)
    }

    setDeferredPrompt(null)
  }

  if (!showInstall) return null

  return (
    <div className="fixed bottom-4 left-4 right-4 lg:left-auto lg:right-4 lg:max-w-sm bg-primary text-primary-foreground p-4 rounded-lg shadow-lg z-50">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-bold">Instalar App</div>
          <div className="text-sm opacity-90">
            Instala esta app para acceso rápido
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleInstall}
          className="ml-4"
        >
          <Download className="mr-2 h-4 w-4" />
          Instalar
        </Button>
      </div>
    </div>
  )
}

