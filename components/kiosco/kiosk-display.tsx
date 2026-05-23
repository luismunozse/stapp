"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { Maximize, Minimize, RefreshCw, WifiOff, ChevronLeft, ChevronRight } from "lucide-react"
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

interface KioskConfig {
  filter_estados?: string[]
  auto_refresh_seconds?: number
  font_size?: string
  show_branding?: boolean
  show_cliente?: boolean
  show_dispositivo?: boolean
  show_marca?: boolean
  display_mode?: "grid" | "grouped"
  auto_paginate_seconds?: number
}

interface KioskData {
  kiosk: { name: string; config: KioskConfig }
  organizacion: {
    nombre: string
    logoUrl: string | null
    colorPrimary: string
    colorSecondary: string
  }
  ordenes: KioskOrder[]
}

const ESTADO_ORDER = [
  "REPARADO",
  "EN_REPARACION",
  "ESPERANDO_REPUESTO",
  "APROBADO",
  "PRESUPUESTADO",
  "EN_DIAGNOSTICO",
  "RECIBIDO",
]

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

const estadoBorderColors: Record<string, string> = {
  RECIBIDO: "border-gray-500/40",
  EN_DIAGNOSTICO: "border-blue-500/40",
  PRESUPUESTADO: "border-amber-500/40",
  APROBADO: "border-emerald-500/40",
  EN_REPARACION: "border-orange-500/40",
  ESPERANDO_REPUESTO: "border-purple-500/40",
  REPARADO: "border-green-500/40",
}

const ITEMS_PER_PAGE = 16

interface KioskDisplayProps {
  token: string
}

// Order card component
function OrderCard({
  orden,
  fontSize,
  showDispositivo,
  showMarca,
  showCliente,
  compact,
}: {
  orden: KioskOrder
  fontSize: string
  showDispositivo: boolean
  showMarca: boolean
  showCliente: boolean
  compact?: boolean
}) {
  return (
    <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-all">
      <div className="flex items-center justify-between mb-2">
        <span
          className={cn(
            "font-bold",
            compact
              ? "text-lg"
              : fontSize === "large"
                ? "text-2xl"
                : "text-xl"
          )}
        >
          #{orden.codigoOrden || orden.numeroOrden}
        </span>
      </div>

      {!compact && (
        <div className="mb-2">
          <span
            className={cn(
              "inline-block px-3 py-1 rounded-full text-xs font-semibold text-white",
              estadoColors[orden.estado] || "bg-gray-600"
            )}
          >
            {estadoLabels[orden.estado] || orden.estado}
          </span>
        </div>
      )}

      {showDispositivo && (
        <p
          className={cn(
            "font-medium text-gray-200",
            compact
              ? "text-sm"
              : fontSize === "large"
                ? "text-lg"
                : "text-base"
          )}
        >
          {orden.dispositivo}
        </p>
      )}

      {showMarca && orden.marca && (
        <p className="text-sm text-gray-400 mt-0.5">{orden.marca}</p>
      )}

      {showCliente && (
        <p className="text-xs text-gray-400 mt-1">
          {orden.clienteNombre.split(" ")[0]}
        </p>
      )}
    </div>
  )
}

export function KioskDisplay({ token }: KioskDisplayProps) {
  const [data, setData] = useState<KioskData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date())
  const [isOffline, setIsOffline] = useState(false)
  const [currentPage, setCurrentPage] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const paginateRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const retryCountRef = useRef(0)

  const fetchData = useCallback(async (isRetry = false) => {
    try {
      const res = await fetch(`/api/public/kiosco/${token}`)
      if (!res.ok) {
        if (!data) {
          setError("Kiosco no encontrado o desactivado")
        }
        return
      }
      const json = await res.json()
      setData(json)
      setLastUpdate(new Date())
      setError(null)
      setIsOffline(false)
      retryCountRef.current = 0
    } catch {
      if (!data) {
        setError("Error de conexión")
      } else {
        setIsOffline(true)
      }
      if (isRetry) {
        retryCountRef.current++
      }
    }
  }, [token, data])

  // Auto-refresh with visibility API support
  useEffect(() => {
    fetchData()

    const startInterval = () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      const refreshSeconds = (data?.kiosk?.config?.auto_refresh_seconds as number) || 30
      intervalRef.current = setInterval(() => fetchData(true), refreshSeconds * 1000)
    }

    startInterval()

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchData(true)
        startInterval()
      } else {
        if (intervalRef.current) clearInterval(intervalRef.current)
      }
    }

    document.addEventListener("visibilitychange", handleVisibility)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, data?.kiosk?.config?.auto_refresh_seconds])

  // Compute pages for grid mode
  const ordenes = data?.ordenes || []
  const totalPages = Math.max(1, Math.ceil(ordenes.length / ITEMS_PER_PAGE))

  // Auto-paginate
  const autoPaginateSeconds = data?.kiosk?.config?.auto_paginate_seconds as number | undefined
  useEffect(() => {
    if (paginateRef.current) clearInterval(paginateRef.current)

    if (!autoPaginateSeconds || autoPaginateSeconds <= 0 || totalPages <= 1) return

    paginateRef.current = setInterval(() => {
      setCurrentPage((prev) => (prev + 1) % totalPages)
    }, autoPaginateSeconds * 1000)

    return () => {
      if (paginateRef.current) clearInterval(paginateRef.current)
    }
  }, [autoPaginateSeconds, totalPages])

  // Reset page if data changes and page is out of bounds
  useEffect(() => {
    if (currentPage >= totalPages) setCurrentPage(0)
  }, [totalPages, currentPage])

  // Grouped orders by estado
  const groupedOrders = useMemo(() => {
    const groups: Record<string, KioskOrder[]> = {}
    for (const orden of ordenes) {
      if (!groups[orden.estado]) groups[orden.estado] = []
      groups[orden.estado].push(orden)
    }
    // Sort groups by ESTADO_ORDER
    return ESTADO_ORDER
      .filter((estado) => groups[estado]?.length > 0)
      .map((estado) => ({
        estado,
        label: estadoLabels[estado] || estado,
        ordenes: groups[estado],
      }))
  }, [ordenes])

  // Fullscreen
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", handler)
    return () => document.removeEventListener("fullscreenchange", handler)
  }, [])

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
      setIsFullscreen(true)
    } else {
      document.exitFullscreen()
      setIsFullscreen(false)
    }
  }

  if (error && !data) {
    return (
      <div className="min-h-dvh bg-gray-950 flex items-center justify-center text-white">
        <div className="text-center">
          <p className="text-2xl font-bold mb-2">Error</p>
          <p className="text-gray-400">{error}</p>
          <button
            onClick={() => fetchData()}
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
      <div className="min-h-dvh bg-gray-950 flex items-center justify-center">
        <div className="animate-pulse text-white text-xl">Cargando...</div>
      </div>
    )
  }

  const { organizacion } = data
  const config = data.kiosk.config || {}
  const fontSize = config.font_size || "large"
  const showBranding = config.show_branding !== false
  const showCliente = config.show_cliente !== false
  const showDispositivo = config.show_dispositivo !== false
  const showMarca = config.show_marca === true
  const displayMode = config.display_mode || "grid"

  // Paginated orders for grid mode
  const paginatedOrders = ordenes.slice(
    currentPage * ITEMS_PER_PAGE,
    (currentPage + 1) * ITEMS_PER_PAGE
  )

  return (
    <div
      className="min-h-dvh text-white flex flex-col"
      style={{
        background: `linear-gradient(135deg, ${organizacion.colorPrimary}15, ${organizacion.colorSecondary}10, #0a0a0a)`,
        backgroundColor: "#0a0a0a",
      }}
    >
      {/* Header */}
      <header
        className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0"
        style={{ backgroundColor: `${organizacion.colorPrimary}20` }}
      >
        <div className="flex items-center gap-4">
          {showBranding && organizacion.logoUrl && (
            <img
              src={organizacion.logoUrl}
              alt={organizacion.nombre}
              className="h-10 w-auto object-contain"
            />
          )}
          {showBranding ? (
            <h1 className="text-2xl font-bold">{organizacion.nombre}</h1>
          ) : (
            <h1 className="text-2xl font-bold">{data.kiosk.name}</h1>
          )}
        </div>
        <div className="flex items-center gap-4">
          {isOffline && (
            <div className="flex items-center gap-1.5 text-amber-400 text-sm">
              <WifiOff className="h-4 w-4" />
              <span>Sin conexión</span>
            </div>
          )}
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

      {/* Main content */}
      <main className="flex-1 p-6 pb-12">
        {ordenes.length === 0 ? (
          <div className="flex items-center justify-center h-[60vh]">
            <p className="text-2xl text-gray-500">No hay órdenes activas</p>
          </div>
        ) : displayMode === "grouped" ? (
          /* ─── Grouped by estado ─── */
          <div className="space-y-6">
            {groupedOrders.map((group) => (
              <div key={group.estado}>
                <div className="flex items-center gap-3 mb-3">
                  <span
                    className={cn(
                      "inline-block w-3 h-3 rounded-full",
                      estadoColors[group.estado] || "bg-gray-600"
                    )}
                  />
                  <h2 className="text-lg font-semibold text-gray-200">
                    {group.label}
                  </h2>
                  <span className="text-sm text-gray-500">
                    ({group.ordenes.length})
                  </span>
                </div>
                <div
                  className={cn(
                    "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3",
                  )}
                >
                  {group.ordenes.map((orden) => (
                    <div
                      key={orden.id}
                      className={cn(
                        "bg-white/5 backdrop-blur-sm border rounded-lg p-3 hover:bg-white/10 transition-all",
                        estadoBorderColors[orden.estado] || "border-white/10"
                      )}
                    >
                      <span
                        className={cn(
                          "font-bold block",
                          fontSize === "large" ? "text-xl" : "text-lg"
                        )}
                      >
                        #{orden.codigoOrden || orden.numeroOrden}
                      </span>
                      {showDispositivo && (
                        <p className="text-sm font-medium text-gray-200 mt-1">
                          {orden.dispositivo}
                        </p>
                      )}
                      {showMarca && orden.marca && (
                        <p className="text-xs text-gray-400">{orden.marca}</p>
                      )}
                      {showCliente && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          {orden.clienteNombre.split(" ")[0]}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* ─── Grid mode with pagination ─── */
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {paginatedOrders.map((orden) => (
                <OrderCard
                  key={orden.id}
                  orden={orden}
                  fontSize={fontSize}
                  showDispositivo={showDispositivo}
                  showMarca={showMarca}
                  showCliente={showCliente}
                />
              ))}
            </div>

            {/* Pagination indicators */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-4 mt-6">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-30"
                  disabled={currentPage === 0}
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>

                <div className="flex items-center gap-2">
                  {Array.from({ length: totalPages }, (_, i) => (
                    <button
                      key={i}
                      onClick={() => setCurrentPage(i)}
                      className={cn(
                        "w-2.5 h-2.5 rounded-full transition-all",
                        i === currentPage
                          ? "bg-white scale-125"
                          : "bg-white/30 hover:bg-white/50"
                      )}
                    />
                  ))}
                </div>

                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-30"
                  disabled={currentPage === totalPages - 1}
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 px-6 py-2 text-center text-xs text-gray-600 bg-gray-950/80 backdrop-blur-sm">
        Powered by STApp · {ordenes.length} orden{ordenes.length !== 1 ? "es" : ""} activa{ordenes.length !== 1 ? "s" : ""}
        {totalPages > 1 && displayMode === "grid" && (
          <span> · Página {currentPage + 1} de {totalPages}</span>
        )}
      </footer>
    </div>
  )
}
