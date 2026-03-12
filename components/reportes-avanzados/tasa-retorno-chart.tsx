"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Loader2 } from "lucide-react"
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts"

interface RetornoData {
  tasaRetorno: number
  clientesRecurrentes: number
  totalClientes: number
  topClientes: Array<{
    id: string
    nombre: string
    telefono: string
    ordenes: number
  }>
}

export function TasaRetornoChart() {
  const [data, setData] = useState<RetornoData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch("/api/reportes/tasa-retorno")
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

  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          {error ? "Error al cargar datos" : "No hay datos suficientes"}
        </CardContent>
      </Card>
    )
  }

  const pieData = [
    { name: "Recurrentes", value: data.clientesRecurrentes },
    { name: "Unicos", value: data.totalClientes - data.clientesRecurrentes },
  ]

  const COLORS = ["#3b82f6", "#e5e7eb"]

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Tasa de Retorno de Clientes</CardTitle>
          <CardDescription>
            Porcentaje de clientes que vuelven dentro de 6 meses
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-8">
            <ResponsiveContainer width="50%" height={200}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {pieData.map((_, index) => (
                    <Cell key={index} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>

            <div className="space-y-3">
              <div>
                <p className="text-3xl font-bold text-primary">
                  {Math.round(data.tasaRetorno)}%
                </p>
                <p className="text-sm text-muted-foreground">Tasa de retorno</p>
              </div>
              <div className="text-sm">
                <p><strong>{data.clientesRecurrentes}</strong> clientes recurrentes</p>
                <p><strong>{data.totalClientes}</strong> clientes totales</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {data.topClientes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Top Clientes Recurrentes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.topClientes.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between py-2 border-b last:border-b-0"
                >
                  <div>
                    <p className="font-medium">{c.nombre}</p>
                    <p className="text-sm text-muted-foreground">{c.telefono}</p>
                  </div>
                  <span className="text-sm font-medium text-primary">
                    {c.ordenes} ordenes
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
