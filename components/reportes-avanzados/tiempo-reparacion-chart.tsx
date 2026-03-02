"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Loader2 } from "lucide-react"
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
  tipo_dispositivo: string
  promedio_horas: number
  total_ordenes: number
}

export function TiempoReparacionChart() {
  const [data, setData] = useState<TiempoData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch("/api/reportes/tiempo-reparacion")
      .then((res) => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  if (error || data.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          {error ? "Error al cargar datos" : "No hay datos suficientes para este reporte"}
        </CardContent>
      </Card>
    )
  }

  const chartData = data.map((d) => ({
    nombre: d.tipo_dispositivo,
    horas: Math.round(d.promedio_horas * 10) / 10,
    ordenes: d.total_ordenes,
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
