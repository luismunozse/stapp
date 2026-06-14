"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { TrendingUp, TrendingDown, Minus, DollarSign, Receipt, Calculator, AlertCircle } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { useCurrency } from "@/contexts/currency-context"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts"

interface ComparativaData {
  mesActual: {
    nombre: string
    total: number
    cantidad: number
    promedio: number
  }
  mesAnterior: {
    nombre: string
    total: number
    cantidad: number
    promedio: number
  }
  cambio: {
    porcentaje: number
    direccion: "up" | "down" | "neutral"
    diferencia: number
  }
}

export function ComparativaIngresos() {
  const { formatPrice } = useCurrency()
  const [data, setData] = useState<ComparativaData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const response = await fetch("/api/reportes/comparativa-ingresos")
      if (!response.ok) throw new Error("Error al cargar datos")
      const result = await response.json()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido")
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={`skeleton-${i}`}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-32 mb-2" />
              <Skeleton className="h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-4">
          <EmptyState
            icon={AlertCircle}
            title={error ? "Error al cargar datos" : "Sin datos disponibles"}
            description={error || "No hay datos de ingresos para mostrar"}
            variant={error ? "error" : "search"}
          />
        </CardContent>
      </Card>
    )
  }

  const chartData = [
    { name: data.mesAnterior.nombre.split(" ")[0], total: data.mesAnterior.total, fill: "#94a3b8" },
    { name: data.mesActual.nombre.split(" ")[0], total: data.mesActual.total, fill: "#3b82f6" },
  ]

  const TrendIcon = data.cambio.direccion === "up"
    ? TrendingUp
    : data.cambio.direccion === "down"
    ? TrendingDown
    : Minus

  const trendColor = data.cambio.direccion === "up"
    ? "text-success"
    : data.cambio.direccion === "down"
    ? "text-destructive"
    : "text-muted-foreground"

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Ingresos Mes Actual</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground hidden sm:block" />
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-base sm:text-2xl font-bold truncate">{formatPrice(data.mesActual.total)}</div>
            <p className="text-[10px] sm:text-xs text-muted-foreground capitalize">{data.mesActual.nombre}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Mes Anterior</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground hidden sm:block" />
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-base sm:text-2xl font-bold text-muted-foreground truncate">
              {formatPrice(data.mesAnterior.total)}
            </div>
            <p className="text-[10px] sm:text-xs text-muted-foreground capitalize">{data.mesAnterior.nombre}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Cambio</CardTitle>
            <TrendIcon className={`h-4 w-4 ${trendColor} hidden sm:block`} />
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className={`text-base sm:text-2xl font-bold ${trendColor}`}>
              {data.cambio.direccion === "up" ? "+" : ""}
              {data.cambio.porcentaje}%
            </div>
            <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
              {data.cambio.diferencia >= 0 ? "+" : ""}
              {formatPrice(data.cambio.diferencia)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Facturas Este Mes</CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground hidden sm:block" />
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-base sm:text-2xl font-bold">{data.mesActual.cantidad}</div>
            <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
              Prom: {formatPrice(data.mesActual.promedio)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base sm:text-lg">Comparativa de Ingresos</CardTitle>
          <CardDescription>
            Ingresos totales por mes
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[220px] sm:h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`} fontSize={12} />
                <YAxis dataKey="name" type="category" width={60} fontSize={12} />
                <Tooltip
                  formatter={(value: number) => formatPrice(value)}
                  labelFormatter={(label) => `Mes: ${label}`}
                />
                <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                  {chartData.map((entry) => (
                    <Cell key={`cell-${entry.name}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
