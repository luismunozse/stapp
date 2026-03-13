"use client"

import { useState } from "react"
import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Package,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  RotateCcw,
  Layers,
  Wallet,
} from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

const fetcher = (url: string) => fetch(url).then(res => res.json())

const TABS = [
  { id: "rotacion", label: "Rotación", icon: RotateCcw },
  { id: "muerto", label: "Stock Muerto", icon: AlertTriangle },
  { id: "reorden", label: "Punto de Reorden", icon: Package },
  { id: "categorias", label: "Por Categoría", icon: Layers },
] as const

type TabId = typeof TABS[number]["id"]

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function InventarioAnalytics({ open, onOpenChange }: Props) {
  const { formatPrice } = useCurrency()
  const [activeTab, setActiveTab] = useState<TabId>("rotacion")

  const { data, isLoading } = useSWR(
    open ? "/api/reportes/inventario-analytics" : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Análisis de Inventario</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4">
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              {[...Array(4)].map((_, i) => (
                <Card key={i}><CardContent className="p-4"><div className="h-12 bg-muted animate-pulse rounded" /></CardContent></Card>
              ))}
            </div>
            <div className="h-48 bg-muted animate-pulse rounded" />
          </div>
        ) : !data || data.error ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Error al cargar datos</p>
        ) : (
          <div className="space-y-4">
            {/* Summary Cards */}
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase">Capital Invertido</span>
                    <Wallet className="h-3.5 w-3.5 text-blue-500" />
                  </div>
                  <div className="text-lg font-bold">{formatPrice(data.valorizacion.valorCosto)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase">Valor en Venta</span>
                    <DollarSign className="h-3.5 w-3.5 text-emerald-500" />
                  </div>
                  <div className="text-lg font-bold">{formatPrice(data.valorizacion.valorVenta)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase">Margen Potencial</span>
                    <TrendingUp className="h-3.5 w-3.5 text-purple-500" />
                  </div>
                  <div className="text-lg font-bold text-emerald-600">{formatPrice(data.valorizacion.margenPotencial)}</div>
                  <p className="text-[10px] text-muted-foreground">
                    {data.valorizacion.valorCosto > 0
                      ? `${((data.valorizacion.margenPotencial / data.valorizacion.valorCosto) * 100).toFixed(1)}% sobre costo`
                      : ""}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase">Stock Total</span>
                    <Package className="h-3.5 w-3.5 text-orange-500" />
                  </div>
                  <div className="text-lg font-bold">{data.valorizacion.totalUnidades}</div>
                  <p className="text-[10px] text-muted-foreground">{data.valorizacion.totalItems} productos</p>
                </CardContent>
              </Card>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b pb-1">
              {TABS.map(tab => {
                const Icon = tab.icon
                return (
                  <Button
                    key={tab.id}
                    variant={activeTab === tab.id ? "default" : "ghost"}
                    size="sm"
                    className="text-xs gap-1.5"
                    onClick={() => setActiveTab(tab.id)}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                    {tab.id === "reorden" && data.alertasReorden.length > 0 && (
                      <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4 ml-1">
                        {data.alertasReorden.length}
                      </Badge>
                    )}
                  </Button>
                )
              })}
            </div>

            {/* Tab Content */}
            {activeTab === "rotacion" && (
              <div>
                <p className="text-xs text-muted-foreground mb-3">Productos con mayor rotación en los últimos 90 días</p>
                {data.rotacion.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">Sin datos de rotación</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="pb-2 pr-2">#</th>
                          <th className="pb-2 pr-2">Producto</th>
                          <th className="pb-2 pr-2">Código</th>
                          <th className="pb-2 pr-2 text-right">Vendidas</th>
                          <th className="pb-2 pr-2 text-right">Stock</th>
                          <th className="pb-2 text-right">Rotación</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.rotacion.map((item: any, i: number) => (
                          <tr key={item.inventarioId} className="border-b last:border-0">
                            <td className="py-2 pr-2 text-muted-foreground">{i + 1}</td>
                            <td className="py-2 pr-2 font-medium">{item.nombre}</td>
                            <td className="py-2 pr-2 text-xs text-muted-foreground">{item.codigo}</td>
                            <td className="py-2 pr-2 text-right">{item.totalVendido}</td>
                            <td className="py-2 pr-2 text-right">{item.stock}</td>
                            <td className="py-2 text-right">
                              <Badge variant={
                                item.tasaRotacion > 4 ? "default" :
                                item.tasaRotacion > 2 ? "secondary" : "outline"
                              } className={`text-[10px] ${
                                item.tasaRotacion > 4 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" :
                                item.tasaRotacion > 2 ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" : ""
                              }`}>
                                {item.tasaRotacion}x
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {activeTab === "muerto" && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-muted-foreground">Productos sin ventas en 90 días con stock disponible</p>
                  {data.sinMovimiento.length > 0 && (
                    <Badge variant="destructive" className="text-xs">
                      {formatPrice(data.sinMovimiento.reduce((s: number, i: any) => s + i.capitalInmovilizado, 0))} inmovilizado
                    </Badge>
                  )}
                </div>
                {data.sinMovimiento.length === 0 ? (
                  <p className="text-sm text-emerald-600 py-4 text-center">No hay stock muerto - excelente</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="pb-2 pr-2">Producto</th>
                          <th className="pb-2 pr-2">Código</th>
                          <th className="pb-2 pr-2 text-right">Stock</th>
                          <th className="pb-2 pr-2 text-right">P. Costo</th>
                          <th className="pb-2 text-right">Capital Inmovilizado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.sinMovimiento.map((item: any) => (
                          <tr key={item.id} className="border-b last:border-0">
                            <td className="py-2 pr-2 font-medium">{item.nombre}</td>
                            <td className="py-2 pr-2 text-xs text-muted-foreground">{item.codigo}</td>
                            <td className="py-2 pr-2 text-right">{item.stock}</td>
                            <td className="py-2 pr-2 text-right">{formatPrice(item.precioCompra)}</td>
                            <td className="py-2 text-right font-medium text-destructive">{formatPrice(item.capitalInmovilizado)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {activeTab === "reorden" && (
              <div>
                <p className="text-xs text-muted-foreground mb-3">
                  Productos que necesitan reposición basado en velocidad de venta (últimos 90 días, lead time 2 semanas)
                </p>
                {data.alertasReorden.length === 0 ? (
                  <p className="text-sm text-emerald-600 py-4 text-center">Todos los productos tienen stock suficiente</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="pb-2 pr-2">Producto</th>
                          <th className="pb-2 pr-2 text-right">Stock</th>
                          <th className="pb-2 pr-2 text-right">Venta/día</th>
                          <th className="pb-2 pr-2 text-right">Días restantes</th>
                          <th className="pb-2 pr-2 text-right">Pto. Reorden</th>
                          <th className="pb-2 text-right">Pedir</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.alertasReorden.map((item: any) => (
                          <tr key={item.id} className={`border-b last:border-0 ${
                            item.diasHastaAgotamiento <= 7 ? "bg-destructive/5" :
                            item.diasHastaAgotamiento <= 14 ? "bg-amber-50 dark:bg-amber-900/10" : ""
                          }`}>
                            <td className="py-2 pr-2">
                              <div className="font-medium">{item.nombre}</div>
                              <div className="text-[10px] text-muted-foreground">{item.codigo}</div>
                            </td>
                            <td className="py-2 pr-2 text-right font-medium">{item.stock}</td>
                            <td className="py-2 pr-2 text-right">{item.promedioDiario}</td>
                            <td className="py-2 pr-2 text-right">
                              <span className={`font-medium ${
                                item.diasHastaAgotamiento <= 7 ? "text-destructive" :
                                item.diasHastaAgotamiento <= 14 ? "text-amber-600" : ""
                              }`}>
                                {item.diasHastaAgotamiento} días
                              </span>
                            </td>
                            <td className="py-2 pr-2 text-right">{item.puntoReorden}</td>
                            <td className="py-2 text-right">
                              <Badge variant="outline" className="text-[10px] font-bold">
                                +{item.cantidadSugerida}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {activeTab === "categorias" && (
              <div>
                <p className="text-xs text-muted-foreground mb-3">Resumen de inventario por categoría</p>
                {data.porCategoria.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">Sin datos</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="pb-2 pr-2">Categoría</th>
                          <th className="pb-2 pr-2 text-right">Productos</th>
                          <th className="pb-2 pr-2 text-right">Unidades</th>
                          <th className="pb-2 pr-2 text-right">Valor Costo</th>
                          <th className="pb-2 text-right">Valor Venta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.porCategoria.map((cat: any) => (
                          <tr key={cat.categoria} className="border-b last:border-0">
                            <td className="py-2 pr-2 font-medium">{cat.categoria}</td>
                            <td className="py-2 pr-2 text-right">{cat.items}</td>
                            <td className="py-2 pr-2 text-right">{cat.stock}</td>
                            <td className="py-2 pr-2 text-right text-muted-foreground">{formatPrice(cat.valorCosto)}</td>
                            <td className="py-2 text-right font-medium">{formatPrice(cat.valorVenta)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="font-bold border-t-2">
                          <td className="pt-2 pr-2">Total</td>
                          <td className="pt-2 pr-2 text-right">{data.porCategoria.reduce((s: number, c: any) => s + c.items, 0)}</td>
                          <td className="pt-2 pr-2 text-right">{data.porCategoria.reduce((s: number, c: any) => s + c.stock, 0)}</td>
                          <td className="pt-2 pr-2 text-right">{formatPrice(data.porCategoria.reduce((s: number, c: any) => s + c.valorCosto, 0))}</td>
                          <td className="pt-2 text-right">{formatPrice(data.porCategoria.reduce((s: number, c: any) => s + c.valorVenta, 0))}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
