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

const FALLBACK_ERROR = "No se pudo anular el pago"

export function AnularPagoDialog({
  open,
  onOpenChange,
  pagoId,
  fechaPago,
  endpoint,
  onAnulado,
}: AnularPagoDialogProps) {
  const { formatDate } = useCurrency()
  const [motivo, setMotivo] = useState("")
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!open) setMotivo("")
  }, [open])

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
      toast.success("Pago anulado")
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
