"use client"

import { useReporte } from "./use-reporte"
import { ReporteBloqueado, ReporteCargando, ReporteError } from "./reporte-estados"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { AlertCircle } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
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
import { chartSeriesColor } from "@/lib/chart-colors"

interface FallaData {
  falla: string
  cantidad: number
  porcentaje: number
}

export function FallasComunesChart() {
  const { resultado, reintentar } = useReporte<{ data?: FallaData[] }>("/api/reportes/fallas-comunes")

  if (resultado.estado === "cargando") return <ReporteCargando />
  if (resultado.estado === "bloqueado") return <ReporteBloqueado reporte="fallas" />
  if (resultado.estado === "error") {
    return <ReporteError mensaje={resultado.mensaje} onReintentar={reintentar} />
  }

  const data = resultado.data.data || []

  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="py-4">
          <EmptyState
            icon={AlertCircle}
            title="Sin datos suficientes"
            description="No hay fallas registradas para mostrar"
            variant="search"
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fallas Mas Comunes</CardTitle>
        <CardDescription>
          Ranking de problemas reportados mas frecuentes
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={Math.max(300, data.length * 40)}>
          <BarChart data={data} layout="vertical" margin={{ left: 120 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" fontSize={12} />
            <YAxis dataKey="falla" type="category" fontSize={11} width={110} />
            <Tooltip
              content={<ChartTooltipContent />}
              formatter={(value: number, name: string) => {
                if (name === "cantidad") return [value, "Casos"]
                return [value, name]
              }}
            />
            <Bar dataKey="cantidad" fill={chartSeriesColor(4)} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
