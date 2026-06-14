"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { UserCog, Clock, CheckCircle, Loader2, AlertCircle } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { StatCard } from "@/components/dashboard/stat-card"
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

interface TecnicoData {
  tecnicoId: string
  nombre: string
  ordenesCompletadas: number
  ordenesEnProceso: number
  tiempoPromedioReparacion: number | null
  tasaCompletado: number
}

interface PerformanceData {
  tecnicos: TecnicoData[]
  totales: {
    totalOrdenes: number
    totalCompletadas: number
    totalEnProceso: number
    promedioTiempo: number | null
  }
  periodo: {
    desde: string
    hasta: string
  }
}

export function PerformanceTecnicos() {
  const [data, setData] = useState<PerformanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const response = await fetch("/api/reportes/performance-tecnicos")
      if (!response.ok) {
        const errData = await response.json().catch(() => null)
        throw new Error(errData?.error || "Error al cargar datos")
      }
      const result = await response.json()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido")
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Card key={`skeleton-${i}`}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="py-8">
            <Skeleton className="h-[300px] w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-4">
          <EmptyState
            icon={AlertCircle}
            title={error ? "Error al cargar datos" : "Sin datos disponibles"}
            description={error || "No hay datos de técnicos para mostrar"}
            variant={error ? "error" : "search"}
          />
        </CardContent>
      </Card>
    )
  }

  const chartData = data.tecnicos.map((t) => ({
    nombre: t.nombre.split(" ")[0],
    completadas: t.ordenesCompletadas,
    enProceso: t.ordenesEnProceso,
  }))

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          title="Total Órdenes"
          value={String(data.totales.totalOrdenes)}
          description="Este mes"
          icon={UserCog}
          tone="default"
        />
        <StatCard
          title="Completadas"
          value={String(data.totales.totalCompletadas)}
          description={
            data.totales.totalOrdenes > 0
              ? `${Math.round((data.totales.totalCompletadas / data.totales.totalOrdenes) * 100)}%`
              : "-"
          }
          icon={CheckCircle}
          tone="success"
        />
        <StatCard
          title="Tiempo Prom."
          value={data.totales.promedioTiempo !== null ? `${data.totales.promedioTiempo.toFixed(1)}d` : "-"}
          description="Para completar"
          icon={Clock}
          tone="default"
        />
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base sm:text-lg">Órdenes por Técnico</CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Completadas y en proceso
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[220px] sm:h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" fontSize={12} />
                  <YAxis dataKey="nombre" type="category" width={60} fontSize={12} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="completadas" name="Completadas" fill="#22c55e" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="enProceso" name="En Proceso" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lista de Técnicos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base sm:text-lg">Detalle por Técnico</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Métricas individuales de rendimiento
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.tecnicos.length === 0 ? (
            <EmptyState
              icon={UserCog}
              title="Sin técnicos asignados"
              description="No hay técnicos con órdenes asignadas este mes"
              variant="search"
            />
          ) : (
            <div className="space-y-3">
              {data.tecnicos.map((tecnico) => (
                <div
                  key={tecnico.tecnicoId}
                  className="p-3 sm:p-4 border rounded-lg space-y-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <UserCog className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{tecnico.nombre}</p>
                      <p className="text-xs text-muted-foreground">
                        {tecnico.ordenesCompletadas + tecnico.ordenesEnProceso} órdenes
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    <div className="text-center">
                      <p className="text-[10px] sm:text-xs text-muted-foreground">Hechas</p>
                      <Badge variant="default" className="bg-success text-white text-[10px] sm:text-xs">
                        {tecnico.ordenesCompletadas}
                      </Badge>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] sm:text-xs text-muted-foreground">Proceso</p>
                      <Badge variant="secondary" className="text-[10px] sm:text-xs">{tecnico.ordenesEnProceso}</Badge>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] sm:text-xs text-muted-foreground">Tiempo</p>
                      <Badge variant="outline" className="text-[10px] sm:text-xs">
                        {tecnico.tiempoPromedioReparacion !== null
                          ? `${tecnico.tiempoPromedioReparacion}d`
                          : "-"}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-[10px] sm:text-xs text-muted-foreground mb-1 text-center">
                        {tecnico.tasaCompletado}%
                      </p>
                      <Progress value={tecnico.tasaCompletado} className="h-2" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
