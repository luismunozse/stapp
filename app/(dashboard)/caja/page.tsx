"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  DollarSign,
  Banknote,
  ArrowRightLeft,
  CreditCard,
  Wallet,
  PiggyBank,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertTriangle,
  Wrench,
  ShoppingBag,
  FileText,
} from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import Link from "next/link"

const METODO_ICONS: Record<string, any> = {
  EFECTIVO: Banknote,
  TRANSFERENCIA: ArrowRightLeft,
  TARJETA_DEBITO: CreditCard,
  TARJETA_CREDITO: CreditCard,
  MERCADOPAGO: Wallet,
  CUENTA_CORRIENTE: PiggyBank,
  OTRO: MoreHorizontal,
}

const METODO_LABELS: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA_DEBITO: "Tarjeta Débito",
  TARJETA_CREDITO: "Tarjeta Crédito",
  MERCADOPAGO: "MercadoPago",
  CUENTA_CORRIENTE: "Cuenta Corriente",
  OTRO: "Otro",
}

const TIPO_LABELS: Record<string, { label: string; icon: any; color: string }> = {
  COBRO_ORDEN: { label: "Cobro de Orden", icon: Wrench, color: "text-blue-600" },
  PAGO_FACTURA: { label: "Pago Factura", icon: FileText, color: "text-purple-600" },
  PAGO_VENTA: { label: "Venta", icon: ShoppingBag, color: "text-green-600" },
  DEPOSITO_CUENTA: { label: "Depósito a Cuenta", icon: PiggyBank, color: "text-amber-600" },
}

interface Movimiento {
  tipo: string
  monto: number
  metodoPago: string
  fecha: string
  referencia: string
  referenciaId: string
  observaciones: string | null
}

interface OrdenSinCobrar {
  id: string
  numeroOrden: number
  costoFinal: number
  totalCobrado: number
  pendiente: number
}

export default function CajaPage() {
  const { formatPrice, formatDate } = useCurrency()
  const [fecha, setFecha] = useState(new Date().toISOString().split("T")[0])
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<{
    totalDia: number
    movimientos: Movimiento[]
    porMetodo: Record<string, number>
    porTipo: Record<string, { count: number; total: number }>
    sinCobrar: { count: number; ordenes: OrdenSinCobrar[] }
  } | null>(null)

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/caja?fecha=${fecha}`)
      if (res.ok) {
        setData(await res.json())
      }
    } catch (err) {
      console.error("Error fetching caja:", err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [fecha])

  const cambiarDia = (delta: number) => {
    const d = new Date(fecha)
    d.setDate(d.getDate() + delta)
    setFecha(d.toISOString().split("T")[0])
  }

  const esHoy = fecha === new Date().toISOString().split("T")[0]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Caja Diaria</h1>
        <p className="text-muted-foreground">Resumen de ingresos del día</p>
      </div>

      {/* Selector de fecha */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" onClick={() => cambiarDia(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Input
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="w-auto"
        />
        <Button variant="outline" size="icon" onClick={() => cambiarDia(1)} disabled={esHoy}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        {!esHoy && (
          <Button variant="ghost" size="sm" onClick={() => setFecha(new Date().toISOString().split("T")[0])}>
            Hoy
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : data ? (
        <>
          {/* Total del día */}
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <div className="text-sm text-muted-foreground">Total del Día</div>
                <div className="text-4xl font-bold text-primary mt-1">
                  {formatPrice(data.totalDia)}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  {data.movimientos.length} movimiento{data.movimientos.length !== 1 ? "s" : ""}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Resumen por método de pago */}
          {Object.keys(data.porMetodo).length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {Object.entries(data.porMetodo)
                .sort(([, a], [, b]) => b - a)
                .map(([metodo, total]) => {
                  const Icon = METODO_ICONS[metodo] || DollarSign
                  return (
                    <Card key={metodo}>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-1">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">
                            {METODO_LABELS[metodo] || metodo}
                          </span>
                        </div>
                        <div className="text-lg font-bold">{formatPrice(total)}</div>
                      </CardContent>
                    </Card>
                  )
                })}
            </div>
          )}

          {/* Resumen por tipo */}
          {Object.keys(data.porTipo).length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Por Origen</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {Object.entries(data.porTipo).map(([tipo, info]) => {
                    const tipoInfo = TIPO_LABELS[tipo] || { label: tipo, icon: DollarSign, color: "text-gray-600" }
                    const Icon = tipoInfo.icon
                    return (
                      <div key={tipo} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                        <div className="flex items-center gap-2">
                          <Icon className={`h-4 w-4 ${tipoInfo.color}`} />
                          <span className="text-sm">{tipoInfo.label}</span>
                          <Badge variant="outline" className="text-xs">{info.count}</Badge>
                        </div>
                        <span className="font-medium">{formatPrice(info.total)}</span>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Órdenes sin cobrar */}
          {data.sinCobrar.count > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  Órdenes Reparadas sin Cobrar ({data.sinCobrar.count})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.sinCobrar.ordenes.map((o) => (
                    <Link
                      key={o.id}
                      href={`/ordenes/${o.id}`}
                      className="flex items-center justify-between p-2 bg-muted/50 rounded hover:bg-muted transition-colors"
                    >
                      <span className="text-sm font-medium">
                        Orden #{String(o.numeroOrden).padStart(4, "0")}
                      </span>
                      <div className="text-right">
                        <div className="text-sm font-medium text-red-600">
                          {formatPrice(o.pendiente)}
                        </div>
                        {o.totalCobrado > 0 && (
                          <div className="text-xs text-muted-foreground">
                            Cobrado: {formatPrice(o.totalCobrado)}
                          </div>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Detalle de movimientos */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Detalle de Movimientos</CardTitle>
            </CardHeader>
            <CardContent>
              {data.movimientos.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No hay movimientos en esta fecha
                </div>
              ) : (
                <div className="space-y-2">
                  {data.movimientos.map((mov, i) => {
                    const tipoInfo = TIPO_LABELS[mov.tipo] || { label: mov.tipo, icon: DollarSign, color: "text-gray-600" }
                    const Icon = tipoInfo.icon
                    const MetodoIcon = METODO_ICONS[mov.metodoPago] || DollarSign
                    return (
                      <div key={i} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div className="flex items-start gap-2">
                          <Icon className={`h-4 w-4 mt-0.5 ${tipoInfo.color}`} />
                          <div className="space-y-0.5">
                            <div className="text-sm font-medium">{tipoInfo.label}</div>
                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                              <MetodoIcon className="h-3 w-3" />
                              {METODO_LABELS[mov.metodoPago] || mov.metodoPago}
                              {" · "}
                              {new Date(mov.fecha).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                            </div>
                            {mov.observaciones && (
                              <div className="text-xs text-muted-foreground">{mov.observaciones}</div>
                            )}
                          </div>
                        </div>
                        <div className="text-sm font-bold text-green-600">
                          +{formatPrice(mov.monto)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          Error al cargar datos
        </div>
      )}
    </div>
  )
}
