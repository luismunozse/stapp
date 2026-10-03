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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2 } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

// Mismo set que acepta PATCH /api/caja/movimientos/metodo-pago: sin cuenta
// corriente, que mueve deuda del cliente y no se corrige desde la caja.
const METODOS: Array<{ value: string; label: string }> = [
  { value: "EFECTIVO", label: "Efectivo" },
  { value: "TRANSFERENCIA", label: "Transferencia" },
  { value: "TARJETA_DEBITO", label: "Tarjeta Débito" },
  { value: "TARJETA_CREDITO", label: "Tarjeta Crédito" },
  { value: "MERCADOPAGO", label: "MercadoPago" },
  { value: "OTRO", label: "Otro" },
]

export interface MovimientoEditable {
  id: string
  fuente: string
  metodoPago: string
  monto: number
  descripcion: string
}

interface CambiarMetodoDialogProps {
  movimiento: MovimientoEditable | null
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function CambiarMetodoDialog({ movimiento, onOpenChange, onSuccess }: CambiarMetodoDialogProps) {
  const { formatPrice } = useCurrency()
  const [metodo, setMetodo] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (movimiento) {
      setMetodo(movimiento.metodoPago)
      setError("")
    }
  }, [movimiento])

  const handleSubmit = async () => {
    if (!movimiento) return
    setError("")
    setLoading(true)
    try {
      const res = await fetch("/api/caja/movimientos/metodo-pago", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fuente: movimiento.fuente, id: movimiento.id, metodoPago: metodo }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Error al cambiar el método de pago")
      }
      onOpenChange(false)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cambiar el método de pago")
    } finally {
      setLoading(false)
    }
  }

  const sinCambios = !!movimiento && metodo === movimiento.metodoPago
  const esTarjetaOrigen =
    movimiento?.metodoPago === "TARJETA_DEBITO" || movimiento?.metodoPago === "TARJETA_CREDITO"
  const esTarjetaDestino = metodo === "TARJETA_DEBITO" || metodo === "TARJETA_CREDITO"

  return (
    <Dialog open={!!movimiento} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cambiar método de pago</DialogTitle>
          {movimiento && (
            <DialogDescription>
              {movimiento.descripcion} · {formatPrice(movimiento.monto)}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Método de pago</label>
            <Select value={metodo} onValueChange={setMetodo}>
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
          {esTarjetaOrigen && !esTarjetaDestino && !sinCambios && (
            <p className="text-xs text-muted-foreground">
              Se van a borrar las cuotas, el recargo y el costo de terminal del pago.
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={loading || sinCambios || !metodo}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
