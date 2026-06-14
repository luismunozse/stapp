"use client"

import { useState, useEffect, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { DateRangePicker } from "@/components/ui/date-picker"
import { Loader2, TrendingUp, DollarSign, Clock, Users, Lock, AlertCircle } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { StatCard } from "@/components/dashboard/stat-card"
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
} from "recharts"

interface TecnicoRentabilidad {
  tecnicoId: string
  nombre: string
  ordenes: number
  horasTrabajadas: number
  ingresos: number
  costoRepuestos: number
  costoManoObra: number
  comision: number
  ganancia: number
  margen: number
  gananciaPorHora: number | null
}

interface Totales {
  tecnicos: number
  ingresos: number
  ganancia: number
  horas: number
}

interface RentabilidadTecnicosData {
  data: TecnicoRentabilidad[]
  totales: Totales
  margenPromedio: number
  periodo: { desde: string; hasta: string }
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

export function RentabilidadTecnicos() {
  const [data, setData] = useState<TecnicoRentabilidad[]>([])
  const [totales, setTotales] = useState<Totales | null>(null)
  const [margenPromedio, setMargenPromedio] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [featureLocked, setFeatureLocked] = useState(false)

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
      setFeatureLocked(false)
      const desdeISO = new Date(`${desde}T00:00:00`).toISOString()
      const hastaISO = new Date(`${hasta}T23:59:59.999`).toISOString()
      const params = new URLSearchParams({ desde: desdeISO, hasta: hastaISO })
      const response = await fetch(`/api/reportes/rentabilidad-tecnicos?${params}`)
      if (!response.ok) {
        const errData = await response.json().catch(() => null)
        if (response.status === 403 && errData?.code === "FEATURE_REQUIRED") {
          setFeatureLocked(true)
          return
        }
        throw new Error(errData?.error || "Error al cargar datos")
      }
      const result: RentabilidadTecnicosData = await response.json()
      setData(result.data)
      setTotales(result.totales)
      setMargenPromedio(result.margenPromedio)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido")
    } finally {
      setLoading(false)
    }
  }

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
        <div className="grid gap-4 md:grid-cols-4">
          {[...Array(4)].map((_, i) => (
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
          <CardContent className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (featureLocked) {
    return (
      <div className="space-y-4">
        {toolbar}
        <Card>
          <CardContent className="py-4">
            <EmptyState
              icon={Lock}
              title="Función no disponible"
              description="Este reporte requiere el plan Profesional"
              variant="default"
            />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        {toolbar}
        <Card>
          <CardContent className="py-4">
            <EmptyState
              icon={AlertCircle}
              title="Error al cargar datos"
              description={error}
              variant="error"
            />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="space-y-4">
        {toolbar}
        <Card>
          <CardContent className="py-4">
            <EmptyState
              icon={Users}
              title="Sin datos suficientes"
              description="No hay datos de rentabilidad para mostrar en el periodo seleccionado"
              variant="search"
            />
          </CardContent>
        </Card>
      </div>
    )
  }

  const chartData = data.map((t) => ({
    nombre: t.nombre.split(" ")[0],
    ganancia: Math.round(t.ganancia),
  }))

  return (
    <div className="space-y-6">
      {toolbar}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          title="Técnicos"
          value={String(totales?.tecnicos ?? 0)}
          description="En el periodo"
          icon={Users}
          tone="default"
        />
        <StatCard
          title="Ganancia total"
          value={formatCurrency(totales?.ganancia ?? 0)}
          description="Todos los técnicos"
          icon={DollarSign}
          tone="success"
        />
        <StatCard
          title="Margen promedio"
          value={`${margenPromedio}%`}
          description="Sobre ingresos"
          icon={TrendingUp}
          tone="default"
        />
        <StatCard
          title="Horas totales"
          value={String(totales?.horas ?? 0)}
          description="Trabajadas"
          icon={Clock}
          tone="default"
        />
      </div>

      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base sm:text-lg">Ganancia por Técnico</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Ganancia neta por técnico en el periodo
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[220px] sm:h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" fontSize={12} />
                <YAxis dataKey="nombre" type="category" width={80} fontSize={12} />
                <Tooltip
                  formatter={(value: number) =>
                    [formatCurrency(value), "Ganancia"]
                  }
                />
                <Bar dataKey="ganancia" name="Ganancia" fill="#22c55e" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base sm:text-lg">Detalle por Técnico</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Métricas individuales de rentabilidad
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 pr-3 font-medium whitespace-nowrap">Técnico</th>
                <th className="pb-2 pr-3 font-medium text-right whitespace-nowrap">Órdenes</th>
                <th className="pb-2 pr-3 font-medium text-right whitespace-nowrap">Horas</th>
                <th className="pb-2 pr-3 font-medium text-right whitespace-nowrap">Ingresos</th>
                <th className="pb-2 pr-3 font-medium text-right whitespace-nowrap">Repuestos</th>
                <th className="pb-2 pr-3 font-medium text-right whitespace-nowrap">Mano de obra</th>
                <th className="pb-2 pr-3 font-medium text-right whitespace-nowrap">Comisión</th>
                <th className="pb-2 pr-3 font-medium text-right whitespace-nowrap">Ganancia</th>
                <th className="pb-2 pr-3 font-medium text-right whitespace-nowrap">Margen %</th>
                <th className="pb-2 font-medium text-right whitespace-nowrap">Gan./hora</th>
              </tr>
            </thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.tecnicoId} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="py-2 pr-3 font-medium whitespace-nowrap">{t.nombre}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{t.ordenes}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{t.horasTrabajadas}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-success">
                    {formatCurrency(t.ingresos)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-destructive">
                    {formatCurrency(t.costoRepuestos)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-destructive">
                    {formatCurrency(t.costoManoObra)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {formatCurrency(t.comision)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums font-semibold text-success">
                    {formatCurrency(t.ganancia)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{t.margen}%</td>
                  <td className="py-2 text-right tabular-nums">
                    {t.gananciaPorHora !== null ? formatCurrency(t.gananciaPorHora) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
