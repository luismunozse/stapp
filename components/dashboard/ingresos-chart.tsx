"use client"

import { memo, useMemo, useCallback } from "react"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useCurrency } from "@/contexts/currency-context"
import { ChartTooltipContent } from "@/components/ui/chart-tooltip"
import { CHART_CONCEPT_COLORS } from "@/lib/chart-colors"
import { formatCompactCurrency } from "@/lib/utils"

interface IngresosDia {
  fecha: string
  total: number
}

interface IngresosChartProps {
  data: IngresosDia[]
  totalPeriodo: number
}

export const IngresosChart = memo(function IngresosChart({ data, totalPeriodo }: IngresosChartProps) {
  const { formatPrice, currency, timezone } = useCurrency()
  const formatFecha = useCallback((fecha: string) => {
    const date = new Date(fecha)
    return date.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", timeZone: timezone })
  }, [timezone])

  const chartData = useMemo(() =>
    data.map((item) => ({
      ...item,
      fechaFormateada: formatFecha(item.fecha),
    })), [data, formatFecha])

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ingresos de los últimos 7 días</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">
            No hay ingresos en este período
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="p-3 sm:p-6 pb-1 sm:pb-2">
        <CardTitle className="text-sm sm:text-base">Ingresos de los últimos 7 días</CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          Total: <span className="font-semibold text-foreground">{formatPrice(totalPeriodo)}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="p-3 sm:p-6 pt-0">
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={chartData} margin={{ top: 10, right: 5, left: -15, bottom: 0 }}>
            <defs>
              <linearGradient id="colorIngresos" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={CHART_CONCEPT_COLORS.ingresos} stopOpacity={0.3} />
                <stop offset="95%" stopColor={CHART_CONCEPT_COLORS.ingresos} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="fechaFormateada"
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value: number) => formatCompactCurrency(value, currency)}
            />
            <Tooltip
              content={<ChartTooltipContent />}
              formatter={(value: number) => [formatPrice(value), "Ingresos"]}
            />
            <Area
              type="monotone"
              dataKey="total"
              stroke={CHART_CONCEPT_COLORS.ingresos}
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorIngresos)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
})
