"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { UserCog, Clock, CheckCircle, Loader2 } from "lucide-react"
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
      if (!response.ok) throw new Error("Error al cargar datos")
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
            <Card key={i}>
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
        <CardContent className="py-8 text-center text-muted-foreground">
          {error || "No hay datos disponibles"}
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
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Total Órdenes</CardTitle>
            <UserCog className="h-4 w-4 text-muted-foreground hidden sm:block" />
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-base sm:text-2xl font-bold">{data.totales.totalOrdenes}</div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Este mes</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Completadas</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500 hidden sm:block" />
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-base sm:text-2xl font-bold text-green-600">{data.totales.totalCompletadas}</div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">
              {data.totales.totalOrdenes > 0
                ? `${Math.round((data.totales.totalCompletadas / data.totales.totalOrdenes) * 100)}%`
                : "-"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Tiempo Prom.</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground hidden sm:block" />
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-base sm:text-2xl font-bold">
              {data.totales.promedioTiempo !== null
                ? `${data.totales.promedioTiempo.toFixed(1)}d`
                : "-"}
            </div>
            <p className="text-[10px] sm:text-xs text-muted-foreground hidden sm:block">Para completar</p>
          </CardContent>
        </Card>
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
            <p className="text-center text-muted-foreground py-4">
              No hay técnicos con órdenes asignadas este mes
            </p>
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
                      <Badge variant="default" className="bg-green-500 text-[10px] sm:text-xs">
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
