"use client"

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

interface TecnicoData {
  nombre: string
  ordenes: number
  completadas: number
}

interface OrdenesPorTecnicoChartProps {
  data: TecnicoData[]
}

const COLORS = ["#3b82f6", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444"]

export function OrdenesPorTecnicoChart({ data }: OrdenesPorTecnicoChartProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Órdenes por Técnico</CardTitle>
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

  const sortedData = [...data].sort((a, b) => b.ordenes - a.ordenes).slice(0, 5)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Órdenes por Técnico</CardTitle>
        <CardDescription>Carga de trabajo actual (Top 5)</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart
            data={sortedData}
            layout="vertical"
            margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} className="stroke-muted" />
            <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
            <YAxis
              type="category"
              dataKey="nombre"
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              width={80}
              tickFormatter={(value) =>
                value.length > 12 ? `${value.substring(0, 12)}...` : value
              }
            />
            <Tooltip
              formatter={(value: number, name: string) => {
                const label = name === "ordenes" ? "En proceso" : "Completadas"
                return [value, label]
              }}
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                color: "hsl(var(--card-foreground))",
              }}
              labelStyle={{ color: "hsl(var(--card-foreground))", fontWeight: "bold" }}
              itemStyle={{ color: "hsl(var(--card-foreground))" }}
            />
            <Bar dataKey="ordenes" name="ordenes" radius={[0, 4, 4, 0]}>
              {sortedData.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
