"use client"

import { memo, useMemo } from "react"
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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ChartTooltipContent } from "@/components/ui/chart-tooltip"
import { chartSeriesColor } from "@/lib/chart-colors"

interface TecnicoData {
  nombre: string
  ordenes: number
  completadas: number
}

interface OrdenesPorTecnicoChartProps {
  data: TecnicoData[]
}

export const OrdenesPorTecnicoChart = memo(function OrdenesPorTecnicoChart({ data }: OrdenesPorTecnicoChartProps) {
  const sortedData = useMemo(() =>
    [...data].sort((a, b) => b.ordenes - a.ordenes).slice(0, 5),
    [data]
  )

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Órdenes por técnico</CardTitle>
          <CardDescription>Carga de trabajo actual</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">
            No hay técnicos con órdenes asignadas
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="p-3 sm:p-6 pb-1 sm:pb-2">
        <CardTitle className="text-sm sm:text-base">Órdenes por técnico</CardTitle>
        <CardDescription className="text-xs sm:text-sm">Carga de trabajo actual (Top 5)</CardDescription>
      </CardHeader>
      <CardContent className="p-3 sm:p-6 pt-0">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart
            data={sortedData}
            layout="vertical"
            margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} className="stroke-muted" />
            <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
            <YAxis
              type="category"
              dataKey="nombre"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              width={90}
              tickFormatter={(value) =>
                value.length > 12 ? `${value.substring(0, 12)}...` : value
              }
            />
            <Tooltip
              formatter={(value: number, name: string) => {
                const label = name === "ordenes" ? "En proceso" : "Completadas"
                return [value, label]
              }}
              content={<ChartTooltipContent />}
            />
            <Bar dataKey="ordenes" name="ordenes" radius={[0, 4, 4, 0]}>
              {sortedData.map((entry, index) => (
                <Cell key={`cell-${entry.nombre}`} fill={chartSeriesColor(index)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
})
