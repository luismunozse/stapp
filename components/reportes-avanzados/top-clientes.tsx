"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Users, DollarSign, ShoppingCart, Award, Phone, Mail, AlertCircle } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { useCurrency } from "@/contexts/currency-context"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"

interface ClienteTop {
  clienteId: string
  nombre: string
  telefono: string | null
  email: string | null
  totalOrdenes: number
  totalGastado: number
  ultimaVisita: string | null
}

interface TopClientesData {
  clientes: ClienteTop[]
  estadisticas: {
    totalClientes: number
    clientesActivos: number
    totalOrdenes: number
    totalIngresos: number
    promedioOrdenesCliente: number
    promedioGastoCliente: number
  }
  ordenadoPor: string
}

export function TopClientes() {
  const { formatPrice, formatDate } = useCurrency()
  const [data, setData] = useState<TopClientesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ordenarPor, setOrdenarPor] = useState<"ordenes" | "monto">("ordenes")

  useEffect(() => {
    fetchData()
  }, [ordenarPor])

  const fetchData = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/reportes/top-clientes?tipo=${ordenarPor}`)
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

  if (loading && !data) {
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
            description={error || "No hay datos de clientes para mostrar"}
            variant={error ? "error" : "search"}
          />
        </CardContent>
      </Card>
    )
  }

  const chartData = data.clientes.slice(0, 5).map((c) => ({
    nombre: c.nombre.length > 15 ? c.nombre.substring(0, 15) + "..." : c.nombre,
    valor: ordenarPor === "monto" ? c.totalGastado : c.totalOrdenes,
  }))

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Clientes Activos</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground hidden sm:block" />
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-base sm:text-2xl font-bold">{data.estadisticas.clientesActivos}</div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">
              de {data.estadisticas.totalClientes}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Prom. Órdenes</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground hidden sm:block" />
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-base sm:text-2xl font-bold">
              {data.estadisticas.promedioOrdenesCliente.toFixed(1)}
            </div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">por cliente</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Gasto Prom.</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground hidden sm:block" />
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-base sm:text-2xl font-bold truncate">
              {formatPrice(data.estadisticas.promedioGastoCliente)}
            </div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">por cliente</p>
          </CardContent>
        </Card>
      </div>

      {/* Ordenar por */}
      <div className="flex gap-2">
        <Button
          variant={ordenarPor === "ordenes" ? "default" : "outline"}
          size="sm"
          onClick={() => setOrdenarPor("ordenes")}
        >
          Por Órdenes
        </Button>
        <Button
          variant={ordenarPor === "monto" ? "default" : "outline"}
          size="sm"
          onClick={() => setOrdenarPor("monto")}
        >
          Por Monto
        </Button>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Top 5 Clientes</CardTitle>
            <CardDescription>
              {ordenarPor === "monto" ? "Por monto gastado" : "Por cantidad de órdenes"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[220px] sm:h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    fontSize={12}
                    tickFormatter={(value) =>
                      ordenarPor === "monto" ? `$${(value / 1000).toFixed(0)}k` : value.toString()
                    }
                  />
                  <YAxis dataKey="nombre" type="category" width={80} fontSize={11} />
                  <Tooltip
                    formatter={(value: number) =>
                      ordenarPor === "monto" ? formatPrice(value) : `${value} órdenes`
                    }
                  />
                  <Bar dataKey="valor" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lista de Top Clientes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="h-5 w-5 text-warning" />
            Top 10 Clientes
          </CardTitle>
          <CardDescription>
            Clientes con mayor actividad en tu taller
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.clientes.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Sin actividad registrada"
              description="No hay clientes con actividad registrada"
              variant="search"
            />
          ) : (
            <div className="space-y-3">
              {data.clientes.map((cliente, index) => (
                <div
                  key={cliente.clienteId}
                  className="p-3 sm:p-4 border rounded-lg space-y-2"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold shrink-0 ${
                        index < 3
                          ? "bg-warning/10 text-warning dark:bg-warning/20"
                          : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                      }`}
                    >
                      {index + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{cliente.nombre}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        {cliente.telefono && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {cliente.telefono}
                          </span>
                        )}
                        {cliente.email && (
                          <span className="flex items-center gap-1 truncate">
                            <Mail className="h-3 w-3 shrink-0" />
                            <span className="truncate">{cliente.email}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pl-10 sm:pl-11">
                    <Badge variant="secondary" className="text-[10px] sm:text-xs">
                      {cliente.totalOrdenes} {cliente.totalOrdenes === 1 ? "orden" : "órdenes"}
                    </Badge>
                    <Badge variant="default" className="bg-success text-white text-[10px] sm:text-xs">
                      {formatPrice(cliente.totalGastado)}
                    </Badge>
                    {cliente.ultimaVisita && (
                      <span className="text-[10px] sm:text-xs text-muted-foreground">
                        Última: {formatDate(cliente.ultimaVisita)}
                      </span>
                    )}
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
