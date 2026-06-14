"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, AlertCircle } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"

interface PrediccionItem {
  id: string
  nombre: string
  codigo: string
  stockActual: number
  usoMensualPromedio: number
  semanasHastaAgotamiento: number | null
  urgencia: "CRITICO" | "BAJO" | "NORMAL" | "SIN_USO"
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
      .then((result) => setData(result.data || []))
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
        <CardContent className="py-4">
          <EmptyState
            icon={AlertCircle}
            title={error ? "Error al cargar datos" : "Sin datos suficientes"}
            description={error ? "No se pudo cargar la predicción de repuestos" : "No hay datos suficientes para generar predicciones"}
            variant={error ? "error" : "search"}
          />
        </CardContent>
      </Card>
    )
  }

  const getUrgenciaBadge = (urgencia: string) => {
    switch (urgencia) {
      case "CRITICO":
        return <Badge variant="destructive">Critico</Badge>
      case "BAJO":
        return <Badge className="bg-warning/15 text-warning dark:bg-warning/20">Bajo</Badge>
      case "SIN_USO":
        return <Badge variant="outline">Sin uso</Badge>
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
              {data.map((item) => (
                <tr key={item.id} className="border-b last:border-b-0">
                  <td className="py-2.5">{item.nombre}</td>
                  <td className="text-center py-2.5 font-mono">{item.stockActual}</td>
                  <td className="text-center py-2.5 font-mono">
                    {item.usoMensualPromedio.toFixed(1)}
                  </td>
                  <td className="text-center py-2.5 font-mono">
                    {item.semanasHastaAgotamiento !== null
                      ? item.semanasHastaAgotamiento.toFixed(1)
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
