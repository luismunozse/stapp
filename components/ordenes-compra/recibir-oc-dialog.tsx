"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PackageCheck } from "lucide-react"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  ordenCompraId: string
  numeroOC: string
  onReceived: () => void
}

interface OCItem {
  id: string
  inventarioId: string
  inventario: { id: string; codigo: string; nombre: string; stock: number } | null
  cantidadPedida: number
  cantidadRecibida: number
  precioUnitario: number
}

export function RecibirOCDialog({ open, onOpenChange, ordenCompraId, numeroOC, onReceived }: Props) {
  const [items, setItems] = useState<OCItem[]>([])
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch(`/api/ordenes-compra/${ordenCompraId}`)
      .then(r => r.json())
      .then(data => {
        const ocItems = (data.items || []) as OCItem[]
        setItems(ocItems)
        const q: Record<string, number> = {}
        for (const item of ocItems) {
          const pendiente = item.cantidadPedida - item.cantidadRecibida
          q[item.id] = Math.max(0, pendiente)
        }
        setQuantities(q)
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [open, ordenCompraId])

  const handleSubmit = async () => {
    const itemsToReceive = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([itemId, cantidadRecibida]) => ({ itemId, cantidadRecibida }))

    if (itemsToReceive.length === 0) {
      alert("Ingresá al menos una cantidad")
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/ordenes-compra/${ordenCompraId}/recibir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: itemsToReceive }),
      })
      if (!res.ok) {
        const err = await res.json()
        alert(err.error || "Error al recibir")
        return
      }
      onReceived()
    } catch {
      alert("Error al procesar recepción")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageCheck className="h-4 w-4" />
            Recibir {numeroOC}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Producto</th>
                    <th className="text-center px-3 py-2 font-medium w-20">Pedido</th>
                    <th className="text-center px-3 py-2 font-medium w-20">Recibido</th>
                    <th className="text-center px-3 py-2 font-medium w-24">Recibir</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const pendiente = item.cantidadPedida - item.cantidadRecibida
                    return (
                      <tr key={item.id} className="border-t">
                        <td className="px-3 py-2">
                          <div className="font-medium text-sm">{item.inventario?.nombre || "—"}</div>
                          <div className="text-xs text-muted-foreground">{item.inventario?.codigo}</div>
                        </td>
                        <td className="px-3 py-2 text-center">{item.cantidadPedida}</td>
                        <td className="px-3 py-2 text-center text-muted-foreground">{item.cantidadRecibida}</td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            min={0}
                            max={pendiente}
                            value={quantities[item.id] || 0}
                            onChange={e => setQuantities(prev => ({
                              ...prev,
                              [item.id]: Math.min(parseInt(e.target.value) || 0, pendiente),
                            }))}
                            className="h-8 text-center"
                            disabled={pendiente <= 0}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Procesando..." : "Confirmar recepción"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
