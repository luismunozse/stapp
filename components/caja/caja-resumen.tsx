"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  DollarSign,
  Banknote,
  ArrowRightLeft,
  CreditCard,
  Wallet,
  PiggyBank,
  MoreHorizontal,
  AlertTriangle,
  Wrench,
  ShoppingBag,
  FileText,
  TrendingUp,
  TrendingDown,
  Receipt,
} from "lucide-react"
import { StatCard } from "@/components/dashboard/stat-card"
import { useCurrency } from "@/contexts/currency-context"
import { EmptyState } from "@/components/ui/empty-state"
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
  COBRO_ORDEN: { label: "Cobro de Orden", icon: Wrench, color: "text-info-600" },
  PAGO_FACTURA: { label: "Pago Factura", icon: FileText, color: "text-purple-600" },
  PAGO_VENTA: { label: "Venta", icon: ShoppingBag, color: "text-success-600" },
  DEPOSITO_CUENTA: { label: "Depósito a Cuenta", icon: PiggyBank, color: "text-warning-600" },
  INGRESO_MANUAL: { label: "Ingreso Manual", icon: TrendingUp, color: "text-success-600" },
  EGRESO_MANUAL: { label: "Egreso Manual", icon: TrendingDown, color: "text-destructive" },
}

interface CajaResumenProps {
  data: {
    totalDia: number
    movimientos: any[]
    porMetodo: Record<string, number>
    porTipo: Record<string, { count: number; total: number; items?: Array<{ referenciaId: string; referenciaNumero?: string | null; monto: number }> }>
    totalIngresos: number
    totalEgresos: number
    totalCostosFinancieros?: number
    ingresoReal?: number
    sinCobrar: { count: number; ordenes: any[] }
  } | null
  filtroMetodo: string
  filtroTipo: string
  onFiltroMetodoChange: (v: string) => void
  onFiltroTipoChange: (v: string) => void
}

export function CajaResumen({
  data,
  filtroMetodo,
  filtroTipo,
  onFiltroMetodoChange,
  onFiltroTipoChange,
}: CajaResumenProps) {
  const { formatPrice, timezone } = useCurrency()

  if (!data) return null

  return (
    <div className="space-y-4">
      {/* Total del día */}
      <StatCard
        title="Total del Día"
        value={formatPrice(data.totalDia)}
        description={[
          `${data.movimientos.length} movimiento${data.movimientos.length !== 1 ? "s" : ""}`,
          data.totalEgresos > 0
            ? `Ingresos: ${formatPrice(data.totalIngresos)} · Egresos: ${formatPrice(data.totalEgresos)}`
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
        icon={Banknote}
        tone="default"
      />
      {data.totalCostosFinancieros != null && data.totalCostosFinancieros > 0 && (
        <div className="mt-2 p-2 bg-destructive/10 dark:bg-destructive/15 border border-destructive/25 rounded-lg inline-block">
          <div className="text-xs text-muted-foreground">Costo terminales</div>
          <div className="text-sm font-medium text-destructive">-{formatPrice(data.totalCostosFinancieros)}</div>
          <div className="text-xs text-muted-foreground">
            Ingreso real: <span className="font-semibold text-foreground">{formatPrice(data.ingresoReal ?? data.totalDia)}</span>
          </div>
        </div>
      )}

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
                    <div className={`text-lg font-bold ${total < 0 ? "text-destructive" : ""}`}>
                      {formatPrice(total)}
                    </div>
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
                const linkBase = tipo === "COBRO_ORDEN" ? "/ordenes/" :
                  tipo === "PAGO_VENTA" ? "/ventas/" :
                  tipo === "PAGO_FACTURA" ? "/facturacion/" : null
                return (
                  <div key={tipo} className="p-2 bg-muted/50 rounded space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${tipoInfo.color}`} />
                        <span className="text-sm">{tipoInfo.label}</span>
                        <Badge variant="outline" className="text-xs">{info.count}</Badge>
                      </div>
                      <span className={`font-medium ${tipo === "EGRESO_MANUAL" ? "text-destructive" : ""}`}>
                        {tipo === "EGRESO_MANUAL" ? "-" : ""}{formatPrice(info.total)}
                      </span>
                    </div>
                    {linkBase && info.items && info.items.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pl-6">
                        {info.items.map((item, idx) => (
                          <Link
                            key={`${item.referenciaId}-${idx}`}
                            href={`${linkBase}${item.referenciaId}`}
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            {item.referenciaNumero || item.referenciaId.slice(0, 8)}
                            <span className="text-muted-foreground">{formatPrice(item.monto)}</span>
                          </Link>
                        ))}
                      </div>
                    )}
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
              {data.sinCobrar.ordenes.map((o: any) => (
                <Link
                  key={o.id}
                  href={`/ordenes/${o.id}`}
                  className="flex items-center justify-between p-2 bg-muted/50 rounded hover:bg-muted transition-colors"
                >
                  <span className="text-sm font-medium">
                    Orden #{String(o.numeroOrden).padStart(4, "0")}
                  </span>
                  <div className="text-right">
                    <div className="text-sm font-medium text-destructive">
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

      {/* Filtros + Detalle de movimientos */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <CardTitle className="text-base">Detalle de Movimientos</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Select value={filtroMetodo || "all"} onValueChange={(v) => onFiltroMetodoChange(v === "all" ? "" : v)}>
                <SelectTrigger className="w-full sm:w-[160px] h-8 text-xs">
                  <SelectValue placeholder="Método" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los métodos</SelectItem>
                  {Object.entries(METODO_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filtroTipo || "all"} onValueChange={(v) => onFiltroTipoChange(v === "all" ? "" : v)}>
                <SelectTrigger className="w-full sm:w-[160px] h-8 text-xs">
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los tipos</SelectItem>
                  {Object.entries(TIPO_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {data.movimientos.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="Sin movimientos"
              description="No hay movimientos en esta fecha"
              variant="search"
            />
          ) : (
            <div className="space-y-2">
              {data.movimientos.map((mov: any, i: number) => {
                const tipoInfo = TIPO_LABELS[mov.tipo] || { label: mov.tipo, icon: DollarSign, color: "text-gray-600" }
                const Icon = tipoInfo.icon
                const MetodoIcon = METODO_ICONS[mov.metodoPago] || DollarSign
                const movLink = mov.tipo === "COBRO_ORDEN" ? `/ordenes/${mov.referenciaId}` :
                  mov.tipo === "PAGO_VENTA" ? `/ventas/${mov.referenciaId}` :
                  mov.tipo === "PAGO_FACTURA" ? `/facturacion/${mov.referenciaId}` : null
                const displayName = mov.referenciaNumero
                  ? `${tipoInfo.label} · ${mov.referenciaNumero}`
                  : (mov.referencia || tipoInfo.label)

                return (
                  <div key={i} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-start gap-2">
                      <Icon className={`h-4 w-4 mt-0.5 ${tipoInfo.color}`} />
                      <div className="space-y-0.5">
                        <div className="text-sm font-medium">
                          {movLink ? (
                            <Link href={movLink} className="hover:underline text-primary">
                              {displayName}
                            </Link>
                          ) : (
                            displayName
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <MetodoIcon className="h-3 w-3" />
                          {METODO_LABELS[mov.metodoPago] || mov.metodoPago}
                          {" · "}
                          {new Date(mov.fecha).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: timezone })}
                        </div>
                        {mov.observaciones && (
                          <div className="text-xs text-muted-foreground">{mov.observaciones}</div>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-sm font-bold ${mov.esEgreso ? "text-destructive" : "text-success-600"}`}>
                        {mov.esEgreso ? "-" : "+"}
                        {formatPrice(mov.monto)}
                      </div>
                      {mov.costoFinancieroMonto > 0 && (
                        <div className="text-xs text-destructive">
                          Terminal: -{formatPrice(mov.costoFinancieroMonto)}
                          <span className="text-muted-foreground ml-1">({mov.costoFinancieroPorcentaje}%)</span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
