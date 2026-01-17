"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Users, DollarSign, ShoppingCart, Award, Phone, Mail } from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/utils"
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
      if (!response.ok) throw new Error("Error al cargar datos")
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

  const chartData = data.clientes.slice(0, 5).map((c) => ({
    nombre: c.nombre.length > 15 ? c.nombre.substring(0, 15) + "..." : c.nombre,
    valor: ordenarPor === "monto" ? c.totalGastado : c.totalOrdenes,
  }))

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Clientes Activos</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.estadisticas.clientesActivos}</div>
            <p className="text-xs text-muted-foreground">
              de {data.estadisticas.totalClientes} registrados
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Promedio por Cliente</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data.estadisticas.promedioOrdenesCliente.toFixed(1)}
            </div>
            <p className="text-xs text-muted-foreground">órdenes por cliente</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Gasto Promedio</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(data.estadisticas.promedioGastoCliente)}
            </div>
            <p className="text-xs text-muted-foreground">por cliente</p>
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
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    tickFormatter={(value) =>
                      ordenarPor === "monto" ? `$${(value / 1000).toFixed(0)}k` : value.toString()
                    }
                  />
                  <YAxis dataKey="nombre" type="category" width={120} />
                  <Tooltip
                    formatter={(value: number) =>
                      ordenarPor === "monto" ? formatCurrency(value) : `${value} órdenes`
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
            <Award className="h-5 w-5 text-yellow-500" />
            Top 10 Clientes
          </CardTitle>
          <CardDescription>
            Clientes con mayor actividad en tu taller
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.clientes.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">
              No hay clientes con actividad registrada
            </p>
          ) : (
            <div className="space-y-3">
              {data.clientes.map((cliente, index) => (
                <div
                  key={cliente.clienteId}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border rounded-lg gap-3"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        index < 3
                          ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-500"
                          : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                      }`}
                    >
                      {index + 1}
                    </div>
                    <div>
                      <p className="font-medium">{cliente.nombre}</p>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        {cliente.telefono && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {cliente.telefono}
                          </span>
                        )}
                        {cliente.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {cliente.email}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant="secondary">
                      {cliente.totalOrdenes} {cliente.totalOrdenes === 1 ? "orden" : "órdenes"}
                    </Badge>
                    <Badge variant="default" className="bg-green-500">
                      {formatCurrency(cliente.totalGastado)}
                    </Badge>
                    {cliente.ultimaVisita && (
                      <span className="text-xs text-muted-foreground">
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
