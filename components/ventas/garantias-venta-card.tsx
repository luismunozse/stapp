"use client"

import { useCallback, useEffect, useState } from "react"
import { Download, MessageSquareWarning, Shield } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useCurrency } from "@/contexts/currency-context"
import { textoVencimiento } from "@/lib/garantias/estado"
import type { GarantiaConReclamos } from "@/lib/garantias/reclamos"
import type { ReclamoGarantiaApi } from "@/lib/garantias/formato"
import { EstadoGarantiaPill } from "@/components/garantias/estado-garantia-pill"
import { RegistrarReclamoDialog } from "@/components/garantias/registrar-reclamo-dialog"
import { DecidirReclamoDialog, type DecidirReclamoDialogProps } from "@/components/garantias/decidir-reclamo-dialog"
import { ReclamosTimeline } from "@/components/garantias/reclamos-timeline"
import { cn } from "@/lib/utils"

interface GarantiaVenta {
  id: string
  numeroGarantia: string
  itemVentaId: string
  diasValidez: number
  fechaVencimiento: string
  estado: string
}

interface ItemVenta {
  id: string
  descripcion: string
}

export interface GarantiasVentaCardProps {
  ventaId: string
  garantias: GarantiaVenta[]
  items: ItemVenta[]
  isAdmin: boolean
}

/**
 * Certificados de garantía de una venta, uno por línea, con el estado derivado
 * (lib/garantias/estado: "Vencida", no el enum crudo "ACTIVA"), sus reclamos y
 * "Registrar reclamo" por línea. El estado y los reclamos salen de
 * GET /api/garantias/reclamos?ventaId=, la misma lectura que /garantias.
 */
export function GarantiasVentaCard({ ventaId, garantias, items, isAdmin }: GarantiasVentaCardProps) {
  const { formatDate } = useCurrency()
  const [detalle, setDetalle] = useState<Map<string, GarantiaConReclamos>>(new Map())
  const [registrar, setRegistrar] = useState<{ id: string; detalle: string; modo: "vigente" | "forzar" } | null>(null)
  const [decision, setDecision] = useState<DecidirReclamoDialogProps["pendiente"]>(null)

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/garantias/reclamos?ventaId=${encodeURIComponent(ventaId)}`)
      if (!res.ok) return
      const data = (await res.json()) as { garantias?: GarantiaConReclamos[] }
      setDetalle(new Map((data.garantias ?? []).map((g) => [g.id, g])))
    } catch (err) {
      console.error("Error leyendo las garantías de la venta:", err)
    }
  }, [ventaId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  if (garantias.length === 0) return null

  const abrirDecision = (r: ReclamoGarantiaApi, accion: "aceptar" | "rechazar") =>
    setDecision({ reclamoId: r.id, accion, descripcion: r.descripcion })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Certificados de garantía ({garantias.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {garantias.map((garantia) => {
            const item = items.find((i) => i.id === garantia.itemVentaId)
            const d = detalle.get(garantia.id)
            // Sin el detalle todavía, una anulada se reconoce por el enum; el resto espera al estado derivado.
            const anulada = d ? d.estado === "ANULADA" : garantia.estado === "ANULADA"
            const registrarModo = d?.acciones.registrarReclamo ?? null
            return (
              <div
                key={garantia.id}
                className={cn(
                  "space-y-3 rounded-lg border p-4",
                  anulada ? "bg-muted" : "bg-card"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-medium">{garantia.numeroGarantia}</span>
                  {d ? <EstadoGarantiaPill estado={d.estado} /> : null}
                </div>
                <div className="text-sm">
                  <p className="font-medium">{item?.descripcion}</p>
                  <p className="text-muted-foreground">Vigencia: {garantia.diasValidez} días</p>
                  <p className="text-muted-foreground">
                    Vence: {formatDate(garantia.fechaVencimiento)}
                    {d && !anulada ? ` · ${textoVencimiento(d.diasRestantes)}` : ""}
                  </p>
                </div>
                {anulada ? (
                  <p className="text-xs text-muted-foreground">Retirada por una devolución: ya no emite comprobante.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {registrarModo && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-11 w-full gap-1.5"
                        onClick={() =>
                          setRegistrar({
                            id: garantia.id,
                            detalle: `${item?.descripcion ?? "Producto"} · ${garantia.numeroGarantia}`,
                            modo: registrarModo,
                          })
                        }
                      >
                        <MessageSquareWarning className="h-4 w-4" aria-hidden="true" />
                        Registrar reclamo
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11 w-full"
                      onClick={() => window.open(`/api/ventas/${ventaId}/garantia/${garantia.id}/pdf`, "_blank")}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Descargar PDF
                    </Button>
                  </div>
                )}
                {d && d.reclamos.length > 0 ? (
                  <ReclamosTimeline
                    reclamos={d.reclamos}
                    formatDate={formatDate}
                    puedeDecidir={isAdmin}
                    onDecidir={abrirDecision}
                  />
                ) : null}
              </div>
            )
          })}
        </div>
      </CardContent>

      {registrar ? (
        <RegistrarReclamoDialog
          open
          onOpenChange={(abierto) => {
            if (!abierto) setRegistrar(null)
          }}
          origen="VENTA"
          garantiaId={registrar.id}
          detalle={registrar.detalle}
          modo={registrar.modo}
          onRegistrado={() => {
            setRegistrar(null)
            void cargar()
          }}
        />
      ) : null}
      <DecidirReclamoDialog pendiente={decision} onClose={() => setDecision(null)} onDecidido={() => void cargar()} />
    </Card>
  )
}
