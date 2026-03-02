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
  Legend,
} from "recharts"

interface RentabilidadData {
  tipo_dispositivo: string
  ingresos: number
  costos: number
  margen: number
  total_ordenes: number
}

export function RentabilidadChart() {
  const [data, setData] = useState<RentabilidadData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch("/api/reportes/rentabilidad")
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
          {error ? "Error al cargar datos" : "No hay datos suficientes"}
        </CardContent>
      </Card>
    )
  }

  const chartData = data.map((d) => ({
    nombre: d.tipo_dispositivo,
    Ingresos: Math.round(d.ingresos),
    Costos: Math.round(d.costos),
    Margen: Math.round(d.margen),
    ordenes: d.total_ordenes,
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rentabilidad por Tipo de Dispositivo</CardTitle>
        <CardDescription>
          Ingresos vs costos de repuestos con margen resultante
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="nombre" fontSize={12} />
            <YAxis fontSize={12} />
            <Tooltip
              formatter={(value: number) =>
                [`$${value.toLocaleString()}`, undefined]
              }
            />
            <Legend />
            <Bar dataKey="Ingresos" fill="#22c55e" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Costos" fill="#ef4444" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Margen" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>

        <div className="mt-4 grid grid-cols-3 gap-3 text-center text-sm">
          <div>
            <p className="text-muted-foreground">Total Ingresos</p>
            <p className="font-bold text-green-600">
              ${data.reduce((s, d) => s + d.ingresos, 0).toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Total Costos</p>
            <p className="font-bold text-red-600">
              ${data.reduce((s, d) => s + d.costos, 0).toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Margen Total</p>
            <p className="font-bold text-blue-600">
              ${data.reduce((s, d) => s + d.margen, 0).toLocaleString()}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
