"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, Plus, Trash2, Search } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

interface OCItem {
  inventarioId: string
  nombre: string
  codigo: string
  cantidadPedida: number
  precioUnitario: number
}

interface Props {
  onClose: () => void
  onCreated: () => void
  initialItems?: OCItem[]
  initialProveedorId?: string | null
}

export function OrdenCompraForm({ onClose, onCreated, initialItems, initialProveedorId }: Props) {
  const [proveedorId, setProveedorId] = useState<string>(initialProveedorId || "")
  const [proveedores, setProveedores] = useState<any[]>([])
  const [fechaEsperada, setFechaEsperada] = useState("")
  const [notas, setNotas] = useState("")
  const [items, setItems] = useState<OCItem[]>(initialItems || [])
  const [loading, setLoading] = useState(false)
  const [invSearch, setInvSearch] = useState("")
  const [invResults, setInvResults] = useState<any[]>([])
  const { formatPrice } = useCurrency()

  useEffect(() => {
    fetch("/api/proveedores").then(r => r.json()).then(d => setProveedores(d.data || d || []))
  }, [])

  useEffect(() => {
    if (!invSearch || invSearch.length < 2) { setInvResults([]); return }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/inventario/search?q=${encodeURIComponent(invSearch)}&limit=8`)
        if (res.ok) setInvResults(await res.json())
      } catch { /* ignore */ }
    }, 300)
    return () => clearTimeout(t)
  }, [invSearch])

  const addItem = (inv: any) => {
    if (items.some(i => i.inventarioId === inv.id)) return
    setItems([...items, {
      inventarioId: inv.id,
      nombre: inv.nombre,
      codigo: inv.codigo,
      cantidadPedida: 1,
      precioUnitario: 0,
    }])
    setInvSearch("")
    setInvResults([])
  }

  const updateItem = (index: number, field: string, value: number) => {
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
            inventarioId: i.inventarioId,
            cantidadPedida: i.cantidadPedida,
            precioUnitario: i.precioUnitario,
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

        {/* Search & add items */}
        <div>
          <Label>Agregar productos</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar producto por nombre o código..."
              value={invSearch}
              onChange={e => setInvSearch(e.target.value)}
              className="pl-9"
            />
            {invResults.length > 0 && (
              <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto">
                {invResults.map((inv) => (
                  <button
                    key={inv.id}
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex justify-between"
                    onClick={() => addItem(inv)}
                  >
                    <div>
                      <span className="font-medium">{inv.nombre}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{inv.codigo}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">Stock: {inv.stock}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Items table */}
        {items.length > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Producto</th>
                  <th className="text-center px-3 py-2 font-medium w-24">Cantidad</th>
                  <th className="text-right px-3 py-2 font-medium w-32">Costo unit.</th>
                  <th className="text-right px-3 py-2 font-medium w-28">Subtotal</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={item.inventarioId} className="border-t">
                    <td className="px-3 py-2">
                      <div className="font-medium">{item.nombre}</div>
                      <div className="text-xs text-muted-foreground">{item.codigo}</div>
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
