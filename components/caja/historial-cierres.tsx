"use client"

import { useState } from "react"
import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Loader2, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function HistorialCierres() {
  const { formatPrice, formatDate } = useCurrency()
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")
  const [detailId, setDetailId] = useState<string | null>(null)

  const params = new URLSearchParams()
  if (desde) params.append("desde", desde)
  if (hasta) params.append("hasta", hasta)

  const { data, isLoading } = useSWR(
    `/api/caja/sesiones?${params.toString()}`,
    fetcher,
    { revalidateOnFocus: false }
  )

  const sesiones = data?.sesiones || []

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filtros de fecha */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground whitespace-nowrap">Desde</span>
          <Input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            className="w-auto"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground whitespace-nowrap">Hasta</span>
          <Input
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            className="w-auto"
          />
        </div>
        {(desde || hasta) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setDesde(""); setHasta("") }}
          >
            Limpiar
          </Button>
        )}
      </div>

      {sesiones.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No hay cierres de caja registrados
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium">Fecha</th>
                  <th className="text-left p-3 font-medium hidden sm:table-cell">Apertura</th>
                  <th className="text-right p-3 font-medium">Saldo Inicial</th>
                  <th className="text-right p-3 font-medium hidden md:table-cell">Ingresos</th>
                  <th className="text-right p-3 font-medium hidden md:table-cell">Egresos</th>
                  <th className="text-right p-3 font-medium">Conteo</th>
                  <th className="text-center p-3 font-medium">Diferencia</th>
                  <th className="text-center p-3 font-medium">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {sesiones.map((s: any) => (
                  <tr key={s.id} className="border-b hover:bg-muted/30 transition-colors">
                    <td className="p-3 font-medium">{formatDate(s.fecha)}</td>
                    <td className="p-3 hidden sm:table-cell text-muted-foreground">
                      {s.usuarioApertura?.nombre || "-"}
                    </td>
                    <td className="p-3 text-right">{formatPrice(s.saldoInicial)}</td>
                    <td className="p-3 text-right hidden md:table-cell text-green-600">
                      {s.totalIngresos != null ? formatPrice(s.totalIngresos) : "-"}
                    </td>
                    <td className="p-3 text-right hidden md:table-cell text-red-600">
                      {s.totalEgresos != null ? formatPrice(s.totalEgresos) : "-"}
                    </td>
                    <td className="p-3 text-right">
                      {s.conteoFisico != null ? formatPrice(s.conteoFisico) : "-"}
                    </td>
                    <td className="p-3 text-center">
                      {s.diferencia != null ? (
                        <DiferenciaBadge diferencia={s.diferencia} formatPrice={formatPrice} />
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="p-3 text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDetailId(s.id)}
                      >
                        Ver
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Dialog de detalle */}
      {detailId && (
        <SesionDetailDialog
          sesionId={detailId}
          open={!!detailId}
          onOpenChange={(open) => !open && setDetailId(null)}
        />
      )}
    </div>
  )
}

function DiferenciaBadge({ diferencia, formatPrice }: { diferencia: number; formatPrice: (n: number) => string }) {
  if (diferencia === 0) {
    return (
      <Badge variant="outline" className="text-green-600 border-green-300">
        <Minus className="h-3 w-3 mr-1" />
        Cuadra
      </Badge>
    )
  }
  if (diferencia > 0) {
    return (
      <Badge variant="outline" className="text-amber-600 border-amber-300">
        <TrendingUp className="h-3 w-3 mr-1" />
        +{formatPrice(diferencia)}
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-red-600 border-red-300">
      <TrendingDown className="h-3 w-3 mr-1" />
      -{formatPrice(Math.abs(diferencia))}
    </Badge>
  )
}

function SesionDetailDialog({
  sesionId,
  open,
  onOpenChange,
}: {
  sesionId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { formatPrice, formatDate } = useCurrency()
  const { data, isLoading } = useSWR(
    open ? `/api/caja/sesiones/${sesionId}` : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  const sesion = data?.sesion
  const movimientos = data?.movimientos || []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Detalle de Cierre - {sesion ? formatDate(sesion.fecha) : "..."}
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : sesion ? (
          <div className="space-y-4">
            {/* Resumen */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 bg-muted rounded-lg text-center">
                <div className="text-xs text-muted-foreground">Saldo Inicial</div>
                <div className="font-bold">{formatPrice(sesion.saldoInicial)}</div>
              </div>
              <div className="p-3 bg-muted rounded-lg text-center">
                <div className="text-xs text-muted-foreground">Ingresos</div>
                <div className="font-bold text-green-600">{formatPrice(sesion.totalIngresos || 0)}</div>
              </div>
              <div className="p-3 bg-muted rounded-lg text-center">
                <div className="text-xs text-muted-foreground">Egresos</div>
                <div className="font-bold text-red-600">{formatPrice(sesion.totalEgresos || 0)}</div>
              </div>
              <div className="p-3 bg-muted rounded-lg text-center">
                <div className="text-xs text-muted-foreground">Conteo Físico</div>
                <div className="font-bold">{formatPrice(sesion.conteoFisico || 0)}</div>
              </div>
            </div>

            {/* Arqueo */}
            <div className="p-4 bg-muted rounded-lg space-y-2">
              <div className="text-sm font-medium">Arqueo de Efectivo</div>
              <div className="flex justify-between text-sm">
                <span>Saldo inicial</span>
                <span>{formatPrice(sesion.saldoInicial)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-green-600">+ Ingresos efectivo</span>
                <span className="text-green-600">{formatPrice(sesion.totalIngresosEfectivo || 0)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-red-600">- Egresos efectivo</span>
                <span className="text-red-600">{formatPrice(sesion.totalEgresosEfectivo || 0)}</span>
              </div>
              <div className="border-t pt-2 flex justify-between font-bold text-sm">
                <span>Esperado</span>
                <span>
                  {formatPrice(
                    sesion.saldoInicial +
                      (sesion.totalIngresosEfectivo || 0) -
                      (sesion.totalEgresosEfectivo || 0)
                  )}
                </span>
              </div>
              <div className="flex justify-between font-bold text-sm">
                <span>Conteo físico</span>
                <span>{formatPrice(sesion.conteoFisico || 0)}</span>
              </div>
              {sesion.diferencia != null && (
                <div
                  className={`flex justify-between font-bold text-sm pt-1 border-t ${
                    sesion.diferencia === 0
                      ? "text-green-600"
                      : sesion.diferencia > 0
                      ? "text-amber-600"
                      : "text-red-600"
                  }`}
                >
                  <span>
                    {sesion.diferencia === 0
                      ? "Caja cuadrada"
                      : sesion.diferencia > 0
                      ? "Sobrante"
                      : "Faltante"}
                  </span>
                  <span>{formatPrice(Math.abs(sesion.diferencia))}</span>
                </div>
              )}
            </div>

            {sesion.observacionesCierre && (
              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="text-xs text-muted-foreground mb-1">Observaciones de cierre</div>
                <p className="text-sm">{sesion.observacionesCierre}</p>
              </div>
            )}

            {/* Info usuarios */}
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              {sesion.usuarioApertura && (
                <span>Abierta por: {sesion.usuarioApertura.nombre}</span>
              )}
              {sesion.usuarioCierre && (
                <span>Cerrada por: {sesion.usuarioCierre.nombre}</span>
              )}
              {sesion.openedAt && (
                <span>
                  Apertura:{" "}
                  {new Date(sesion.openedAt).toLocaleTimeString("es-AR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              )}
              {sesion.closedAt && (
                <span>
                  Cierre:{" "}
                  {new Date(sesion.closedAt).toLocaleTimeString("es-AR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              )}
            </div>

            {/* Movimientos */}
            {movimientos.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-2">
                  Movimientos ({movimientos.length})
                </div>
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {movimientos.map((m: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm">
                      <div>
                        <span className="font-medium">{m.referencia || m.tipo}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {new Date(m.fecha).toLocaleTimeString("es-AR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <span className={`font-medium ${m.esEgreso ? "text-red-600" : "text-green-600"}`}>
                        {m.esEgreso ? "-" : "+"}
                        {formatPrice(m.monto)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">Error al cargar detalle</div>
        )}
      </DialogContent>
    </Dialog>
  )
}
