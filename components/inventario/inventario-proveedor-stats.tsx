"use client"

import useSWR from "swr"
import { Card } from "@/components/ui/card"
import { Package, Layers, DollarSign, TrendingUp, AlertTriangle } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

interface Summary {
  totalArticulos: number
  totalStock: number
  valorCosto: number
  valorVenta: number
  margenEstimado: number
  itemsBajoStock: number
  itemsSinStock: number
  truncated: boolean
}

interface InventarioProveedorStatsProps {
  proveedorNombre: string
  proveedorId: string
  categoria?: string
  tipoDispositivo?: string
  bajoStock?: boolean
  refreshKey?: number
}

const fetcher = (url: string): Promise<Summary> =>
  fetch(url, { cache: "no-store" }).then((res) => {
    if (!res.ok) throw new Error("Error al cargar resumen")
    return res.json()
  })

export function InventarioProveedorStats({
  proveedorNombre,
  proveedorId,
  categoria,
  tipoDispositivo,
  bajoStock,
  refreshKey = 0,
}: InventarioProveedorStatsProps) {
  const { formatPrice } = useCurrency()

  const params = new URLSearchParams({ proveedorId })
  if (categoria) params.append("categoria", categoria)
  if (tipoDispositivo) params.append("tipoDispositivo", tipoDispositivo)
  if (bajoStock) params.append("bajoStock", "true")
  params.append("_r", refreshKey.toString())

  const { data, isLoading } = useSWR<Summary>(
    `/api/inventario/summary?${params.toString()}`,
    fetcher,
    { revalidateOnFocus: false }
  )

  if (isLoading || !data) {
    return (
      <Card className="p-3 bg-muted/30">
        <div className="text-xs text-muted-foreground">
          Calculando métricas de {proveedorNombre}...
        </div>
      </Card>
    )
  }

  const stats: { label: string; value: string; icon: React.ReactNode; color?: string }[] = [
    {
      label: "Artículos",
      value: data.totalArticulos.toLocaleString("es-AR"),
      icon: <Package className="h-4 w-4" />,
    },
    {
      label: "Unidades en stock",
      value: data.totalStock.toLocaleString("es-AR"),
      icon: <Layers className="h-4 w-4" />,
    },
    {
      label: "Valor a costo",
      value: formatPrice(data.valorCosto),
      icon: <DollarSign className="h-4 w-4" />,
    },
    {
      label: "Valor a venta",
      value: formatPrice(data.valorVenta),
      icon: <TrendingUp className="h-4 w-4" />,
      color: "text-emerald-600",
    },
  ]

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium">
          Métricas de <span className="text-primary">{proveedorNombre}</span>
        </div>
        {(data.itemsSinStock > 0 || data.itemsBajoStock > 0) && (
          <div className="flex items-center gap-1.5 text-xs text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5" />
            {data.itemsSinStock > 0 && <span>{data.itemsSinStock} sin stock</span>}
            {data.itemsSinStock > 0 && data.itemsBajoStock > 0 && <span>·</span>}
            {data.itemsBajoStock > 0 && <span>{data.itemsBajoStock} bajo stock</span>}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <div className="text-muted-foreground">{s.icon}</div>
            <div>
              <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
                {s.label}
              </div>
              <div className={`text-sm font-semibold ${s.color || ""}`}>{s.value}</div>
            </div>
          </div>
        ))}
      </div>
      {data.truncated && (
        <div className="text-[11px] text-amber-600 mt-2">
          Mostrando los primeros 10.000 items. Aplicá filtros adicionales para ver el total real.
        </div>
      )}
    </Card>
  )
}
