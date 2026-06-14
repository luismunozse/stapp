"use client"

import { useState } from "react"
import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Trash2, TrendingUp, TrendingDown, Loader2, Paperclip, Repeat } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

const METODO_LABELS: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA_DEBITO: "Tarjeta Débito",
  TARJETA_CREDITO: "Tarjeta Crédito",
  MERCADOPAGO: "MercadoPago",
  OTRO: "Otro",
}

interface MovimientosManualesListProps {
  fecha: string
  refreshKey?: number
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function MovimientosManualesList({ fecha, refreshKey }: MovimientosManualesListProps) {
  const { formatPrice } = useCurrency()
  const { data, isLoading, mutate } = useSWR(
    `/api/caja/movimientos?fecha=${fecha}&_=${refreshKey || 0}`,
    fetcher,
    { revalidateOnFocus: false }
  )
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const movimientos = data?.movimientos || []

  const handleDelete = async () => {
    if (!deleteId) return
    setDeleteLoading(true)
    try {
      const res = await fetch(`/api/caja/movimientos/${deleteId}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Error al eliminar")
      setDeleteId(null)
      mutate()
    } catch {
      alert("Error al eliminar movimiento")
    } finally {
      setDeleteLoading(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (movimientos.length === 0) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={TrendingUp}
            title="Sin movimientos"
            description="No hay movimientos manuales en esta fecha"
            variant="search"
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Movimientos del día ({movimientos.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {movimientos.map((m: any) => (
              <div
                key={m.id}
                className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
              >
                <div className="flex items-start gap-2">
                  {m.tipo === "INGRESO" ? (
                    <TrendingUp className="h-4 w-4 mt-0.5 text-success-600" />
                  ) : (
                    <TrendingDown className="h-4 w-4 mt-0.5 text-destructive" />
                  )}
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                      {m.concepto}
                      {m.categoria && (
                        <Badge
                          variant="secondary"
                          className="text-xs font-normal gap-1"
                          style={
                            m.categoria.color
                              ? {
                                  backgroundColor: `${m.categoria.color}20`,
                                  color: m.categoria.color,
                                  borderColor: `${m.categoria.color}40`,
                                }
                              : undefined
                          }
                        >
                          {m.categoria.color && (
                            <span
                              className="inline-block w-1.5 h-1.5 rounded-full"
                              style={{ backgroundColor: m.categoria.color }}
                            />
                          )}
                          {m.categoria.nombre}
                        </Badge>
                      )}
                      {m.tipo === "EGRESO" && m.afectaRentabilidad === false && (
                        <Badge variant="outline" className="text-xs font-normal">
                          No afecta resultado
                        </Badge>
                      )}
                      {m.esRecurrente && (
                        <Badge variant="outline" className="text-xs font-normal gap-1">
                          <Repeat className="h-2.5 w-2.5" />
                          Recurrente
                        </Badge>
                      )}
                      {m.comprobanteUrl && (
                        <a
                          href={m.comprobanteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Ver comprobante"
                          className="text-muted-foreground hover:text-primary"
                        >
                          <Paperclip className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                    <div className="text-caption-mobile flex items-center gap-1">
                      <Badge
                        variant="outline"
                        className={`text-xs ${
                          m.tipo === "INGRESO"
                            ? "text-success-600 border-success-200"
                            : "text-destructive border-destructive/30"
                        }`}
                      >
                        {m.tipo === "INGRESO" ? "Ingreso" : "Egreso"}
                      </Badge>
                      {METODO_LABELS[m.metodoPago] || m.metodoPago}
                      {" · "}
                      {new Date(m.fecha).toLocaleTimeString("es-AR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {m.usuarioNombre && ` · ${m.usuarioNombre}`}
                    </div>
                    {m.observaciones && (
                      <div className="text-caption-mobile">{m.observaciones}</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-bold ${
                      m.tipo === "INGRESO" ? "text-success-600" : "text-destructive"
                    }`}
                  >
                    {m.tipo === "INGRESO" ? "+" : "-"}
                    {formatPrice(m.monto)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteId(m.id)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Eliminar Movimiento"
        description="Esta acción eliminará el movimiento manual y no se puede deshacer."
        confirmText="Eliminar"
        cancelText="Cancelar"
        variant="danger"
        loading={deleteLoading}
        onConfirm={handleDelete}
      />
    </>
  )
}
