"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2, ShoppingCart } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { useModal } from "@/contexts/modal-context"

interface CotizacionItem {
  id: string
  descripcion: string
  cantidad: number
  precioUnitario: number
  subtotal: number
  unidad?: string
}

interface ConvertirVentaDialogProps {
  open: boolean
  onClose: () => void
  onSuccess: (ventaId: string, numeroVenta: number) => void
  cotizacionId: string
  numeroCotizacion: string
  items: CotizacionItem[]
  total: number
}

const METODOS_PAGO = [
  { value: "EFECTIVO", label: "Efectivo" },
  { value: "TRANSFERENCIA", label: "Transferencia" },
  { value: "TARJETA_DEBITO", label: "Tarjeta Debito" },
  { value: "TARJETA_CREDITO", label: "Tarjeta Credito" },
  { value: "MERCADOPAGO", label: "MercadoPago" },
  { value: "CUENTA_CORRIENTE", label: "Cuenta Corriente" },
  { value: "OTRO", label: "Otro" },
]

export function ConvertirVentaDialog({
  open,
  onClose,
  onSuccess,
  cotizacionId,
  numeroCotizacion,
  items,
  total,
}: ConvertirVentaDialogProps) {
  const { formatPrice } = useCurrency()
  const { showError } = useModal()
  const [loading, setLoading] = useState(false)
  const [metodoPago, setMetodoPago] = useState("EFECTIVO")
  const [observaciones, setObservaciones] = useState("")
  const [garantias, setGarantias] = useState<Record<string, number>>(
    Object.fromEntries(items.map((item) => [item.id, 0]))
  )

  const handleSubmit = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/cotizaciones/${cotizacionId}/convertir-venta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metodoPago,
          observaciones: observaciones || undefined,
          items: items.map((item) => ({
            cotizacionItemId: item.id,
            diasGarantia: garantias[item.id] || 0,
          })),
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        await showError(error.error || "Error al convertir a venta")
        return
      }

      const data = await res.json()
      onSuccess(data.ventaId, data.numeroVenta)
    } catch {
      await showError("Error al convertir a venta")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Convertir {numeroCotizacion} a Venta
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Items table */}
          <div>
            <Label className="text-sm font-medium">Items de la cotizacion</Label>
            <div className="mt-2 space-y-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 p-2 rounded border bg-muted/30"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.descripcion}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.cantidad} {item.unidad || "Unidad"} x {formatPrice(item.precioUnitario)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-20">
                      <Input
                        type="number"
                        min={0}
                        placeholder="Dias"
                        value={garantias[item.id] || ""}
                        onChange={(e) =>
                          setGarantias((prev) => ({
                            ...prev,
                            [item.id]: parseInt(e.target.value) || 0,
                          }))
                        }
                        className="h-8 text-xs"
                      />
                    </div>
                    <span className="text-xs text-muted-foreground w-12">dias gar.</span>
                  </div>
                  <div className="text-sm font-medium w-24 text-right">
                    {formatPrice(item.subtotal)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Total */}
          <div className="flex justify-between items-center p-3 rounded bg-primary/5 border">
            <span className="font-medium">Total</span>
            <span className="text-lg font-bold">{formatPrice(total)}</span>
          </div>

          {/* Metodo de pago */}
          <div>
            <Label>Metodo de pago</Label>
            <Select value={metodoPago} onValueChange={setMetodoPago}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METODOS_PAGO.map((mp) => (
                  <SelectItem key={mp.value} value={mp.value}>
                    {mp.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Observaciones */}
          <div>
            <Label>Observaciones (opcional)</Label>
            <Textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              placeholder="Notas adicionales para la venta..."
              className="mt-1"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creando venta...</>
            ) : (
              <><ShoppingCart className="mr-2 h-4 w-4" />Crear Venta</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
