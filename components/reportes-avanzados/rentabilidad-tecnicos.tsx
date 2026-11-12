"use client"

import { useState, useEffect, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { DateRangePicker } from "@/components/ui/date-picker"
import { Loader2, TrendingUp, DollarSign, Clock, Users } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { fetchReporte } from "@/lib/reportes/fetch-reporte"
import { ReporteBloqueado, ReporteError } from "./reporte-estados"
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
import { ChartTooltipContent } from "@/components/ui/chart-tooltip"
import { useCurrency } from "@/contexts/currency-context"
import { CHART_CONCEPT_COLORS } from "@/lib/chart-colors"
import { formatCompactCurrency } from "@/lib/utils"

interface TecnicoRentabilidad {
  tecnicoId: string
  nombre: string
  ordenes: number
  horasTrabajadas: number
  ingresos: number
  /** null cuando el rol no puede ver costos de compra:
   *  repuestos_orden.precio_unitario es la copia congelada de precio_compra. */
  costoRepuestos: number | null
  costoManoObra: number
  /** null junto con costoRepuestos: es (ingresos - costoRepuestos) por el
   *  porcentaje de comisión, así que también se invierte. */
  comision: number | null
  /** null junto con costoRepuestos: es ingresos - costoRepuestos -
   *  costoManoObra - comision, y los otros términos viajan visibles. */
  ganancia: number | null
  margen: number | null
  gananciaPorHora: number | null
}

interface Totales {
  tecnicos: number
  ingresos: number
  ganancia: number | null
  horas: number
}

interface RentabilidadTecnicosData {
  data: TecnicoRentabilidad[]
  totales: Totales
  margenPromedio: number | null
  periodo: { desde: string; hasta: string }
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
  const { formatPrice: formatCurrency, currency } = useCurrency()
  const [data, setData] = useState<TecnicoRentabilidad[]>([])
  const [totales, setTotales] = useState<Totales | null>(null)
  const [margenPromedio, setMargenPromedio] = useState<number | null>(0)
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
      const resultado = await fetchReporte<RentabilidadTecnicosData>(
        `/api/reportes/rentabilidad-tecnicos?${params}`,
      )
      if (resultado.estado === "bloqueado") {
        setFeatureLocked(true)
        return
      }
      if (resultado.estado === "error") throw new Error(resultado.mensaje)
      const result = resultado.data
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

  // Sin toolbar: cambiar el rango no destraba nada y solo invitaría a probar.
  if (featureLocked) return <ReporteBloqueado reporte="rentabilidad-tecnicos" />

  if (error) {
    return (
      <div className="space-y-4">
        {toolbar}
        <ReporteError mensaje={error} onReintentar={() => fetchData(from, to)} />
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

  // Las cifras de costo llegan en null para los roles sin acceso: se ocultan
  // las columnas, las tarjetas y el gráfico en vez de pintar el null como "$0"
  // o "0%", que se leen como una ganancia real de cero y no como un permiso
  // faltante. El gráfico entero es ganancia, así que se va completo.
  const costosOcultos = data.some((t) => t.ganancia === null)

  const chartData = data.map((t) => ({
    nombre: t.nombre.split(" ")[0],
    ganancia: Math.round(t.ganancia ?? 0),
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
        {!costosOcultos && (
          <>
            <StatCard
              title="Ganancia total"
              value={formatCurrency(totales?.ganancia ?? 0)}
              description="Todos los técnicos"
              icon={DollarSign}
              tone="success"
            />
            <StatCard
              title="Margen promedio"
              value={`${margenPromedio ?? 0}%`}
              description="Sobre ingresos"
              icon={TrendingUp}
              tone="default"
            />
          </>
        )}
        <StatCard
          title="Horas totales"
          value={String(totales?.horas ?? 0)}
          description="Trabajadas"
          icon={Clock}
          tone="default"
        />
      </div>

      {/* Chart */}
      {!costosOcultos && (
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
                  <XAxis
                    type="number"
                    fontSize={12}
                    tickFormatter={(v: number) => formatCompactCurrency(v, currency)}
                  />
                  <YAxis dataKey="nombre" type="category" width={80} fontSize={12} />
                  <Tooltip
                    content={<ChartTooltipContent />}
                    formatter={(value: number) =>
                      [formatCurrency(value), "Ganancia"]
                    }
                  />
                  <Bar dataKey="ganancia" name="Ganancia" fill={CHART_CONCEPT_COLORS.ganancia} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

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
                {!costosOcultos && (
                  <th className="pb-2 pr-3 font-medium text-right whitespace-nowrap">Repuestos</th>
                )}
                <th className="pb-2 pr-3 font-medium text-right whitespace-nowrap">Mano de obra</th>
                {!costosOcultos && (
                  <>
                    <th className="pb-2 pr-3 font-medium text-right whitespace-nowrap">Comisión</th>
                    <th className="pb-2 pr-3 font-medium text-right whitespace-nowrap">Ganancia</th>
                    <th className="pb-2 pr-3 font-medium text-right whitespace-nowrap">Margen %</th>
                    <th className="pb-2 font-medium text-right whitespace-nowrap">Gan./hora</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.tecnicoId} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="py-2 pr-3 font-medium whitespace-nowrap">{t.nombre}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{t.ordenes}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{t.horasTrabajadas}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-success-text">
                    {formatCurrency(t.ingresos)}
                  </td>
                  {!costosOcultos && (
                    <td className="py-2 pr-3 text-right tabular-nums text-destructive-text">
                      {formatCurrency(t.costoRepuestos ?? 0)}
                    </td>
                  )}
                  <td className="py-2 pr-3 text-right tabular-nums text-destructive-text">
                    {formatCurrency(t.costoManoObra)}
                  </td>
                  {!costosOcultos && (
                    <>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatCurrency(t.comision ?? 0)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums font-semibold text-success-text">
                        {formatCurrency(t.ganancia ?? 0)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{t.margen}%</td>
                      <td className="py-2 text-right tabular-nums">
                        {t.gananciaPorHora !== null ? formatCurrency(t.gananciaPorHora) : "—"}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
