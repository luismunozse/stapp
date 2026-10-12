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
import { Input } from "@/components/ui/input"
import { parseMoneyInput } from "@/lib/parse-money"
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
  /** % de costo de terminal que tiene hoy el pago (precarga el campo). */
  costoFinancieroPorcentaje?: number | null
}

// Fuentes cuyo pago lleva costo de terminal (la API ignora el resto).
const FUENTES_CON_COSTO = ["cobros_orden", "pagos_parciales", "pagos_venta"]

function textoCosto(costoActual: number | null | undefined): string {
  return costoActual ? String(costoActual).replace(".", ",") : ""
}

const esTarjeta = (metodo: string) => metodo === "TARJETA_DEBITO" || metodo === "TARJETA_CREDITO"

interface CambiarMetodoDialogProps {
  movimiento: MovimientoEditable | null
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function CambiarMetodoDialog({ movimiento, onOpenChange, onSuccess }: CambiarMetodoDialogProps) {
  const { formatPrice } = useCurrency()
  const [metodo, setMetodo] = useState("")
  const [costo, setCosto] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (movimiento) {
      setMetodo(movimiento.metodoPago)
      setCosto(textoCosto(movimiento.costoFinancieroPorcentaje))
      setError("")
    }
  }, [movimiento])

  const handleSubmit = async () => {
    if (!movimiento) return
    setError("")

    // Costo de terminal: solo para fuentes de pago con destino tarjeta, y solo
    // si el usuario lo tocó. Sin tocar no se envía y la API conserva el guardado
    // (una fila vieja puede tener monto de costo sin porcentaje).
    let costoFinancieroPorcentaje: number | null | undefined
    if (muestraCosto && costo.trim() !== textoCosto(movimiento.costoFinancieroPorcentaje)) {
      const texto = costo.trim()
      if (texto === "") {
        costoFinancieroPorcentaje = null
      } else {
        if (/^\d{1,3}(\.\d{3})+$/.test(texto)) {
          setError("Usá la coma para los decimales (por ejemplo 2,5)")
          return
        }
        const n = /^\d+([.,]\d+)?$/.test(texto) ? parseMoneyInput(texto) : NaN
        if (!Number.isFinite(n)) {
          setError("Ingresá un número válido para el costo de terminal (por ejemplo 2,5)")
          return
        }
        if (n < 0 || n > 100) {
          setError("El costo de terminal tiene que estar entre 0 y 100")
          return
        }
        costoFinancieroPorcentaje = n
      }
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
          ...(costoFinancieroPorcentaje !== undefined && { costoFinancieroPorcentaje }),
        }),
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
  const esTarjetaOrigen = !!movimiento && esTarjeta(movimiento.metodoPago)
  const esTarjetaDestino = esTarjeta(metodo)
  const muestraCosto =
    !!movimiento && FUENTES_CON_COSTO.includes(movimiento.fuente) && esTarjetaDestino && !sinCambios

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
          {muestraCosto && (
            <div>
              <label htmlFor="costo-terminal" className="text-sm font-medium">
                Costo de terminal (%)
              </label>
              <Input
                id="costo-terminal"
                className="mt-1"
                type="text"
                inputMode="decimal"
                value={costo}
                onChange={(e) => setCosto(e.target.value)}
                placeholder="Ej: 2,5"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Lo que cobra el posnet. Se descuenta como costo financiero.
              </p>
            </div>
          )}
          {movimiento?.metodoPago === "TARJETA_CREDITO" && metodo === "TARJETA_DEBITO" && (
            <p className="text-xs text-muted-foreground">Se van a borrar las cuotas y el recargo del pago.</p>
          )}
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
