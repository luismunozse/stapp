"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useCurrency } from "@/contexts/currency-context"
import { Package, TrendingUp, TrendingDown, Clock, AlertTriangle } from "lucide-react"

interface AnalyticsData {
  ventasUlt30d: number
  ventasUlt90d: number
  promedioDiario30: number
  promedioDiario90: number
  diasDeStockRestantes: number
  ultimaVenta: string | null
  sinMovimientoDias: number
  disponible: number
  stockReservado: number
  puntoReorden: number | null
  valorStock: number
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  inventarioId: string
  inventarioNombre: string
}

export function InventarioAnalyticsModal({ open, onOpenChange, inventarioId, inventarioNombre }: Props) {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const { formatPrice, formatDate } = useCurrency()

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch(`/api/inventario/${inventarioId}/analytics`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [open, inventarioId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4" />
            Analytics: {inventarioNombre}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : !data ? (
          <p className="text-sm text-muted-foreground py-4">No se pudieron cargar los datos.</p>
        ) : (
          <div className="space-y-4">
            {/* Ventas */}
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label="Ventas 30d"
                value={`${data.ventasUlt30d} uds`}
                sub={`~${data.promedioDiario30}/día`}
                icon={<TrendingUp className="h-4 w-4 text-emerald-500" />}
              />
              <StatCard
                label="Ventas 90d"
                value={`${data.ventasUlt90d} uds`}
                sub={`~${data.promedioDiario90}/día`}
                icon={<TrendingUp className="h-4 w-4 text-blue-500" />}
              />
            </div>

            {/* Stock */}
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label="Días de stock"
                value={data.diasDeStockRestantes >= 999 ? "∞" : `${data.diasDeStockRestantes}d`}
                sub={data.diasDeStockRestantes < 14 && data.diasDeStockRestantes < 999 ? "⚠ Bajo" : undefined}
                icon={<Package className="h-4 w-4 text-amber-500" />}
                warn={data.diasDeStockRestantes < 14 && data.diasDeStockRestantes < 999}
              />
              <StatCard
                label="Disponible"
                value={`${data.disponible}`}
                sub={data.stockReservado > 0 ? `${data.stockReservado} reservado` : undefined}
                icon={<Package className="h-4 w-4 text-violet-500" />}
              />
            </div>

            {/* Last sale + idle */}
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label="Última venta"
                value={data.ultimaVenta ? formatDate(data.ultimaVenta) : "Nunca"}
                icon={<Clock className="h-4 w-4 text-gray-500" />}
              />
              <StatCard
                label="Sin movimiento"
                value={data.sinMovimientoDias >= 999 ? "Nunca vendido" : `${data.sinMovimientoDias}d`}
                icon={<TrendingDown className="h-4 w-4 text-gray-500" />}
                warn={data.sinMovimientoDias >= 90 && data.sinMovimientoDias < 999}
              />
            </div>

            {/* Extra info */}
            <div className="rounded-lg bg-muted/50 p-3 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Valor en stock</span>
                <span className="font-medium">{formatPrice(data.valorStock)}</span>
              </div>
              {data.puntoReorden != null && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Punto de reorden</span>
                  <span className="font-medium flex items-center gap-1">
                    {data.disponible <= data.puntoReorden && (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    )}
                    {data.puntoReorden} uds
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function StatCard({ label, value, sub, icon, warn }: {
  label: string
  value: string
  sub?: string
  icon: React.ReactNode
  warn?: boolean
}) {
  return (
    <div className={`rounded-lg border p-3 ${warn ? "border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20" : ""}`}>
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="text-lg font-bold leading-tight">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  )
}
