"use client"

import { memo, useMemo } from "react"
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface OrdenesData {
  RECIBIDO: number
  EN_DIAGNOSTICO: number
  PRESUPUESTADO: number
  APROBADO: number
  EN_REPARACION: number
  ESPERANDO_REPUESTO: number
  REPARADO: number
  ENTREGADO: number
  ENTREGADO_SIN_REPARACION: number
  CANCELADO: number
  SIN_REPARACION: number
}

interface OrdenesPorEstadoChartProps {
  data: OrdenesData
}

const ESTADO_CONFIG: Record<string, { label: string; color: string }> = {
  RECIBIDO: { label: "Recibido", color: "#3b82f6" },
  EN_DIAGNOSTICO: { label: "En Diagnóstico", color: "#8b5cf6" },
  PRESUPUESTADO: { label: "Presupuestado", color: "#f59e0b" },
  APROBADO: { label: "Aprobado", color: "#10b981" },
  EN_REPARACION: { label: "En Reparación", color: "#06b6d4" },
  ESPERANDO_REPUESTO: { label: "Esperando Repuesto", color: "#f97316" },
  REPARADO: { label: "Reparado", color: "#22c55e" },
  ENTREGADO: { label: "Entregado", color: "#6b7280" },
  ENTREGADO_SIN_REPARACION: { label: "Retirado s/rep", color: "#d97706" },
  CANCELADO: { label: "Cancelado", color: "#ef4444" },
  SIN_REPARACION: { label: "Sin Reparación", color: "#dc2626" },
}

export const OrdenesPorEstadoChart = memo(function OrdenesPorEstadoChart({ data }: OrdenesPorEstadoChartProps) {
  const { chartData, total } = useMemo(() => {
    const chartData = Object.entries(data)
      .filter(([_, value]) => value > 0)
      .map(([estado, value]) => ({
        name: ESTADO_CONFIG[estado]?.label || estado,
        value,
        color: ESTADO_CONFIG[estado]?.color || "#gray",
      }))
    const total = chartData.reduce((sum, item) => sum + item.value, 0)
    return { chartData, total }
  }, [data])

  if (total === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Órdenes por Estado</CardTitle>
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
        <CardTitle className="text-sm sm:text-base">Órdenes por Estado</CardTitle>
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
