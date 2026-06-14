"use client"

import { useState, useEffect, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { DateRangePicker } from "@/components/ui/date-picker"
import { TrendingUp, DollarSign, CheckCircle, AlertCircle } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { format } from "date-fns"
import { es } from "date-fns/locale"
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

const toYMD = (d: Date) => format(d, "yyyy-MM-dd")

type PresetKey = "mes-actual" | "mes-anterior" | "ultimos-30" | "ultimos-90" | "anio-actual"

const getPresetRange = (preset: PresetKey): { from: string; to: string } => {
  const now = new Date()
  if (preset === "mes-actual") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1)
    return { from: toYMD(from), to: toYMD(now) }
  }
  if (preset === "mes-anterior") {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const to = new Date(now.getFullYear(), now.getMonth(), 0)
    return { from: toYMD(from), to: toYMD(to) }
  }
  if (preset === "ultimos-30") {
    const from = new Date(now)
    from.setDate(from.getDate() - 29)
    return { from: toYMD(from), to: toYMD(now) }
  }
  if (preset === "ultimos-90") {
    const from = new Date(now)
    from.setDate(from.getDate() - 89)
    return { from: toYMD(from), to: toYMD(now) }
  }
  const from = new Date(now.getFullYear(), 0, 1)
  return { from: toYMD(from), to: toYMD(now) }
}

const PRESET_OPTIONS: { key: PresetKey; label: string }[] = [
  { key: "mes-actual", label: "Este mes" },
  { key: "mes-anterior", label: "Mes anterior" },
  { key: "ultimos-30", label: "Últimos 30 días" },
  { key: "ultimos-90", label: "Últimos 90 días" },
  { key: "anio-actual", label: "Este año" },
]

export function PerformanceVendedores() {
  const [data, setData] = useState<PerformanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const defaultRange = useMemo(() => getPresetRange("mes-actual"), [])
  const [from, setFrom] = useState<string>(defaultRange.from)
  const [to, setTo] = useState<string>(defaultRange.to)
  const [activePreset, setActivePreset] = useState<PresetKey | "custom">("mes-actual")

  useEffect(() => {
    if (!from || !to) return
    fetchData(from, to)
  }, [from, to])

  const applyPreset = (key: PresetKey) => {
    const range = getPresetRange(key)
    setActivePreset(key)
    setFrom(range.from)
    setTo(range.to)
  }

  const handleRangeChange = (range: { from: string; to: string }) => {
    if (range.from && range.to) {
      setActivePreset("custom")
      setFrom(range.from)
      setTo(range.to)
    } else if (range.from) {
      setFrom(range.from)
    }
  }

  const fetchData = async (desde: string, hasta: string) => {
    try {
      setLoading(true)
      setError(null)
      // desde: inicio del día; hasta: fin del día (incluye toda la jornada)
      const desdeISO = new Date(`${desde}T00:00:00`).toISOString()
      const hastaISO = new Date(`${hasta}T23:59:59.999`).toISOString()
      const params = new URLSearchParams({ desde: desdeISO, hasta: hastaISO })
      const response = await fetch(`/api/reportes/performance-vendedores?${params}`)
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

  const periodoLabel = useMemo(() => {
    if (!data) return ""
    const desde = new Date(data.periodo.desde)
    const hasta = new Date(data.periodo.hasta)
    return `${format(desde, "dd MMM yyyy", { locale: es })} — ${format(hasta, "dd MMM yyyy", { locale: es })}`
  }, [data])

  const toolbar = (
    <Card>
      <CardContent className="p-3 sm:p-4 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {PRESET_OPTIONS.map((opt) => (
            <Button
              key={opt.key}
              size="sm"
              variant={activePreset === opt.key ? "default" : "outline"}
              onClick={() => applyPreset(opt.key)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 max-w-sm">
            <DateRangePicker
              from={from}
              to={to}
              onChange={handleRangeChange}
              placeholder="Rango personalizado"
            />
          </div>
          {activePreset === "custom" && (
            <span className="text-xs text-muted-foreground">Rango personalizado</span>
          )}
        </div>
      </CardContent>
    </Card>
  )

  if (loading) {
    return (
      <div className="space-y-4">
        {toolbar}
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
      <div className="space-y-4">
        {toolbar}
        <Card>
          <CardContent className="py-4">
            <EmptyState
              icon={AlertCircle}
              title={error ? "Error al cargar datos" : "Sin datos disponibles"}
              description={error || "No hay datos de vendedores para mostrar"}
              variant={error ? "error" : "search"}
            />
          </CardContent>
        </Card>
      </div>
    )
  }

  const chartData = data.vendedores.map((v) => ({
    nombre: v.nombre.split(" ")[0],
    monto: v.montoTotal,
    ventas: v.ventasCompletadas,
  }))

  return (
    <div className="space-y-6">
      {toolbar}
      <p className="text-xs sm:text-sm text-muted-foreground -mt-2">
        Periodo: {periodoLabel}
      </p>
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
              {data.totales.totalAnuladas > 0 ? `${data.totales.totalAnuladas} anuladas` : "En el periodo"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Monto Total</CardTitle>
            <DollarSign className="h-4 w-4 text-success hidden sm:block" />
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-base sm:text-2xl font-bold text-success">
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
            <EmptyState
              icon={TrendingUp}
              title="Sin ventas registradas"
              description="No hay vendedores con ventas en el periodo seleccionado"
              variant="search"
            />
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
                      <Badge variant="default" className="bg-success text-white text-[10px] sm:text-xs">
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
