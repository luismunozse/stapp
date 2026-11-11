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
  Cell,
} from "recharts"

interface TiempoData {
  tipoDispositivo: string
  promedioHoras: number
  promedioDias: number
  cantidad: number
}

export function TiempoReparacionChart() {
  const { resultado, reintentar } = useReporte<{ data?: TiempoData[] }>("/api/reportes/tiempo-reparacion")

  if (resultado.estado === "cargando") return <ReporteCargando />
  if (resultado.estado === "bloqueado") return <ReporteBloqueado reporte="tiempo-reparacion" />
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
            description="No hay datos suficientes para este reporte"
            variant="search"
          />
        </CardContent>
      </Card>
    )
  }

  const chartData = data.map((d) => ({
    nombre: d.tipoDispositivo,
    horas: d.promedioHoras,
    ordenes: d.cantidad,
  }))

  const getColor = (horas: number) => {
    if (horas < 24) return "#22c55e"
    if (horas < 72) return "#eab308"
    return "#ef4444"
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tiempo Promedio de Reparacion</CardTitle>
        <CardDescription>
          Tiempo promedio desde ingreso hasta completado, por tipo de dispositivo
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="nombre" fontSize={12} />
            <YAxis
              label={{ value: "Horas", angle: -90, position: "insideLeft" }}
              fontSize={12}
            />
            <Tooltip
              formatter={(value: number, name: string) => {
                if (name === "horas") {
                  const dias = Math.floor(value / 24)
                  const hrs = Math.round(value % 24)
                  return [`${dias > 0 ? `${dias}d ` : ""}${hrs}h`, "Tiempo promedio"]
                }
                return [value, name]
              }}
            />
            <Bar dataKey="horas" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, index) => (
                <Cell key={index} fill={getColor(entry.horas)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        <div className="mt-4 flex gap-4 text-xs text-muted-foreground justify-center">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-green-500" /> &lt;24h
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-yellow-500" /> 24-72h
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-red-500" /> &gt;72h
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
