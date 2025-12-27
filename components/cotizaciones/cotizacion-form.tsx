"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { X, Plus, FileText, Calculator } from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { ItemRow } from "./item-row"

interface CotizacionItem {
  descripcion: string
  cantidad: number
  precioUnitario: number
}

interface CotizacionFormProps {
  ordenId: string
  onClose: () => void
  onSuccess: () => void
  initialData?: {
    id: string
    items: CotizacionItem[]
    notas?: string | null
    fechaVencimiento?: string | null
  }
}

export function CotizacionForm({
  ordenId,
  onClose,
  onSuccess,
  initialData,
}: CotizacionFormProps) {
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<CotizacionItem[]>(
    initialData?.items || [{ descripcion: "", cantidad: 1, precioUnitario: 0 }]
  )
  const [notas, setNotas] = useState(initialData?.notas || "")
  const [fechaVencimiento, setFechaVencimiento] = useState(
    initialData?.fechaVencimiento?.split("T")[0] || ""
  )

  const isEditing = !!initialData

  const updateItem = (index: number, field: string, value: string | number) => {
    const newItems = [...items]
    newItems[index] = { ...newItems[index], [field]: value }
    setItems(newItems)
  }

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index))
    }
  }

  const addItem = () => {
    setItems([...items, { descripcion: "", cantidad: 1, precioUnitario: 0 }])
  }

  const total = items.reduce(
    (sum, item) => sum + item.cantidad * item.precioUnitario,
    0
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validar items
    const validItems = items.filter(
      (item) => item.descripcion && item.cantidad > 0 && item.precioUnitario > 0
    )
    if (validItems.length === 0) {
      alert("Debe agregar al menos un item válido")
      return
    }

    setLoading(true)
    try {
      const url = isEditing
        ? `/api/cotizaciones/${initialData.id}`
        : "/api/cotizaciones"
      const method = isEditing ? "PUT" : "POST"

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ordenId,
          items: validItems,
          notas: notas || undefined,
          fechaVencimiento: fechaVencimiento || undefined,
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        alert(error.error || "Error al guardar cotización")
        return
      }

      onSuccess()
    } catch (error) {
      console.error("Error:", error)
      alert("Error al guardar cotización")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {isEditing ? "Editar Cotización" : "Nueva Cotización"}
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Items Header - Hidden on mobile */}
          <div className="hidden sm:grid grid-cols-12 gap-2 text-sm font-medium text-muted-foreground border-b pb-2">
            <div className="col-span-5">Descripción</div>
            <div className="col-span-2 text-center">Cantidad</div>
            <div className="col-span-2 text-center">Precio Unit.</div>
            <div className="col-span-2 text-right">Subtotal</div>
            <div className="col-span-1"></div>
          </div>

          {/* Items */}
          {items.map((item, index) => (
            <ItemRow
              key={index}
              item={item}
              index={index}
              onUpdate={updateItem}
              onRemove={removeItem}
              disabled={loading}
            />
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addItem}
            disabled={loading}
          >
            <Plus className="mr-2 h-4 w-4" />
            Agregar Item
          </Button>

          {/* Total */}
          <div className="flex justify-end">
            <div className="w-64 p-4 bg-muted rounded-lg">
              <div className="flex justify-between">
                <span className="font-bold">Total:</span>
                <span className="font-bold text-lg">{formatCurrency(total)}</span>
              </div>
            </div>
          </div>

          {/* Additional Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="fechaVencimiento">Válida hasta</Label>
              <Input
                id="fechaVencimiento"
                type="date"
                value={fechaVencimiento}
                onChange={(e) => setFechaVencimiento(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="notas">Notas</Label>
            <Textarea
              id="notas"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Notas adicionales para el cliente..."
              rows={3}
              disabled={loading}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              <Calculator className="mr-2 h-4 w-4" />
              {loading
                ? "Guardando..."
                : isEditing
                ? "Actualizar Cotización"
                : "Crear Cotización"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
