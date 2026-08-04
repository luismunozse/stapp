"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Loader2, PackageCheck } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { calcularTotalLote, type DescuentoTipo } from "@/lib/lote-utils"

// Copiado (no importado) de components/pagos/multi-pago-input.tsx: esa lista
// vive inline en un componente, no en un módulo de lib, así que no hay nada
// exportable para reusar. Se omite CUENTA_CORRIENTE porque el endpoint de
// entrega de lote no la acepta (ver entregarLoteSchema en la API route).
const METODOS_PAGO = [
  { value: "EFECTIVO", label: "Efectivo" },
  { value: "TRANSFERENCIA", label: "Transferencia" },
  { value: "TARJETA_DEBITO", label: "T. Débito" },
  { value: "TARJETA_CREDITO", label: "T. Crédito" },
  { value: "MERCADOPAGO", label: "MercadoPago" },
  { value: "OTRO", label: "Otro" },
] as const

type MetodoPago = (typeof METODOS_PAGO)[number]["value"]

interface EntregaLoteOrden {
  id: string
  numeroOrden: number
  dispositivo: string
  costoFinal: number | null
  presupuesto: number | null
}

interface EntregaLoteDialogProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  recepcionId: string
  ordenes: EntregaLoteOrden[]
  descuentoTipo: DescuentoTipo | null
  descuentoValor: number | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Único punto donde un costo tipeado se convierte en número: redondea a 2
 * decimales y clampea negativos a 0. Se usa tanto para el resumen en
 * pantalla (subtotal/descuento/total) como para el payload del POST, así
 * nunca pueden divergir — sin esto, un costo con más de 2 decimales podía
 * mostrar un total en pantalla distinto del que terminaba cobrándose,
 * porque el POST redondeaba recién al armar el body.
 *
 * El clamp a 0 sigue el mismo criterio silencioso que el resto de la app usa
 * para montos que no pueden ser negativos (ver Math.max(0, ...) en
 * lib/lote-utils.ts, cotizaciones/item-row.tsx, cobrar-orden-dialog.tsx,
 * cart-drawer.tsx): no hay ningún input de "costo" en la app que bloquee el
 * envío con un mensaje de validación en su lugar, así que un dialog nuevo no
 * es el lugar para introducir ese patrón.
 */
const normalizeCosto = (raw: string): number => {
  const parsed = parseFloat(raw)
  const safe = Number.isFinite(parsed) ? parsed : 0
  return Math.max(0, round2(safe))
}

export function EntregaLoteDialog({
  open,
  onClose,
  onSuccess,
  recepcionId,
  ordenes,
  descuentoTipo,
  descuentoValor,
}: EntregaLoteDialogProps) {
  const { formatPrice } = useCurrency()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [costos, setCostos] = useState<Record<string, string>>({})
  const [metodoPago, setMetodoPago] = useState<MetodoPago | "">("")
  const [referencia, setReferencia] = useState("")
  const [observaciones, setObservaciones] = useState("")
  const [idempotencyKey, setIdempotencyKey] = useState("")

  useEffect(() => {
    if (open) {
      const draft: Record<string, string> = {}
      for (const orden of ordenes) {
        draft[orden.id] = String(orden.costoFinal ?? orden.presupuesto ?? 0)
      }
      setCostos(draft)
      setMetodoPago("")
      setReferencia("")
      setObservaciones("")
      setError(null)
      setIdempotencyKey(crypto.randomUUID())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const subtotal = ordenes.reduce((sum, orden) => sum + normalizeCosto(costos[orden.id]), 0)
  const total = calcularTotalLote(subtotal, descuentoTipo, descuentoValor)
  const descuentoAplicado = round2(subtotal - total)

  const handleConfirmar = async () => {
    if (!metodoPago) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/recepciones/${recepcionId}/entregar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ordenes: ordenes.map((orden) => ({
            id: orden.id,
            costoFinal: normalizeCosto(costos[orden.id]),
          })),
          metodoPago,
          referencia: referencia || null,
          observaciones: observaciones || null,
          idempotencyKey,
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(data.error || "Error al entregar el lote")
        return
      }

      onSuccess()
      onClose()
    } catch (err) {
      console.error("Error:", err)
      setError("Error al entregar el lote")
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (!loading) {
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5" />
            Entregar lote
          </DialogTitle>
          <DialogDescription>
            Confirmá el costo final de cada equipo y el cobro único del lote.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            {ordenes.map((orden) => (
              <div key={orden.id} className="flex items-center justify-between gap-3 rounded-md border p-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    #{orden.numeroOrden} {orden.dispositivo}
                  </p>
                </div>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-28"
                  value={costos[orden.id] ?? ""}
                  onChange={(e) =>
                    setCostos((prev) => ({ ...prev, [orden.id]: e.target.value }))
                  }
                  disabled={loading}
                  aria-label={`Costo final #${orden.numeroOrden}`}
                />
              </div>
            ))}
          </div>

          <div className="rounded-lg border p-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatPrice(subtotal)}</span>
            </div>
            {descuentoTipo && descuentoValor ? (
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Descuento ({descuentoTipo === "porcentaje" ? `${descuentoValor}%` : formatPrice(descuentoValor)})
                </span>
                <span className="text-muted-foreground">-{formatPrice(descuentoAplicado)}</span>
              </div>
            ) : null}
            <div className="flex justify-between font-semibold pt-2 border-t">
              <span>Total a cobrar</span>
              <span className="tabular-nums">{formatPrice(total)}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Método de pago</Label>
            <div className="grid grid-cols-2 gap-2">
              {METODOS_PAGO.map((m) => (
                <label
                  key={m.value}
                  className="flex items-center gap-2 rounded-md border p-2 text-sm cursor-pointer"
                >
                  <input
                    type="radio"
                    name="metodo-pago-lote"
                    value={m.value}
                    checked={metodoPago === m.value}
                    onChange={() => setMetodoPago(m.value)}
                    disabled={loading}
                  />
                  {m.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="referencia-lote" className="text-sm">
              Referencia (opcional)
            </Label>
            <Input
              id="referencia-lote"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              disabled={loading}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="observaciones-lote" className="text-sm">
              Observaciones (opcional)
            </Label>
            <Textarea
              id="observaciones-lote"
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              rows={2}
              disabled={loading}
              className="mt-1"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={handleClose} disabled={loading}>
              Cancelar
            </Button>
            <Button onClick={handleConfirmar} disabled={loading || !metodoPago}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Entregando...
                </>
              ) : (
                <>
                  <PackageCheck className="mr-2 h-4 w-4" />
                  Confirmar entrega
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
