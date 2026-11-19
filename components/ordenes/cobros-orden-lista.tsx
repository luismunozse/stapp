"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Ban, Calendar, User } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

export interface CobroOrden {
  id: string
  monto: number
  metodoPago: string
  referencia?: string | null
  observaciones?: string | null
  cuotas?: number | null
  recargoPorcentaje?: number | null
  costoFinancieroMonto?: number | null
  costoFinancieroPorcentaje?: number | null
  fecha: string
  anulado: boolean
  anuladoAt?: string | null
  anuladoMotivo?: string | null
  cobradoPor?: string | null
  anuladoPor?: string | null
}

const metodoPagoLabels: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA: "Tarjeta",
  TARJETA_DEBITO: "Tarjeta de débito",
  TARJETA_CREDITO: "Tarjeta de crédito",
  MERCADOPAGO: "MercadoPago",
  CUENTA_CORRIENTE: "Cuenta corriente",
  OTRO: "Otro",
}

interface CobrosOrdenListaProps {
  cobros: CobroOrden[]
  /** Muestra la acción Anular en los cobros vigentes. El servidor decide igual. */
  puedeAnular?: boolean
  /** Devuelve true si el cobro quedó anulado. */
  onAnular?: (cobroId: string, motivo: string) => Promise<boolean>
}

/** Detalle de cada cobro de una orden: cuánto, cómo, cuándo, quién, y su anulación. */
export function CobrosOrdenLista({ cobros, puedeAnular = false, onAnular }: CobrosOrdenListaProps) {
  const { formatPrice, formatDateTime } = useCurrency()
  const [anulandoId, setAnulandoId] = useState<string | null>(null)
  const [motivo, setMotivo] = useState("")
  const [enviando, setEnviando] = useState(false)

  const cancelarAnulacion = () => {
    setAnulandoId(null)
    setMotivo("")
  }

  const confirmarAnulacion = async (cobroId: string) => {
    if (!onAnular) return
    setEnviando(true)
    try {
      const ok = await onAnular(cobroId, motivo.trim())
      if (ok) cancelarAnulacion()
    } finally {
      setEnviando(false)
    }
  }

  return (
    <ul className="space-y-2">
      {cobros.map((cobro) => {
        const recargo = cobro.recargoPorcentaje && cobro.recargoPorcentaje > 0 ? cobro.recargoPorcentaje : 0
        return (
          <li
            key={cobro.id}
            className={`rounded-lg border p-3 ${cobro.anulado ? "bg-muted/30" : "bg-muted/50"}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={
                      cobro.anulado
                        ? "font-semibold line-through text-muted-foreground"
                        : "font-semibold text-green-600"
                    }
                  >
                    {formatPrice(cobro.monto)}
                  </span>
                  <span className="text-sm">
                    {metodoPagoLabels[cobro.metodoPago] || cobro.metodoPago}
                    {cobro.cuotas && cobro.cuotas > 1 ? ` · ${cobro.cuotas} cuotas` : ""}
                  </span>
                  {cobro.anulado && <Badge variant="destructive" className="text-xs">Anulado</Badge>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" aria-hidden="true" />
                    {formatDateTime(cobro.fecha)}
                  </span>
                  {cobro.cobradoPor && (
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" aria-hidden="true" />
                      Cobró {cobro.cobradoPor}
                    </span>
                  )}
                </div>
              </div>
              {puedeAnular && onAnular && !cobro.anulado && anulandoId !== cobro.id && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 shrink-0 text-xs text-destructive hover:text-destructive"
                  onClick={() => { setAnulandoId(cobro.id); setMotivo("") }}
                >
                  <Ban className="mr-1 h-3.5 w-3.5" />
                  Anular
                </Button>
              )}
            </div>

            {(cobro.referencia || cobro.observaciones || recargo > 0 ||
              (cobro.costoFinancieroMonto != null && cobro.costoFinancieroMonto > 0)) && (
              <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                {cobro.referencia && <div>Referencia: {cobro.referencia}</div>}
                {recargo > 0 && (
                  // `monto` es el importe base; el recargo lo paga el cliente por encima.
                  <div>
                    Recargo {recargo}% · el cliente pagó {formatPrice(cobro.monto + cobro.monto * (recargo / 100))}
                  </div>
                )}
                {cobro.costoFinancieroMonto != null && cobro.costoFinancieroMonto > 0 && (
                  <div className="text-red-500">
                    Costo terminal ({cobro.costoFinancieroPorcentaje}%): -{formatPrice(cobro.costoFinancieroMonto)}
                    {" · "}Ingreso real: {formatPrice(cobro.monto - cobro.costoFinancieroMonto)}
                  </div>
                )}
                {cobro.observaciones && <div>Nota: {cobro.observaciones}</div>}
              </div>
            )}

            {cobro.anulado && (
              <div className="mt-2 border-t pt-2 text-xs text-muted-foreground">
                Anulado
                {cobro.anuladoAt ? ` el ${formatDateTime(cobro.anuladoAt)}` : ""}
                {cobro.anuladoPor ? ` por ${cobro.anuladoPor}` : ""}
                {cobro.anuladoMotivo ? ` · ${cobro.anuladoMotivo}` : ""}
              </div>
            )}

            {anulandoId === cobro.id && (
              <div className="mt-3 space-y-2 border-t pt-3">
                <p className="text-xs text-muted-foreground">
                  Anular saca este cobro de la orden y de los ingresos. No se puede deshacer.
                </p>
                <Input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Motivo de la anulación (opcional)"
                  maxLength={200}
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={cancelarAnulacion} disabled={enviando}>
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    loading={enviando}
                    onClick={() => confirmarAnulacion(cobro.id)}
                  >
                    Anular cobro
                  </Button>
                </div>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
