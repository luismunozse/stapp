"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import { useModal } from "@/contexts/modal-context"
import { Loader2 } from "lucide-react"

interface NotaCreditoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ventaId?: string | null
  ordenId?: string | null
  montoMaximo: number
  onSuccess?: () => void
}

const MOTIVOS = [
  { value: "DEVOLUCION", label: "Devolución de producto" },
  { value: "AJUSTE_PRECIO", label: "Ajuste de precio" },
  { value: "GARANTIA", label: "Garantía / reposición" },
  { value: "ERROR_FACTURACION", label: "Error de facturación" },
  { value: "DESCUENTO_RETRO", label: "Descuento retroactivo" },
  { value: "OTRO", label: "Otro" },
] as const

const METODOS = [
  { value: "EFECTIVO", label: "Efectivo" },
  { value: "TRANSFERENCIA", label: "Transferencia" },
  { value: "TARJETA", label: "Tarjeta" },
  { value: "MERCADOPAGO", label: "Mercado Pago" },
  { value: "CUENTA_CORRIENTE", label: "Cuenta corriente" },
  { value: "NOTA_CREDITO_INTERNA", label: "NC interna (no devuelve dinero)" },
  { value: "OTRO", label: "Otro" },
] as const

export function NotaCreditoDialog({
  open,
  onOpenChange,
  ventaId,
  ordenId,
  montoMaximo,
  onSuccess,
}: NotaCreditoDialogProps) {
  const { showError } = useModal()
  const [motivo, setMotivo] = useState<string>("DEVOLUCION")
  const [monto, setMonto] = useState<string>("")
  const [metodo, setMetodo] = useState<string>("EFECTIVO")
  const [notas, setNotas] = useState("")
  const [pending, setPending] = useState(false)

  const montoNum = parseFloat(monto) || 0

  const reset = () => {
    setMotivo("DEVOLUCION")
    setMonto("")
    setMetodo("EFECTIVO")
    setNotas("")
  }

  const handleSubmit = async () => {
    if (montoNum <= 0) {
      await showError("El monto debe ser mayor a 0")
      return
    }
    if (montoNum > montoMaximo + 0.01) {
      await showError(`Monto excede el máximo (${montoMaximo.toFixed(2)})`)
      return
    }
    setPending(true)
    try {
      const res = await fetch("/api/notas-credito", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ventaId: ventaId || null,
          ordenId: ordenId || null,
          motivo,
          monto: montoNum,
          metodoDevolucion: metodo,
          notas: notas || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        await showError(json.error || "Error al crear nota de crédito")
        return
      }
      toast.success(`NC ${json.numero} creada`)
      onOpenChange(false)
      reset()
      onSuccess?.()
    } catch {
      await showError("Error de red")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva nota de crédito</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-xs text-muted-foreground">
            Resta del ingreso devengado. Máximo: ${montoMaximo.toFixed(2)}
          </div>
          <div>
            <Label className="text-xs">Motivo</Label>
            <Select value={motivo} onValueChange={setMotivo} disabled={pending}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MOTIVOS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Monto</Label>
            <Input
              type="number"
              min={0}
              max={montoMaximo}
              step="0.01"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              disabled={pending}
            />
          </div>
          <div>
            <Label className="text-xs">Método de devolución</Label>
            <Select value={metodo} onValueChange={setMetodo} disabled={pending}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {METODOS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Notas (opcional)</Label>
            <Textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              disabled={pending}
              maxLength={500}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Emitir NC
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
