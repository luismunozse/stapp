"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useCurrency } from "@/contexts/currency-context"

interface AnularPagoDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  pagoId: string | null
  fechaPago: string | null
  endpoint: "/api/comisiones/pagar" | "/api/comisiones/vendedores/pagar"
  onAnulado: () => void
}

interface PagoDetalle {
  pagoId: string
  fechaPago: string
  origen: string
  total: number
  anulado: boolean
  filas: number
  beneficiarioNombre: string
}

const FALLBACK_ERROR = "No se pudo anular el pago"

export function AnularPagoDialog({
  open,
  onOpenChange,
  pagoId,
  fechaPago,
  endpoint,
  onAnulado,
}: AnularPagoDialogProps) {
  const { formatDate, formatPrice } = useCurrency()
  const [motivo, setMotivo] = useState("")
  const [sending, setSending] = useState(false)
  const [detalle, setDetalle] = useState<PagoDetalle | null>(null)
  const [detalleEstado, setDetalleEstado] = useState<"loading" | "ok" | "error">("loading")

  useEffect(() => {
    if (!open) setMotivo("")
  }, [open])

  // What annulling would un-pay. Read fresh on every open (a cached count could be stale); a
  // failed read never blocks the annul, the RPC validates the payout on its own.
  useEffect(() => {
    if (!open || !pagoId) return
    let cancelled = false
    setDetalle(null)
    setDetalleEstado("loading")
    ;(async () => {
      try {
        const res = await fetch(`/api/comisiones/pagos/${encodeURIComponent(pagoId)}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const d = (await res.json()) as PagoDetalle
        if (cancelled) return
        setDetalle(d)
        setDetalleEstado("ok")
      } catch {
        if (!cancelled) setDetalleEstado("error")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, pagoId])

  const trimmed = motivo.trim()
  const disabled = !pagoId || trimmed === "" || sending

  const handleSubmit = async () => {
    if (disabled) return
    setSending(true)
    try {
      const res = await fetch(endpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagoId, motivo: trimmed }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body?.error ?? FALLBACK_ERROR)
        return
      }
      toast.success(
        typeof body?.filas === "number"
          ? `Pago anulado: ${body.filas} comisión(es) vuelven a pendientes.`
          : "Pago anulado"
      )
      onAnulado()
      onOpenChange(false)
    } catch {
      toast.error(FALLBACK_ERROR)
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !sending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Anular pago</DialogTitle>
          <DialogDescription>
            Se anula el pago completo{fechaPago ? ` del ${formatDate(fechaPago)}` : ""}, no solo
            esta fila: todas sus comisiones vuelven a quedar pendientes. Queda registrado quién lo
            anuló y por qué.
          </DialogDescription>
        </DialogHeader>

        {/* Fixed-height slot so the dialog does not jump when the summary arrives */}
        <div className="min-h-5 text-sm" aria-live="polite">
          {detalleEstado === "loading" && (
            <span className="text-muted-foreground">Cargando el pago…</span>
          )}
          {detalleEstado === "error" && (
            <span className="text-destructive">No se pudo cargar el pago.</span>
          )}
          {detalleEstado === "ok" && detalle && (
            <span className="font-medium">
              {detalle.filas} comisión(es) · total {formatPrice(detalle.total)} · pagado el{" "}
              {formatDate(detalle.fechaPago)}
            </span>
          )}
        </div>
        {detalleEstado === "ok" && detalle && detalle.filas > 1 && (
          <p className="text-sm text-muted-foreground">
            Anular este pago deja pendientes las {detalle.filas} comisiones. Las de órdenes vuelven con el monto actual, no con el pagado.
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="anular-pago-motivo">Motivo</Label>
          <Textarea
            id="anular-pago-motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej.: se cargó un monto equivocado"
            rows={3}
            maxLength={500}
            disabled={sending}
          />
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={sending}
          >
            Cancelar
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={disabled}>
            {sending ? "Anulando…" : "Anular pago"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
