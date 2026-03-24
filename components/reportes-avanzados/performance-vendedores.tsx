"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { TrendingUp, DollarSign, CheckCircle } from "lucide-react"
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

interface VendedorData {
  vendedorId: string
  nombre: string
  ventasCompletadas: number
  ventasAnuladas: number
  montoTotal: number
  ticketPromedio: number | null
  tasaCompletado: number
}

interface PerformanceData {
  vendedores: VendedorData[]
  totales: {
    totalVentas: number
    totalCompletadas: number
    totalAnuladas: number
    montoTotal: number
    ticketPromedioGeneral: number | null
  }
  periodo: {
    desde: string
    hasta: string
  }
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
  }).format(amount)
}

export function PerformanceVendedores() {
  const [data, setData] = useState<PerformanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const response = await fetch("/api/reportes/performance-vendedores")
      if (!response.ok) {
        const errData = await response.json().catch(() => null)
        throw new Error(errData?.error || "Error al cargar datos")
      }
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
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Card key={`skeleton-${i}`}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="py-8">
            <Skeleton className="h-[300px] w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          {error || "No hay datos disponibles"}
        </CardContent>
      </Card>
    )
  }

  const chartData = data.vendedores.map((v) => ({
    nombre: v.nombre.split(" ")[0],
    monto: v.montoTotal,
    ventas: v.ventasCompletadas,
  }))

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Total Ventas</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground hidden sm:block" />
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-base sm:text-2xl font-bold">{data.totales.totalCompletadas}</div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">
              {data.totales.totalAnuladas > 0 ? `${data.totales.totalAnuladas} anuladas` : "Este mes"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Monto Total</CardTitle>
            <DollarSign className="h-4 w-4 text-green-500 hidden sm:block" />
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-base sm:text-2xl font-bold text-green-600">
              {formatCurrency(data.totales.montoTotal)}
            </div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Ventas completadas</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Ticket Prom.</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground hidden sm:block" />
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-base sm:text-2xl font-bold">
              {data.totales.ticketPromedioGeneral !== null
                ? formatCurrency(data.totales.ticketPromedioGeneral)
                : "-"}
            </div>
            <p className="text-[10px] sm:text-xs text-muted-foreground hidden sm:block">Por venta</p>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base sm:text-lg">Ventas por Vendedor</CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Monto total y cantidad de ventas
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[220px] sm:h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" fontSize={12} />
                  <YAxis dataKey="nombre" type="category" width={60} fontSize={12} />
                  <Tooltip
                    formatter={(value: number, name: string) =>
                      name === "Monto" ? formatCurrency(value) : value
                    }
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="monto" name="Monto" fill="#22c55e" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="ventas" name="Cantidad" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lista de Vendedores */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base sm:text-lg">Detalle por Vendedor</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Métricas individuales de rendimiento
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.vendedores.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">
              No hay vendedores con ventas registradas este mes
            </p>
          ) : (
            <div className="space-y-3">
              {data.vendedores.map((vendedor) => (
                <div
                  key={vendedor.vendedorId}
                  className="p-3 sm:p-4 border rounded-lg space-y-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{vendedor.nombre}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(vendedor.montoTotal)} en ventas
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    <div className="text-center">
                      <p className="text-[10px] sm:text-xs text-muted-foreground">Ventas</p>
                      <Badge variant="default" className="bg-green-500 text-[10px] sm:text-xs">
                        {vendedor.ventasCompletadas}
                      </Badge>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] sm:text-xs text-muted-foreground">Anuladas</p>
                      <Badge variant="secondary" className="text-[10px] sm:text-xs">{vendedor.ventasAnuladas}</Badge>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] sm:text-xs text-muted-foreground">Ticket</p>
                      <Badge variant="outline" className="text-[10px] sm:text-xs">
                        {vendedor.ticketPromedio !== null
                          ? formatCurrency(vendedor.ticketPromedio)
                          : "-"}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-[10px] sm:text-xs text-muted-foreground mb-1 text-center">
                        {vendedor.tasaCompletado}%
                      </p>
                      <Progress value={vendedor.tasaCompletado} className="h-2" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
