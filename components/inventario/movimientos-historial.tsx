"use client"

import { useState, useEffect, useCallback } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useCurrency } from "@/contexts/currency-context"
import {
  ArrowUp,
  ArrowDown,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TipoMovimiento = "ENTRADA" | "SALIDA" | "AJUSTE" | "VENTA" | "DEVOLUCION" | "ANULACION"

interface Movimiento {
  id: string
  inventarioId: string
  tipo: TipoMovimiento
  cantidad: number
  stockAnterior: number
  stockPosterior: number
  referenciaId: string | null
  referenciaTipo: string | null
  observaciones: string | null
  usuario: { id: string; nombre: string } | null
  createdAt: string
}

interface MovimientosResponse {
  data: Movimiento[]
  total: number
  page: number
  limit: number
  totalPages: number
}

interface MovimientosHistorialProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  inventarioId: string
  inventarioNombre: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LIMIT = 20

const tipoConfig: Record<
  TipoMovimiento,
  { label: string; color: string; icon: typeof ArrowUp; prefix: string }
> = {
  ENTRADA: {
    label: "Entrada",
    color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    icon: ArrowUp,
    prefix: "+",
  },
  DEVOLUCION: {
    label: "Devolución",
    color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    icon: ArrowUp,
    prefix: "+",
  },
  SALIDA: {
    label: "Salida",
    color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    icon: ArrowDown,
    prefix: "-",
  },
  VENTA: {
    label: "Venta",
    color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    icon: ArrowDown,
    prefix: "-",
  },
  AJUSTE: {
    label: "Ajuste",
    color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    icon: RefreshCw,
    prefix: "",
  },
  ANULACION: {
    label: "Anulación",
    color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    icon: RefreshCw,
    prefix: "",
  },
}

function getQuantityPrefix(tipo: TipoMovimiento, cantidad: number): string {
  const cfg = tipoConfig[tipo]
  if (cfg.prefix) return cfg.prefix
  // For AJUSTE / ANULACION, derive from sign
  return cantidad >= 0 ? "+" : ""
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MovimientosHistorial({
  open,
  onOpenChange,
  inventarioId,
  inventarioNombre,
}: MovimientosHistorialProps) {
  const { formatDateTime } = useCurrency()

  const [movimientos, setMovimientos] = useState<Movimiento[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)

  const fetchMovimientos = useCallback(
    async (targetPage: number) => {
      setLoading(true)
      try {
        const params = new URLSearchParams({
          page: targetPage.toString(),
          limit: LIMIT.toString(),
        })

        const res = await fetch(
          `/api/inventario/${inventarioId}/movimientos?${params.toString()}`,
          { cache: "no-store" }
        )

        if (!res.ok) throw new Error("Error al obtener movimientos")

        const data: MovimientosResponse = await res.json()

        setMovimientos(data.data)
        setTotalPages(data.totalPages)
        setTotal(data.total)
      } catch (error) {
        console.error("Error fetching movimientos:", error)
        setMovimientos([])
      } finally {
        setLoading(false)
      }
    },
    [inventarioId]
  )

  // Fetch when dialog opens or page changes
  useEffect(() => {
    if (open) {
      fetchMovimientos(page)
    } else {
      // Reset state when dialog closes
      setPage(1)
      setMovimientos([])
      setTotal(0)
      setTotalPages(1)
    }
  }, [open, page, fetchMovimientos])

  const handlePrevPage = () => {
    if (page > 1) setPage((p) => p - 1)
  }

  const handleNextPage = () => {
    if (page < totalPages) setPage((p) => p + 1)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            Historial de Movimientos - {inventarioNombre}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Cargando movimientos...</span>
            </div>
          ) : movimientos.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No hay movimientos registrados
            </div>
          ) : (
            <div className="relative space-y-0">
              {/* Timeline line */}
              <div className="absolute left-[19px] top-3 bottom-3 w-px bg-border" />

              {movimientos.map((mov) => {
                const cfg = tipoConfig[mov.tipo]
                const Icon = cfg.icon
                const prefix = getQuantityPrefix(mov.tipo, mov.cantidad)

                return (
                  <div key={mov.id} className="relative flex gap-4 py-3">
                    {/* Timeline dot */}
                    <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-card">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={cfg.color}>{cfg.label}</Badge>
                        <span className="font-semibold text-sm">
                          {prefix}{Math.abs(mov.cantidad)}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {mov.stockAnterior} &rarr; {mov.stockPosterior}
                        </span>
                      </div>

                      {mov.observaciones && (
                        <p className="text-sm text-muted-foreground">
                          {mov.observaciones}
                        </p>
                      )}

                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {mov.usuario && <span>{mov.usuario.nombre}</span>}
                        {mov.usuario && <span>&middot;</span>}
                        <span>{formatDateTime(mov.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Pagination */}
        {!loading && total > LIMIT && (
          <div className="flex items-center justify-between border-t pt-4">
            <span className="text-sm text-muted-foreground">
              Página {page} de {totalPages} ({total} movimientos)
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={handlePrevPage}
                disabled={page <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleNextPage}
                disabled={page >= totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
