"use client"

import { useState } from "react"
import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ShoppingCart,
  Calendar,
  Receipt,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Banknote,
  ArrowRightLeft,
  CreditCard,
  Wallet,
  MoreHorizontal,
  Percent,
  XCircle,
} from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

const fetcher = (url: string) => fetch(url).then(res => res.json())

const METODO_LABELS: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA: "Tarjeta",
  TARJETA_DEBITO: "T. Débito",
  TARJETA_CREDITO: "T. Crédito",
  MERCADOPAGO: "MercadoPago",
  OTRO: "Otro",
}

const METODO_ICONS: Record<string, any> = {
  EFECTIVO: Banknote,
  TRANSFERENCIA: ArrowRightLeft,
  TARJETA: CreditCard,
  TARJETA_DEBITO: CreditCard,
  TARJETA_CREDITO: CreditCard,
  MERCADOPAGO: Wallet,
  OTRO: MoreHorizontal,
}

export function VentasDashboard() {
  const { formatPrice } = useCurrency()
  const [expanded, setExpanded] = useState(true)
  const { data, isLoading } = useSWR("/api/reportes/ventas-analytics", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Dashboard de Ventas</h3>
        </div>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="h-4 bg-muted animate-pulse rounded w-1/2 mb-2" />
                <div className="h-6 bg-muted animate-pulse rounded w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (!data || data.error) return null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Dashboard de Ventas</h3>
        <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {expanded ? "Ocultar" : "Mostrar"}
        </Button>
      </div>

      {/* KPI Cards - Always visible */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-muted-foreground">Ventas Hoy</span>
              <ShoppingCart className="h-4 w-4 text-primary" />
            </div>
            <div className="text-xl font-bold">{formatPrice(data.ventasHoy.total)}</div>
            <p className="text-xs text-muted-foreground">{data.ventasHoy.count} venta{data.ventasHoy.count !== 1 ? "s" : ""}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-muted-foreground">Ventas del Mes</span>
              <Calendar className="h-4 w-4 text-blue-500" />
            </div>
            <div className="text-xl font-bold">{formatPrice(data.ventasMes.total)}</div>
            <p className="text-xs text-muted-foreground">{data.ventasMes.count} ventas</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-muted-foreground">Ticket Promedio</span>
              <Receipt className="h-4 w-4 text-purple-500" />
            </div>
            <div className="text-xl font-bold">{formatPrice(data.ticketPromedio)}</div>
            <p className="text-xs text-muted-foreground">este mes</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-muted-foreground">Margen Bruto</span>
              <TrendingUp className="h-4 w-4 text-emerald-500" />
            </div>
            <div className={`text-xl font-bold ${data.margenBruto.porcentaje >= 0 ? "text-emerald-600" : "text-destructive"}`}>
              {data.margenBruto.porcentaje.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">{formatPrice(data.margenBruto.margen)}</p>
          </CardContent>
        </Card>
      </div>

      {expanded && (
        <>
          {/* Second Row: Top Products + Top Sellers */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Top 5 Productos</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {data.topProductos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin datos este mes</p>
                ) : (
                  <div className="space-y-2">
                    {data.topProductos.map((p: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`text-xs font-bold w-5 text-center ${
                            i === 0 ? "text-amber-500" : i === 1 ? "text-gray-400" : i === 2 ? "text-amber-700" : "text-muted-foreground"
                          }`}>
                            {i + 1}
                          </span>
                          <span className="truncate">{p.descripcion}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <Badge variant="secondary" className="text-[10px]">{p.cantidad} uds</Badge>
                          <span className="font-medium text-right text-xs sm:text-sm">{formatPrice(p.totalVentas)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Top 5 Vendedores</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {data.topVendedores.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin datos este mes</p>
                ) : (
                  <div className="space-y-2">
                    {data.topVendedores.map((v: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`text-xs font-bold w-5 text-center ${
                            i === 0 ? "text-amber-500" : i === 1 ? "text-gray-400" : i === 2 ? "text-amber-700" : "text-muted-foreground"
                          }`}>
                            {i + 1}
                          </span>
                          <span className="truncate">{v.nombre}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <Badge variant="secondary" className="text-[10px]">{v.count} ventas</Badge>
                          <span className="font-medium text-right text-xs sm:text-sm">{formatPrice(v.total)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Third Row: Payment Methods + Discounts + Cancellation */}
          <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Métodos de Pago</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  {data.ventasPorMetodoPago.map((m: any) => {
                    const Icon = METODO_ICONS[m.metodo] || MoreHorizontal
                    return (
                      <div key={m.metodo} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>{METODO_LABELS[m.metodo] || m.metodo}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">{m.count}</Badge>
                          <span className="font-medium">{formatPrice(m.total)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                  <Percent className="h-3.5 w-3.5" />
                  Descuentos del Mes
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <div>
                  <div className="text-xs text-muted-foreground">Total descontado</div>
                  <div className="text-lg font-bold text-destructive">{formatPrice(data.descuentosOtorgados.totalDescuentos)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Ventas con descuento</div>
                  <div className="text-lg font-bold">{data.descuentosOtorgados.cantidadConDescuento}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">% sobre ventas totales</div>
                  <div className="text-lg font-bold">{data.descuentosOtorgados.promedioDescuento.toFixed(1)}%</div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                  <XCircle className="h-3.5 w-3.5" />
                  Tasa de Anulación
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className={`text-3xl font-bold ${
                  data.tasaAnulacion.porcentaje > 10 ? "text-destructive" :
                  data.tasaAnulacion.porcentaje > 5 ? "text-amber-500" : "text-emerald-600"
                }`}>
                  {data.tasaAnulacion.porcentaje.toFixed(1)}%
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {data.tasaAnulacion.anuladas} anulada{data.tasaAnulacion.anuladas !== 1 ? "s" : ""} de {data.tasaAnulacion.total} ventas
                </p>
                <div className="mt-3 text-xs text-muted-foreground">
                  {data.tasaAnulacion.porcentaje <= 5 && "Excelente - tasa saludable"}
                  {data.tasaAnulacion.porcentaje > 5 && data.tasaAnulacion.porcentaje <= 10 && "Atención - revisar motivos"}
                  {data.tasaAnulacion.porcentaje > 10 && "Alerta - tasa alta, investigar causas"}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
