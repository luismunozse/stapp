"use client"

import { useState } from "react"
import useSWR from "swr"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useCurrency } from "@/contexts/currency-context"
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface TendenciaData {
  periodo: { desde: string; hasta: string; meses: number }
  porMes: Array<{
    mes: string
    mesCompleto: string
    ingresos: number
    ingresosVentas: number
    ingresosServicios: number
    ingresosOtros: number
    costos: number
    costoProductos: number
    costoRepuestos: number
    gastos: number
    comisiones: number
    costosFinancieros: number
    gananciaBruta: number
    gananciaNeta: number
  }>
  totales: {
    ingresos: number
    costos: number
    gastos: number
    comisiones: number
    costosFinancieros: number
    gananciaBruta: number
    gananciaNeta: number
  }
}

export function TendenciaFinanciera() {
  const { formatPrice } = useCurrency()
  const [meses, setMeses] = useState(6)

  const { data, isLoading, error } = useSWR<TendenciaData>(
    `/api/reportes/tendencia-financiera?meses=${meses}`,
    fetcher,
    { revalidateOnFocus: false }
  )

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32 mt-2" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[350px] w-full" />
        </CardContent>
      </Card>
    )
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Error al cargar la tendencia
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base sm:text-lg">Tendencia mensual</CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Ingresos, costos y gastos operativos
            </CardDescription>
          </div>
          <div className="flex gap-1">
            {[3, 6, 12].map((n) => (
              <Button
                key={n}
                variant={meses === n ? "default" : "outline"}
                size="sm"
                onClick={() => setMeses(n)}
              >
                {n}m
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Chart: Stacked bars + net profit line */}
        <div className="h-[280px] sm:h-[340px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.porMes}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="mes" fontSize={12} />
              <YAxis
                fontSize={12}
                tickFormatter={(v) => (v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`)}
              />
              <Tooltip
                formatter={(value: number, name: string) => {
                  const labels: Record<string, string> = {
                    ingresos: "Ingresos",
                    costos: "Costos",
                    gastos: "Gastos",
                    gananciaNeta: "Ganancia neta",
                  }
                  return [formatPrice(value), labels[name] || name]
                }}
                labelFormatter={(label: any, payload: any) =>
                  payload?.[0]?.payload?.mesCompleto || label
                }
              />
              <Legend
                formatter={(value) => {
                  const labels: Record<string, string> = {
                    ingresos: "Ingresos",
                    costos: "Costos",
                    gastos: "Gastos",
                    gananciaNeta: "Ganancia neta",
                  }
                  return labels[value] || value
                }}
                wrapperStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="ingresos" fill="#22c55e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="costos" fill="#f97316" radius={[4, 4, 0, 0]} />
              <Bar dataKey="gastos" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Line chart: Net profit trend */}
        <div>
          <div className="text-sm font-medium mb-2">Evolución de ganancia neta</div>
          <div className="h-[180px] sm:h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.porMes}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="mes" fontSize={12} />
                <YAxis
                  fontSize={12}
                  tickFormatter={(v) => (v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`)}
                />
                <Tooltip
                  formatter={(value: number) => [formatPrice(value), "Ganancia neta"]}
                  labelFormatter={(label: any, payload: any) =>
                    payload?.[0]?.payload?.mesCompleto || label
                  }
                />
                <Line
                  type="monotone"
                  dataKey="gananciaNeta"
                  stroke="#3b82f6"
                  strokeWidth={3}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Period totals */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t">
          <TotalItem label="Ingresos" value={formatPrice(data.totales.ingresos)} color="text-green-600" />
          <TotalItem label="Costos" value={formatPrice(data.totales.costos)} color="text-orange-600" />
          <TotalItem label="Gastos" value={formatPrice(data.totales.gastos)} color="text-red-600" />
          <TotalItem
            label="Ganancia neta"
            value={formatPrice(data.totales.gananciaNeta)}
            color={data.totales.gananciaNeta >= 0 ? "text-blue-600" : "text-red-700"}
            bold
          />
        </div>
      </CardContent>
    </Card>
  )
}

function TotalItem({
  label,
  value,
  color,
  bold,
}: {
  label: string
  value: string
  color: string
  bold?: boolean
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`${bold ? "text-lg font-bold" : "text-base font-semibold"} ${color} truncate`}>
        {value}
      </p>
    </div>
  )
}
