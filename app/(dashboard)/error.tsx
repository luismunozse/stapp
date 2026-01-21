"use client"

import { useEffect } from "react"
import { AlertTriangle, RefreshCw, Home, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Dashboard Error:", error)
  }, [error])

  const handleGoHome = () => {
    window.location.href = "/dashboard"
  }

  const handleGoBack = () => {
    if (window.history.length > 1) {
      window.history.back()
    } else {
      handleGoHome()
    }
  }

  const handleHardRefresh = () => {
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "CLEAR_CACHE" })
    }
    window.location.reload()
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="bg-red-100 dark:bg-red-900/20 rounded-full p-4 w-fit mx-auto mb-6">
          <AlertTriangle className="h-10 w-10 text-red-600 dark:text-red-400" />
        </div>

        <h1 className="text-2xl font-bold mb-2">Error al cargar</h1>

        <p className="text-muted-foreground mb-6">
          No se pudo cargar esta sección. Intenta de nuevo o vuelve al inicio.
        </p>

        {process.env.NODE_ENV === "development" && error.digest && (
          <p className="text-xs text-muted-foreground mb-4 font-mono bg-muted p-2 rounded">
            Error ID: {error.digest}
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button variant="outline" onClick={handleGoBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Volver
          </Button>

          <Button variant="outline" onClick={handleGoHome}>
            <Home className="h-4 w-4 mr-2" />
            Dashboard
          </Button>

          <Button onClick={() => reset()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
        </div>

        <button
          onClick={handleHardRefresh}
          className="mt-6 text-sm text-muted-foreground hover:text-foreground underline"
        >
          Recargar página completamente
        </button>
      </div>
    </div>
  )
}
