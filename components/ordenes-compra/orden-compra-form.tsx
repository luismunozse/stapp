"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, Plus, Trash2 } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

interface OCItem {
  tempId: string
  descripcion: string
  cantidadPedida: number
  precioUnitario: number
  // Optional: when coming from inventory (e.g. "Generar OC")
  inventarioId?: string
  codigo?: string
}

interface Props {
  onClose: () => void
  onCreated: () => void
  initialItems?: OCItem[]
  initialProveedorId?: string | null
}

let tempIdCounter = 0
function nextTempId() {
  return `tmp-${++tempIdCounter}-${Date.now()}`
}

export function OrdenCompraForm({ onClose, onCreated, initialItems, initialProveedorId }: Props) {
  const [proveedorId, setProveedorId] = useState<string>(initialProveedorId || "")
  const [proveedores, setProveedores] = useState<any[]>([])
  const [fechaEsperada, setFechaEsperada] = useState("")
  const [notas, setNotas] = useState("")
  const [items, setItems] = useState<OCItem[]>(
    initialItems?.map(i => ({ ...i, tempId: i.tempId || nextTempId() })) || []
  )
  const [loading, setLoading] = useState(false)
  const { formatPrice } = useCurrency()

  useEffect(() => {
    fetch("/api/proveedores").then(r => r.json()).then(d => setProveedores(d.data || d || []))
  }, [])

  const addItem = () => {
    setItems([...items, {
      tempId: nextTempId(),
      descripcion: "",
      cantidadPedida: 1,
      precioUnitario: 0,
    }])
  }

  const updateItem = (index: number, field: string, value: string | number) => {
    const newItems = [...items]
    newItems[index] = { ...newItems[index], [field]: value }
    setItems(newItems)
  }

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index))
  }

  const total = items.reduce((sum, i) => sum + i.cantidadPedida * i.precioUnitario, 0)

  const handleSubmit = async () => {
    if (items.length === 0) { alert("Agregá al menos un item"); return }
    const emptyDesc = items.some(i => !i.descripcion.trim())
    if (emptyDesc) { alert("Completá la descripción de todos los ítems"); return }

    setLoading(true)
    try {
      const res = await fetch("/api/ordenes-compra", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proveedorId: proveedorId || null,
          fechaRecepcionEsperada: fechaEsperada || null,
          notas: notas || null,
          items: items.map(i => ({
            descripcion: i.descripcion,
            cantidadPedida: i.cantidadPedida,
            precioUnitario: i.precioUnitario,
            inventarioId: i.inventarioId || null,
          })),
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        alert(err.error || "Error al crear OC")
        return
      }
      onCreated()
    } catch {
      alert("Error al crear orden de compra")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onClose}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <CardTitle>Nueva Orden de Compra</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Header fields */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <Label>Proveedor</Label>
            <Select value={proveedorId} onValueChange={setProveedorId}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar proveedor" />
              </SelectTrigger>
              <SelectContent>
                {proveedores.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Fecha esperada</Label>
            <Input type="date" value={fechaEsperada} onChange={e => setFechaEsperada(e.target.value)} />
          </div>
          <div>
            <Label>Notas</Label>
            <Textarea value={notas} onChange={e => setNotas(e.target.value)} rows={1} placeholder="Notas internas..." />
          </div>
        </div>

        {/* Items table */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>Ítems</Label>
            <Button variant="outline" size="sm" onClick={addItem}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Agregar ítem
            </Button>
          </div>

          {items.length === 0 ? (
            <div className="border rounded-lg p-8 text-center text-muted-foreground">
              <p className="text-sm">No hay ítems. Agregá los productos que querés pedir.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={addItem}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Agregar ítem
              </Button>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Descripción</th>
                    <th className="text-center px-3 py-2 font-medium w-24">Cantidad</th>
                    <th className="text-right px-3 py-2 font-medium w-32">Costo unit.</th>
                    <th className="text-right px-3 py-2 font-medium w-28">Subtotal</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={item.tempId} className="border-t">
                      <td className="px-3 py-2">
                        <Input
                          placeholder="Ej: Pantalla Samsung A55, Flex carga iPhone 13..."
                          value={item.descripcion}
                          onChange={e => updateItem(idx, "descripcion", e.target.value)}
                          className="h-8"
                        />
                        {item.inventarioId && item.codigo && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            Vinculado: {item.codigo}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={1}
                          value={item.cantidadPedida}
                          onChange={e => updateItem(idx, "cantidadPedida", parseInt(e.target.value) || 1)}
                          className="h-8 text-center"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={item.precioUnitario}
                          onChange={e => updateItem(idx, "precioUnitario", parseFloat(e.target.value) || 0)}
                          className="h-8 text-right"
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {formatPrice(item.cantidadPedida * item.precioUnitario)}
                      </td>
                      <td className="px-1 py-2">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeItem(idx)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/30">
                    <td colSpan={3} className="px-3 py-2 text-right font-medium">Total</td>
                    <td className="px-3 py-2 text-right font-bold">{formatPrice(total)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={loading || items.length === 0}>
            {loading ? "Creando..." : "Crear OC"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
