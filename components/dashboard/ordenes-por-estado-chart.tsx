"use client"

import { memo, useMemo } from "react"
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ESTADO_ORDEN_UI, ESTADOS_ORDEN } from "@/lib/estado-orden-ui"
import type { EstadoOrden } from "@/types"

type OrdenesData = Partial<Record<EstadoOrden, number>>

interface OrdenesPorEstadoChartProps {
  data: OrdenesData
}

export const OrdenesPorEstadoChart = memo(function OrdenesPorEstadoChart({ data }: OrdenesPorEstadoChartProps) {
  const { chartData, total } = useMemo(() => {
    // Mismo orden, etiqueta y color que la píldora (lib/estado-orden-ui.ts).
    const chartData = ESTADOS_ORDEN.filter((estado) => (data[estado] ?? 0) > 0).map((estado) => ({
      name: ESTADO_ORDEN_UI[estado].label,
      value: data[estado] ?? 0,
      color: ESTADO_ORDEN_UI[estado].chartColor,
    }))
    const total = chartData.reduce((sum, item) => sum + item.value, 0)
    return { chartData, total }
  }, [data])

  if (total === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Órdenes por estado</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">
            No hay órdenes registradas
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="p-3 sm:p-6 pb-1 sm:pb-2">
        <CardTitle className="text-sm sm:text-base">Órdenes por estado</CardTitle>
      </CardHeader>
      <CardContent className="p-3 sm:p-6 pt-0">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="45%"
              innerRadius={40}
              outerRadius={65}
              paddingAngle={2}
              dataKey="value"
            >
              {chartData.map((entry) => (
                <Cell key={`cell-${entry.name}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number) => [`${value} orden${value !== 1 ? "es" : ""}`, ""]}
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                color: "hsl(var(--card-foreground))",
              }}
              labelStyle={{ color: "hsl(var(--card-foreground))" }}
              itemStyle={{ color: "hsl(var(--card-foreground))" }}
            />
            <Legend
              layout="horizontal"
              verticalAlign="bottom"
              align="center"
              wrapperStyle={{ fontSize: "10px", color: "hsl(var(--foreground))", lineHeight: "18px" }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="text-center mt-1 sm:mt-2">
          <span className="text-xl sm:text-2xl font-bold">{total}</span>
          <span className="text-xs sm:text-sm text-muted-foreground ml-2">total</span>
        </div>
      </CardContent>
    </Card>
  )
})
