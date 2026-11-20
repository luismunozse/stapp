"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCurrency } from "@/contexts/currency-context"
import {
  MultiPagoInput,
  createPagoLine,
  type MetodoPagoValue,
  type PagoLineItem,
} from "@/components/pagos/multi-pago-input"
import { esMarcaDeSena } from "@/lib/caja-observaciones"

// Mismo set que acepta PATCH /api/caja/movimientos/metodo-pago: sin cuenta
// corriente, que mueve deuda del cliente y no se corrige desde la caja.
const METODOS: Array<{ value: string; label: string }> = [
  { value: "EFECTIVO", label: "Efectivo" },
  { value: "TRANSFERENCIA", label: "Transferencia" },
  { value: "TARJETA_DEBITO", label: "Tarjeta de débito" },
  { value: "TARJETA_CREDITO", label: "Tarjeta de crédito" },
  { value: "MERCADOPAGO", label: "MercadoPago" },
  { value: "OTRO", label: "Otro" },
]

export interface MovimientoEditable {
  id: string
  fuente: string
  metodoPago: string
  monto: number
  descripcion: string
  /** % de costo de terminal que tiene hoy el pago (precarga el campo). */
  costoFinancieroPorcentaje?: number | null
  /** Número de operación guardado en el pago. */
  numeroReferencia?: string | null
  /** Comentario guardado en el pago. */
  observaciones?: string | null
}

// Pagos de órdenes, remitos y ventas: llevan referencia, comentario y costo de
// terminal, y se corrigen con el mismo formulario con que se registran. Un
// depósito a cuenta o un movimiento manual solo cambia de método.
const FUENTES_DE_PAGO = ["cobros_orden", "pagos_parciales", "pagos_venta"]

const esTarjeta = (metodo: string) => metodo === "TARJETA_DEBITO" || metodo === "TARJETA_CREDITO"
const textoONull = (valor: string | null | undefined) => (valor ?? "").trim() || null

function lineaDesde(movimiento: MovimientoEditable): PagoLineItem {
  return {
    ...createPagoLine(movimiento.monto, movimiento.metodoPago as MetodoPagoValue),
    referencia: movimiento.numeroReferencia ?? "",
    costoFinanciero: movimiento.costoFinancieroPorcentaje ?? null,
  }
}

interface CambiarMetodoDialogProps {
  movimiento: MovimientoEditable | null
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function CambiarMetodoDialog({ movimiento, onOpenChange, onSuccess }: CambiarMetodoDialogProps) {
  const { formatPrice } = useCurrency()
  const [linea, setLinea] = useState<PagoLineItem>(() => createPagoLine())
  const [comentario, setComentario] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (movimiento) {
      setLinea(lineaDesde(movimiento))
      // El comentario que marca una seña no se edita: no se muestra ni se envía.
      setComentario(esMarcaDeSena(movimiento.observaciones) ? "" : movimiento.observaciones ?? "")
      setError("")
    }
  }, [movimiento])

  const esPago = !!movimiento && FUENTES_DE_PAGO.includes(movimiento.fuente)
  const comentarioEditable = esPago && !esMarcaDeSena(movimiento?.observaciones)
  const metodo = linea.metodo as string

  const cambioMetodo = !!movimiento && metodo !== movimiento.metodoPago
  const cambioReferencia =
    esPago && textoONull(linea.referencia) !== textoONull(movimiento?.numeroReferencia)
  const cambioComentario =
    comentarioEditable && textoONull(comentario) !== textoONull(movimiento?.observaciones)
  // Costo de terminal: solo con destino tarjeta, y solo si se tocó. Sin tocar no
  // se envía y la API conserva el guardado (una fila vieja puede tener monto de
  // costo sin porcentaje).
  const cambioCosto =
    esPago &&
    esTarjeta(metodo) &&
    (linea.costoFinanciero ?? null) !== (movimiento?.costoFinancieroPorcentaje ?? null)
  const sinCambios = !cambioMetodo && !cambioReferencia && !cambioComentario && !cambioCosto

  const handleSubmit = async () => {
    if (!movimiento) return
    setError("")

    if (cambioCosto && linea.costoFinanciero != null && (linea.costoFinanciero < 0 || linea.costoFinanciero > 100)) {
      setError("El costo de terminal tiene que estar entre 0 y 100")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/caja/movimientos/metodo-pago", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fuente: movimiento.fuente,
          id: movimiento.id,
          metodoPago: metodo,
          ...(cambioCosto && { costoFinancieroPorcentaje: linea.costoFinanciero ?? null }),
          ...(esPago && { referencia: textoONull(linea.referencia) }),
          ...(comentarioEditable && { observaciones: textoONull(comentario) }),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Error al corregir el pago")
      }
      onOpenChange(false)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al corregir el pago")
    } finally {
      setLoading(false)
    }
  }

  const esTarjetaOrigen = !!movimiento && esTarjeta(movimiento.metodoPago)
  const esTarjetaDestino = esTarjeta(metodo)

  return (
    <Dialog open={!!movimiento} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{esPago ? "Corregir pago" : "Cambiar método de pago"}</DialogTitle>
          {movimiento && (
            <DialogDescription>
              {movimiento.descripcion} · {formatPrice(movimiento.monto)}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-4">
          {esPago ? (
            <>
              {/* El mismo formulario con que se registra el pago, en modo
                  corrección: un solo pago y monto fijo. */}
              <MultiPagoInput
                correccion
                montoPendiente={movimiento?.monto ?? 0}
                pagos={[linea]}
                onChange={(pagos) => setLinea(pagos[0])}
              />
              {comentarioEditable && (
                <div>
                  <Label htmlFor="corregir-pago-comentario" className="text-xs">Comentario</Label>
                  <Textarea
                    id="corregir-pago-comentario"
                    value={comentario}
                    onChange={(e) => setComentario(e.target.value)}
                    placeholder="Banco o billetera, quién pagó, por qué se corrige..."
                    maxLength={500}
                    rows={2}
                  />
                </div>
              )}
            </>
          ) : (
            <div>
              <label className="text-sm font-medium">Método de pago</label>
              <Select
                value={metodo}
                onValueChange={(value) => setLinea((l) => ({ ...l, metodo: value as MetodoPagoValue }))}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Elegí un método" />
                </SelectTrigger>
                <SelectContent>
                  {METODOS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {movimiento?.metodoPago === "TARJETA_CREDITO" && metodo === "TARJETA_DEBITO" && (
            <p className="text-xs text-muted-foreground">Se van a borrar las cuotas y el recargo del pago.</p>
          )}
          {esTarjetaOrigen && !esTarjetaDestino && cambioMetodo && (
            <p className="text-xs text-muted-foreground">
              Se van a borrar las cuotas, el recargo y el costo de terminal del pago.
            </p>
          )}
          {esPago && metodo === "TARJETA_CREDITO" && cambioMetodo && (
            <p className="text-xs text-muted-foreground">
              Queda como pago único. Para cobrar en cuotas, anulá el cobro y registralo de nuevo.
            </p>
          )}
          {error && <p className="text-sm text-destructive-text">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={sinCambios || !metodo} loading={loading}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
