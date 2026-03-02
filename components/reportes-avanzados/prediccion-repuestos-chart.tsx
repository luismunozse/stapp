"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2 } from "lucide-react"

interface PrediccionItem {
  nombre: string
  stock_actual: number
  uso_mensual_promedio: number
  semanas_hasta_agotamiento: number | null
  urgencia: "CRITICO" | "BAJO" | "NORMAL"
}

export function PrediccionRepuestosChart() {
  const [data, setData] = useState<PrediccionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch("/api/reportes/prediccion-repuestos")
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

  const getUrgenciaBadge = (urgencia: string) => {
    switch (urgencia) {
      case "CRITICO":
        return <Badge variant="destructive">Critico</Badge>
      case "BAJO":
        return <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">Bajo</Badge>
      default:
        return <Badge variant="secondary">Normal</Badge>
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prediccion de Demanda de Repuestos</CardTitle>
        <CardDescription>
          Estimacion basada en uso historico. Items ordenados por urgencia.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 font-medium">Repuesto</th>
                <th className="text-center py-2 font-medium">Stock</th>
                <th className="text-center py-2 font-medium">Uso/mes</th>
                <th className="text-center py-2 font-medium">Semanas restantes</th>
                <th className="text-center py-2 font-medium">Urgencia</th>
              </tr>
            </thead>
            <tbody>
              {data.map((item, i) => (
                <tr key={i} className="border-b last:border-b-0">
                  <td className="py-2.5">{item.nombre}</td>
                  <td className="text-center py-2.5 font-mono">{item.stock_actual}</td>
                  <td className="text-center py-2.5 font-mono">
                    {item.uso_mensual_promedio.toFixed(1)}
                  </td>
                  <td className="text-center py-2.5 font-mono">
                    {item.semanas_hasta_agotamiento !== null
                      ? item.semanas_hasta_agotamiento.toFixed(1)
                      : "-"}
                  </td>
                  <td className="text-center py-2.5">
                    {getUrgenciaBadge(item.urgencia)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
