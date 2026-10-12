"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PackageCheck, Link2, X } from "lucide-react"
import { useModal } from "@/contexts/modal-context"
import { BuscadorInventario, type ArticuloInventario } from "./buscador-inventario"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  ordenCompraId: string
  numeroOC: string
  onReceived: () => void
}

interface OCItem {
  id: string
  descripcion: string | null
  inventarioId: string | null
  inventario: { id: string; codigo: string; nombre: string; stock: number } | null
  cantidadPedida: number
  cantidadRecibida: number
  precioUnitario: number
}

// crypto.randomUUID no está en contextos inseguros ni en WebViews viejas, y
// esta app corre también empaquetada con Capacitor.
function nuevoRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `rec-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

export function RecibirOCDialog({ open, onOpenChange, ordenCompraId, numeroOC, onReceived }: Props) {
  const { showError } = useModal()
  const [items, setItems] = useState<OCItem[]>([])
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [inventarioLinks, setInventarioLinks] = useState<Record<string, { id: string; codigo: string; nombre: string } | null>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  // Qué fila tiene el buscador abierto. El término de búsqueda y los
  // resultados viven dentro de BuscadorInventario, compartido con el alta de OC.
  const [searchingItem, setSearchingItem] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  // Clave de idempotencia de ESTA recepción. Se genera una vez por apertura del
  // diálogo, así un reintento (red que se corta, doble submit, la app que
  // reintenta sola) reusa la misma clave y el servidor devuelve el resultado
  // original en vez de volver a sumar stock. Se renueva al cerrar y reabrir,
  // que es cuando el usuario sí quiere registrar una recepción distinta.
  const [requestId, setRequestId] = useState<string>("")

  useEffect(() => {
    if (!open) return
    setRequestId(nuevoRequestId())
    setLoading(true)
    fetch(`/api/ordenes-compra/${ordenCompraId}`)
      .then(r => r.json())
      .then(data => {
        const ocItems = (data.items || []) as OCItem[]
        setItems(ocItems)
        const q: Record<string, number> = {}
        const links: Record<string, { id: string; codigo: string; nombre: string } | null> = {}
        for (const item of ocItems) {
          const pendiente = item.cantidadPedida - item.cantidadRecibida
          q[item.id] = Math.max(0, pendiente)
          links[item.id] = item.inventario ? { id: item.inventario.id, codigo: item.inventario.codigo, nombre: item.inventario.nombre } : null
        }
        setQuantities(q)
        setInventarioLinks(links)
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [open, ordenCompraId])

  const openSearch = (itemId: string) => {
    setSearchingItem(itemId)
    setSearchQuery("")
  }

  const linkInventario = (itemId: string, inv: ArticuloInventario) => {
    setInventarioLinks(prev => ({ ...prev, [itemId]: { id: inv.id, codigo: inv.codigo, nombre: inv.nombre } }))
    setSearchingItem(null)
    setSearchQuery("")
  }

  const unlinkInventario = (itemId: string) => {
    setInventarioLinks(prev => ({ ...prev, [itemId]: null }))
  }

  const handleSubmit = async () => {
    const itemsToReceive = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([itemId, cantidadRecibida]) => ({
        itemId,
        cantidadRecibida,
        inventarioId: inventarioLinks[itemId]?.id || null,
      }))

    if (itemsToReceive.length === 0) {
      await showError("Ingresá al menos una cantidad")
      return
    }

    // Warn about unlinked items
    const unlinked = itemsToReceive.filter(i => !i.inventarioId)
    if (unlinked.length > 0) {
      const confirm = window.confirm(
        `${unlinked.length} ítem(s) no están vinculados a un producto del inventario. El stock no se actualizará para esos ítems. ¿Continuar?`
      )
      if (!confirm) return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/ordenes-compra/${ordenCompraId}/recibir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: itemsToReceive, requestId }),
      })
      if (!res.ok) {
        const err = await res.json()
        await showError(err.error || "Error al recibir")
        return
      }
      onReceived()
    } catch {
      await showError("Error al procesar recepción")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
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
                    <th className="text-left px-3 py-2 font-medium">Descripción</th>
                    <th className="text-left px-3 py-2 font-medium w-40">Vincular a inventario</th>
                    <th className="text-center px-3 py-2 font-medium w-16">Pedido</th>
                    <th className="text-center px-3 py-2 font-medium w-16">Recibido</th>
                    <th className="text-center px-3 py-2 font-medium w-24">Recibir</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const pendiente = item.cantidadPedida - item.cantidadRecibida
                    const linked = inventarioLinks[item.id]
                    const isSearching = searchingItem === item.id
                    return (
                      <tr key={item.id} className="border-t">
                        <td className="px-3 py-2">
                          <div className="font-medium text-sm">{item.descripcion || item.inventario?.nombre || "—"}</div>
                        </td>
                        <td className="px-3 py-2">
                          {linked ? (
                            <div className="flex items-center gap-1">
                              <div className="text-xs">
                                <span className="font-medium">{linked.nombre}</span>
                                <span className="text-muted-foreground ml-1">{linked.codigo}</span>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Desvincular artículo"
                                className="h-5 w-5 shrink-0"
                                onClick={() => unlinkInventario(item.id)}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : isSearching ? (
                            <BuscadorInventario
                              autoFocus
                              valor={searchQuery}
                              onValorChange={setSearchQuery}
                              onSeleccionar={(inv) => linkInventario(item.id, inv)}
                              onCancelar={() => setSearchingItem(null)}
                              placeholder="Buscar producto..."
                              className="h-7 text-xs"
                            />
                          ) : (
                            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => openSearch(item.id)}>
                              <Link2 className="h-3 w-3" /> Vincular
                            </Button>
                          )}
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

            <p className="text-xs text-muted-foreground">
              Vinculá cada ítem a un producto de tu inventario para que el stock se actualice automáticamente al recibir.
            </p>

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
