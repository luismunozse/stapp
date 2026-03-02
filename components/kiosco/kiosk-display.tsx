"use client"

import { useState, useEffect, useCallback } from "react"
import { Maximize, Minimize, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"

interface KioskOrder {
  id: string
  numeroOrden: number
  codigoOrden?: string
  dispositivo: string
  tipoDispositivo: string
  marca: string | null
  estado: string
  fechaIngreso: string
  clienteNombre: string
}

interface KioskData {
  kiosk: { name: string; config: Record<string, unknown> }
  organizacion: {
    nombre: string
    logoUrl: string | null
    colorPrimary: string
    colorSecondary: string
  }
  ordenes: KioskOrder[]
}

const estadoLabels: Record<string, string> = {
  RECIBIDO: "Recibido",
  EN_DIAGNOSTICO: "En Diagnóstico",
  PRESUPUESTADO: "Presupuestado",
  APROBADO: "Aprobado",
  EN_REPARACION: "En Reparación",
  ESPERANDO_REPUESTO: "Esperando Repuesto",
  REPARADO: "LISTO PARA RETIRAR",
}

const estadoColors: Record<string, string> = {
  RECIBIDO: "bg-gray-500",
  EN_DIAGNOSTICO: "bg-blue-500",
  PRESUPUESTADO: "bg-amber-500",
  APROBADO: "bg-emerald-500",
  EN_REPARACION: "bg-orange-500",
  ESPERANDO_REPUESTO: "bg-purple-500",
  REPARADO: "bg-green-500",
}

interface KioskDisplayProps {
  token: string
}

export function KioskDisplay({ token }: KioskDisplayProps) {
  const [data, setData] = useState<KioskData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date())

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/kiosco/${token}`)
      if (!res.ok) {
        setError("Kiosco no encontrado o desactivado")
        return
      }
      const json = await res.json()
      setData(json)
      setLastUpdate(new Date())
      setError(null)
    } catch {
      setError("Error de conexión")
    }
  }, [token])

  useEffect(() => {
    fetchData()

    const refreshSeconds = (data?.kiosk?.config?.auto_refresh_seconds as number) || 30
    const interval = setInterval(fetchData, refreshSeconds * 1000)

    return () => clearInterval(interval)
  }, [fetchData, data?.kiosk?.config?.auto_refresh_seconds])

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
      setIsFullscreen(true)
    } else {
      document.exitFullscreen()
      setIsFullscreen(false)
    }
  }

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", handler)
    return () => document.removeEventListener("fullscreenchange", handler)
  }, [])

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-white">
        <div className="text-center">
          <p className="text-2xl font-bold mb-2">Error</p>
          <p className="text-gray-400">{error}</p>
          <button
            onClick={fetchData}
            className="mt-4 px-4 py-2 bg-blue-600 rounded hover:bg-blue-700 flex items-center gap-2 mx-auto"
          >
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </button>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="animate-pulse text-white text-xl">Cargando...</div>
      </div>
    )
  }

  const { organizacion, ordenes } = data
  const fontSize = (data.kiosk.config?.font_size as string) || "large"

  return (
    <div
      className="min-h-screen text-white"
      style={{
        background: `linear-gradient(135deg, ${organizacion.colorPrimary}15, ${organizacion.colorSecondary}10, #0a0a0a)`,
        backgroundColor: "#0a0a0a",
      }}
    >
      {/* Header */}
      <header
        className="flex items-center justify-between px-6 py-4 border-b border-white/10"
        style={{ backgroundColor: `${organizacion.colorPrimary}20` }}
      >
        <div className="flex items-center gap-4">
          {organizacion.logoUrl && (
            <img
              src={organizacion.logoUrl}
              alt={organizacion.nombre}
              className="h-10 w-auto object-contain"
            />
          )}
          <h1 className="text-2xl font-bold">{organizacion.nombre}</h1>
        </div>
        <div className="flex items-center gap-4">
          <p className="text-sm text-gray-400">
            Actualizado: {lastUpdate.toLocaleTimeString("es-AR")}
          </p>
          <button
            onClick={toggleFullscreen}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            {isFullscreen ? (
              <Minimize className="h-5 w-5" />
            ) : (
              <Maximize className="h-5 w-5" />
            )}
          </button>
        </div>
      </header>

      {/* Orders grid */}
      <main className="p-6">
        {ordenes.length === 0 ? (
          <div className="flex items-center justify-center h-[60vh]">
            <p className="text-2xl text-gray-500">No hay órdenes activas</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {ordenes.map((orden) => (
              <div
                key={orden.id}
                className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-5 hover:bg-white/10 transition-all"
              >
                {/* Order number */}
                <div className="flex items-center justify-between mb-3">
                  <span
                    className={cn(
                      "font-bold",
                      fontSize === "large" ? "text-2xl" : "text-xl"
                    )}
                  >
                    #{orden.codigoOrden || orden.numeroOrden}
                  </span>
                </div>

                {/* Status badge */}
                <div className="mb-3">
                  <span
                    className={cn(
                      "inline-block px-3 py-1.5 rounded-full text-sm font-semibold text-white",
                      estadoColors[orden.estado] || "bg-gray-600"
                    )}
                  >
                    {estadoLabels[orden.estado] || orden.estado}
                  </span>
                </div>

                {/* Device */}
                <p
                  className={cn(
                    "font-medium text-gray-200",
                    fontSize === "large" ? "text-lg" : "text-base"
                  )}
                >
                  {orden.dispositivo}
                </p>

                {/* Client name (first name only for privacy) */}
                <p className="text-sm text-gray-400 mt-1">
                  {orden.clienteNombre.split(" ")[0]}
                </p>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 px-6 py-2 text-center text-xs text-gray-600 bg-gray-950/80 backdrop-blur-sm">
        Powered by STApp · {ordenes.length} orden{ordenes.length !== 1 ? "es" : ""} activa{ordenes.length !== 1 ? "s" : ""}
      </footer>
    </div>
  )
}
