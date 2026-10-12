"use client"

import { useState } from "react"
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
import { Loader2, Undo2 } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { toast } from "sonner"

interface RevertirCargoDialogProps {
  clienteId: string
  movimientos: Array<{ id: string; monto: number }>
  saldoActual: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
}

export function RevertirCargoDialog({
  clienteId,
  movimientos,
  saldoActual,
  open,
  onOpenChange,
  onDone,
}: RevertirCargoDialogProps) {
  const { formatPrice } = useCurrency()
  const [motivo, setMotivo] = useState("")
  const [loading, setLoading] = useState(false)

  const total = movimientos.reduce((sum, m) => sum + Math.abs(m.monto), 0)
  const saldoResultante = saldoActual + total

  async function handleRevertir() {
    if (motivo.trim().length < 3) {
      toast.error("Escribí el motivo de la reversa")
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/clientes/${clienteId}/cuenta-corriente/revertir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movimientoIds: movimientos.map((m) => m.id), motivo }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Error al revertir")
      toast.success(
        movimientos.length === 1 ? "Cargo revertido" : `${movimientos.length} cargos revertidos`
      )
      setMotivo("")
      onOpenChange(false)
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al revertir")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="h-5 w-5" />
            {movimientos.length === 1 ? "Revertir cargo" : `Revertir ${movimientos.length} cargos`}
          </DialogTitle>
          <DialogDescription>
            Se le va a devolver {formatPrice(total)} a la cuenta corriente del cliente.
            El saldo queda en {formatPrice(saldoResultante)}. La orden no se modifica.
            Esta acción no se puede deshacer desde la aplicación.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="motivo-reversa">Motivo</Label>
          <Textarea
            id="motivo-reversa"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej: cargado por error en el cliente equivocado"
            rows={3}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={handleRevertir} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Undo2 className="h-4 w-4 mr-2" />
            )}
            Revertir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
