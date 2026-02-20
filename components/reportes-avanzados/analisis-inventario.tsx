"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Package, AlertTriangle, DollarSign, Layers, TrendingUp } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts"

interface ItemInventario {
  id: string
  codigo: string | null
  nombre: string
  categoria: string | null
  stock: number
  precioCompra: number | null
  precioVenta: number | null
  valorEnStock?: number
}

interface CategoriaResumen {
  categoria: string
  cantidad: number
  stockTotal: number
  valorTotal: number
}

interface AnalisisData {
  resumen: {
    totalItems: number
    totalUnidades: number
    valorCompra: number
    valorVenta: number
    margenPotencial: number
    itemsSinStock: number
    itemsStockCritico: number
    categorias: number
  }
  stockCritico: ItemInventario[]
  sinStock: ItemInventario[]
  porCategoria: CategoriaResumen[]
  masValiosos: (ItemInventario & { valorEnStock: number })[]
}

const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"]

export function AnalisisInventario() {
  const { formatPrice } = useCurrency()
  const [data, setData] = useState<AnalisisData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const response = await fetch("/api/reportes/analisis-inventario")
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
        <div className="grid gap-4 md:grid-cols-4">
          {[...Array(4)].map((_, i) => (
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
        <CardContent className="py-8 text-center text-muted-foreground">
          {error || "No hay datos disponibles"}
        </CardContent>
      </Card>
    )
  }

  const chartData = data.porCategoria.slice(0, 8).map((cat) => ({
    name: cat.categoria,
    value: cat.valorTotal,
  }))

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Total Items</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground hidden sm:block" />
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-base sm:text-2xl font-bold">{data.resumen.totalItems}</div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">
              {data.resumen.totalUnidades} uds
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Valor Inventario</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground hidden sm:block" />
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-base sm:text-2xl font-bold truncate">{formatPrice(data.resumen.valorCompra)}</div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Costo compra</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Margen Pot.</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500 hidden sm:block" />
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-base sm:text-2xl font-bold text-green-600 truncate">
              {formatPrice(data.resumen.margenPotencial)}
            </div>
            <p className="text-[10px] sm:text-xs text-muted-foreground hidden sm:block">
              Si se vende todo
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 sm:p-6 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Stock Crítico</CardTitle>
            <AlertTriangle className="h-4 w-4 text-yellow-500 hidden sm:block" />
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="text-base sm:text-2xl font-bold text-yellow-600">
              {data.resumen.itemsStockCritico}
            </div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">
              {data.resumen.itemsSinStock} sin stock
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Chart por Categoría */}
        {chartData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">Valor por Categoría</CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Distribución del valor del inventario
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[250px] sm:h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                      label={({ percent }) =>
                        `${(percent * 100).toFixed(0)}%`
                      }
                      fontSize={11}
                    >
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${entry.name}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => formatPrice(value)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Items Más Valiosos */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <DollarSign className="h-4 w-4 sm:h-5 sm:w-5 text-green-500" />
              Items Más Valiosos
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Mayor valor en stock
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.masValiosos.length === 0 ? (
              <p className="text-center text-muted-foreground py-4">
                No hay items con valor en stock
              </p>
            ) : (
              <div className="space-y-2">
                {data.masValiosos.slice(0, 5).map((item, index) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-2.5 sm:p-3 border rounded-lg gap-2"
                  >
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                      <span className="text-xs sm:text-sm font-medium text-muted-foreground shrink-0">
                        #{index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium text-xs sm:text-sm truncate">{item.nombre}</p>
                        <p className="text-[10px] sm:text-xs text-muted-foreground">
                          {item.stock} uds x {formatPrice(item.precioCompra || 0)}
                        </p>
                      </div>
                    </div>
                    <Badge variant="default" className="bg-green-500 text-[10px] sm:text-xs shrink-0">
                      {formatPrice(item.valorEnStock)}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Stock Crítico */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Stock Crítico
          </CardTitle>
          <CardDescription>
            Items con menos de 5 unidades en stock
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.stockCritico.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">
              No hay items con stock crítico
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.stockCritico.slice(0, 12).map((item) => (
                <div
                  key={item.id}
                  className={`p-3 border rounded-lg ${
                    item.stock === 0
                      ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20"
                      : "border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/20"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-medium text-sm truncate">{item.nombre}</p>
                    <Badge
                      variant={item.stock === 0 ? "destructive" : "secondary"}
                    >
                      {item.stock === 0 ? "Sin stock" : `${item.stock} uds`}
                    </Badge>
                  </div>
                  {item.codigo && (
                    <p className="text-xs text-muted-foreground">
                      Código: {item.codigo}
                    </p>
                  )}
                  {item.categoria && (
                    <p className="text-xs text-muted-foreground">
                      {item.categoria}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Categorías */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-blue-500" />
            Resumen por Categoría
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {data.porCategoria.map((cat) => {
              const porcentaje =
                data.resumen.valorCompra > 0
                  ? (cat.valorTotal / data.resumen.valorCompra) * 100
                  : 0
              return (
                <div key={cat.categoria} className="space-y-1.5">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 text-sm">
                    <span className="font-medium">{cat.categoria}</span>
                    <span className="text-xs text-muted-foreground">
                      {cat.cantidad} items · {cat.stockTotal} uds · {formatPrice(cat.valorTotal)}
                    </span>
                  </div>
                  <Progress value={porcentaje} className="h-2" />
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
