"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Loader2, AlertCircle, DollarSign, TrendingDown, TrendingUp } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { StatCard } from "@/components/dashboard/stat-card"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"

interface RentabilidadData {
  tipoDispositivo: string
  ingresos: number
  /** null cuando el rol no puede ver costos de compra: agrega
   *  repuestos_orden.precio_unitario, la copia congelada de precio_compra. */
  costos: number | null
  /** null junto con costos: es ingresos - costos, e ingresos viaja al lado, así
   *  que sin el gate la resta devuelve el costo. */
  ganancia: number | null
  margen: number | null
  cantidad: number
  costoManoObra?: number
}

export function RentabilidadChart() {
  const [data, setData] = useState<RentabilidadData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch("/api/reportes/rentabilidad")
      .then((res) => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then((result) => setData(result.data || []))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  if (error || data.length === 0) {
    return (
      <Card>
        <CardContent className="py-4">
          <EmptyState
            icon={AlertCircle}
            title={error ? "Error al cargar datos" : "Sin datos suficientes"}
            description={error ? "No se pudo cargar el reporte de rentabilidad" : "No hay datos suficientes para generar este reporte"}
            variant={error ? "error" : "search"}
          />
        </CardContent>
      </Card>
    )
  }

  // Las cifras de costo llegan en null para los roles sin acceso: se sacan las
  // series y las tarjetas en vez de pintar el null como "$0", que se lee como
  // un costo real de cero y no como un permiso faltante.
  const costosOcultos = data.some((d) => d.costos === null)

  const chartData = data.map((d) => ({
    nombre: d.tipoDispositivo,
    Ingresos: Math.round(d.ingresos),
    ...(costosOcultos
      ? {}
      : { Costos: Math.round(d.costos!), Margen: Math.round(d.ganancia!) }),
    ordenes: d.cantidad,
  }))

  return (
    <Card>
      <CardHeader>
        {/* Un gráfico titulado "Rentabilidad" con una sola serie de ingresos
            miente: quien lo lee saca conclusiones de margen que el gráfico ya
            no tiene. El título sigue a lo que se muestra. */}
        <CardTitle>
          {costosOcultos
            ? "Ingresos por Tipo de Dispositivo"
            : "Rentabilidad por Tipo de Dispositivo"}
        </CardTitle>
        <CardDescription>
          {costosOcultos
            ? "Ingresos facturados por tipo de dispositivo"
            : "Ingresos vs costos de repuestos y mano de obra, con margen resultante"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="nombre" fontSize={12} />
            <YAxis fontSize={12} />
            <Tooltip
              formatter={(value: number) =>
                [`$${value.toLocaleString()}`, undefined]
              }
            />
            <Legend />
            <Bar dataKey="Ingresos" fill="#22c55e" radius={[4, 4, 0, 0]} />
            {!costosOcultos && (
              <>
                <Bar dataKey="Costos" fill="#ef4444" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Margen" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </>
            )}
          </BarChart>
        </ResponsiveContainer>

        <div className={`mt-4 grid gap-3 ${costosOcultos ? "grid-cols-1" : "grid-cols-3"}`}>
          <StatCard
            title="Total Ingresos"
            value={`$${data.reduce((s, d) => s + d.ingresos, 0).toLocaleString()}`}
            icon={DollarSign}
            tone="success"
          />
          {!costosOcultos && (
            <>
              <StatCard
                title="Total Costos"
                value={`$${data.reduce((s, d) => s + (d.costos ?? 0), 0).toLocaleString()}`}
                icon={TrendingDown}
                tone="danger"
              />
              <StatCard
                title="Margen Total"
                value={`$${data.reduce((s, d) => s + (d.ganancia ?? 0), 0).toLocaleString()}`}
                icon={TrendingUp}
                tone="info"
              />
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
