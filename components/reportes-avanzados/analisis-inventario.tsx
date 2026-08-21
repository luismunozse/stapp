"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Package, AlertTriangle, DollarSign, Layers, TrendingUp, AlertCircle } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { StatCard } from "@/components/dashboard/stat-card"
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
  valorEnStock?: number | null
}

interface CategoriaResumen {
  categoria: string
  cantidad: number
  stockTotal: number
  /** null cuando el rol no puede ver costos de compra: el total por categoría
   *  se reduce al costo de un item si la categoría tiene un único SKU. */
  valorTotal: number | null
}

interface AnalisisData {
  resumen: {
    totalItems: number
    totalUnidades: number
    valorCompra: number
    valorVenta: number
    /** No se oculta: es valorVenta - valorCompra y las dos cifras vienen en
     *  este mismo resumen, así que un gate acá lo defiende una resta. */
    margenPotencial: number
    itemsSinStock: number
    itemsStockCritico: number
    categorias: number
  }
  stockCritico: ItemInventario[]
  sinStock: ItemInventario[]
  porCategoria: CategoriaResumen[]
  masValiosos: (ItemInventario & { valorEnStock: number | null })[]
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
        <CardContent className="py-4">
          <EmptyState
            icon={AlertCircle}
            title={error ? "Error al cargar datos" : "Sin datos disponibles"}
            description={error || "No hay datos de inventario para mostrar"}
            variant={error ? "error" : "search"}
          />
        </CardContent>
      </Card>
    )
  }

  // El endpoint devuelve el valor por categoría en null para los roles sin
  // acceso a costos de compra. Sin filtrar, el gráfico dibuja porciones de $0:
  // un número real en vez de un permiso faltante.
  const chartData = data.porCategoria
    .filter((cat): cat is CategoriaResumen & { valorTotal: number } => cat.valorTotal !== null)
    .slice(0, 8)
    .map((cat) => ({
      name: cat.categoria,
      value: cat.valorTotal,
    }))

  // Sin acceso a costo, el endpoint ya no ordena masValiosos por valor (el
  // orden solo devolvía el ranking de costo): la lista llega ordenada por
  // stock. La card tiene que decir eso — titularla "Más Valiosos" sobre una
  // lista ordenada por unidades es afirmar algo que la lista no dice.
  const valorPorItemOculto = data.masValiosos.some((item) => item.valorEnStock === null)

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          title="Total Items"
          value={String(data.resumen.totalItems)}
          description={`${data.resumen.totalUnidades} uds`}
          icon={Package}
          tone="default"
        />
        <StatCard
          title="Valor Inventario"
          value={formatPrice(data.resumen.valorCompra)}
          description="Costo compra"
          icon={DollarSign}
          tone="default"
        />
        <StatCard
          title="Margen Pot."
          value={formatPrice(data.resumen.margenPotencial)}
          description="Si se vende todo"
          icon={TrendingUp}
          tone="success"
        />
        <StatCard
          title="Stock Crítico"
          value={String(data.resumen.itemsStockCritico)}
          description={`${data.resumen.itemsSinStock} sin stock`}
          icon={AlertTriangle}
          tone="warning"
        />
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

        {/* Items Más Valiosos (o, sin acceso a costo, los de más stock) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <DollarSign className="h-4 w-4 sm:h-5 sm:w-5 text-success" />
              {valorPorItemOculto ? "Items con más stock" : "Items Más Valiosos"}
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              {valorPorItemOculto ? "Mayor cantidad de unidades" : "Mayor valor en stock"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.masValiosos.length === 0 ? (
              <EmptyState
                icon={Package}
                title="Sin items con valor"
                description="No hay items con valor en stock"
                variant="search"
              />
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
                        {/* El endpoint devuelve null en el costo por item para
                            los roles sin acceso a inventario: se oculta, no se
                            pinta como $0. */}
                        <p className="text-[10px] sm:text-xs text-muted-foreground">
                          {item.precioCompra !== null
                            ? `${item.stock} uds x ${formatPrice(item.precioCompra)}`
                            : `${item.stock} uds`}
                        </p>
                      </div>
                    </div>
                    {item.valorEnStock != null && (
                      <Badge variant="default" className="bg-success text-white text-[10px] sm:text-xs shrink-0">
                        {formatPrice(item.valorEnStock)}
                      </Badge>
                    )}
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
            <AlertTriangle className="h-5 w-5 text-warning" />
            Stock Crítico
          </CardTitle>
          <CardDescription>
            Items con menos de 5 unidades en stock
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.stockCritico.length === 0 ? (
            <EmptyState
              icon={AlertTriangle}
              title="Sin stock crítico"
              description="No hay items con stock crítico"
              variant="search"
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.stockCritico.slice(0, 12).map((item) => (
                <div
                  key={item.id}
                  className={`p-3 border rounded-lg ${
                    item.stock === 0
                      ? "border-destructive/20 bg-destructive/5"
                      : "border-warning/25 bg-warning-50 dark:bg-warning/10"
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
            <Layers className="h-5 w-5 text-info" />
            Resumen por Categoría
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {data.porCategoria.map((cat) => {
              const porcentaje =
                cat.valorTotal !== null && data.resumen.valorCompra > 0
                  ? (cat.valorTotal / data.resumen.valorCompra) * 100
                  : null
              return (
                <div key={cat.categoria} className="space-y-1.5">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 text-sm">
                    <span className="font-medium">{cat.categoria}</span>
                    <span className="text-xs text-muted-foreground">
                      {cat.cantidad} items · {cat.stockTotal} uds
                      {cat.valorTotal !== null ? ` · ${formatPrice(cat.valorTotal)}` : ""}
                    </span>
                  </div>
                  {porcentaje !== null && <Progress value={porcentaje} className="h-2" />}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
