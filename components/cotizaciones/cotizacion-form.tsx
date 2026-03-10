"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DatePicker } from "@/components/ui/date-picker"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { X, Plus, FileText, Calculator, Percent, DollarSign } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { ItemRow, calcItemNeto } from "./item-row"
import { ClienteSelector } from "./cliente-selector"

interface CotizacionItem {
  descripcion: string
  cantidad: number
  precioUnitario: number
  unidad?: string
  descuentoTipo?: string
  descuentoValor?: number
}

interface CotizacionFormProps {
  ordenId?: string
  onClose: () => void
  onSuccess: () => void
  initialData?: {
    id: string
    items: CotizacionItem[]
    notas?: string | null
    fechaVencimiento?: string | null
    terminos?: string | null
    descuentoGlobalTipo?: string
    descuentoGlobalValor?: number
    ivaPorcentaje?: number
    clienteId?: string | null
  }
}

export function CotizacionForm({
  ordenId,
  onClose,
  onSuccess,
  initialData,
}: CotizacionFormProps) {
  const [loading, setLoading] = useState(false)
  const { formatPrice } = useCurrency()
  const [items, setItems] = useState<CotizacionItem[]>(
    initialData?.items || [{ descripcion: "", cantidad: 1, precioUnitario: 0, unidad: "Unidad", descuentoTipo: "porcentaje", descuentoValor: 0 }]
  )
  const [notas, setNotas] = useState(initialData?.notas || "")
  const [fechaVencimiento, setFechaVencimiento] = useState(
    initialData?.fechaVencimiento?.split("T")[0] || ""
  )
  const [terminos, setTerminos] = useState(initialData?.terminos || "")
  const [descuentoGlobalTipo, setDescuentoGlobalTipo] = useState(initialData?.descuentoGlobalTipo || "porcentaje")
  const [descuentoGlobalValor, setDescuentoGlobalValor] = useState(initialData?.descuentoGlobalValor || 0)
  const [ivaPorcentaje, setIvaPorcentaje] = useState(initialData?.ivaPorcentaje ?? 0)
  const [clienteId, setClienteId] = useState<string | null>(initialData?.clienteId || null)
  const [configLoaded, setConfigLoaded] = useState(false)

  const isEditing = !!initialData
  const isStandalone = !ordenId

  // Fetch org config for defaults (only for new cotizaciones)
  useEffect(() => {
    if (isEditing || configLoaded) return
    const fetchConfig = async () => {
      try {
        const res = await fetch("/api/configuracion")
        if (res.ok) {
          const data = await res.json()
          setIvaPorcentaje(data.ivaPorcentaje ?? 0)
          if (data.cotizacionTerminos) setTerminos(data.cotizacionTerminos)
          if (data.cotizacionValidezDias && !fechaVencimiento) {
            const d = new Date()
            d.setDate(d.getDate() + (data.cotizacionValidezDias || 30))
            setFechaVencimiento(d.toISOString().split("T")[0])
          }
        }
      } catch {
        // ignore
      }
      setConfigLoaded(true)
    }
    fetchConfig()
  }, [isEditing, configLoaded, fechaVencimiento])

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
    setItems([...items, { descripcion: "", cantidad: 1, precioUnitario: 0, unidad: "Unidad", descuentoTipo: "porcentaje", descuentoValor: 0 }])
  }

  // Calculations
  const subtotalBruto = items.reduce((sum, item) => sum + item.cantidad * item.precioUnitario, 0)
  const subtotalNeto = items.reduce((sum, item) => sum + calcItemNeto(item), 0)
  const descuentoItems = subtotalBruto - subtotalNeto

  const calcDescuentoGlobal = () => {
    if (descuentoGlobalValor <= 0) return 0
    if (descuentoGlobalTipo === "fijo") return Math.min(descuentoGlobalValor, subtotalNeto)
    return subtotalNeto * (descuentoGlobalValor / 100)
  }
  const descuentoGlobal = calcDescuentoGlobal()
  const subtotalGravable = subtotalNeto - descuentoGlobal
  const ivaAmount = subtotalGravable * (ivaPorcentaje / 100)
  const total = subtotalGravable + ivaAmount

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const validItems = items.filter(
      (item) => item.descripcion && item.cantidad > 0 && item.precioUnitario > 0
    )
    if (validItems.length === 0) {
      alert("Debe agregar al menos un item válido")
      return
    }

    if (isStandalone && !clienteId) {
      alert("Debe seleccionar un cliente")
      return
    }

    setLoading(true)
    try {
      const url = isEditing
        ? `/api/cotizaciones/${initialData.id}`
        : "/api/cotizaciones"
      const method = isEditing ? "PUT" : "POST"

      const payload: Record<string, any> = {
        items: validItems.map(item => ({
          descripcion: item.descripcion,
          cantidad: item.cantidad,
          precioUnitario: item.precioUnitario,
          unidad: item.unidad || "Unidad",
          descuentoTipo: item.descuentoTipo || "porcentaje",
          descuentoValor: item.descuentoValor || 0,
        })),
        notas: notas || undefined,
        fechaVencimiento: fechaVencimiento || undefined,
        terminos: terminos || undefined,
        descuentoGlobalTipo,
        descuentoGlobalValor,
        ivaPorcentaje,
      }

      if (ordenId) payload.ordenId = ordenId
      if (isStandalone && clienteId) payload.clienteId = clienteId

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
          {/* Cliente selector for standalone */}
          {isStandalone && (
            <ClienteSelector
              value={clienteId}
              onChange={(id) => setClienteId(id)}
              disabled={loading}
            />
          )}

          {/* Items Header - Hidden on mobile */}
          <div className="hidden sm:grid gap-2 text-sm font-medium text-muted-foreground border-b pb-2" style={{ gridTemplateColumns: "4fr 1fr 1.5fr 1.5fr 1.5fr 2fr 0.5fr" }}>
            <div>Descripción</div>
            <div>Unidad</div>
            <div className="text-center">Cantidad</div>
            <div className="text-center">Precio Unit.</div>
            <div className="text-center">Descuento</div>
            <div className="text-right">Subtotal</div>
            <div></div>
          </div>

          {/* Items */}
          {items.map((item, index) => (
            <ItemRow
              key={`item-${index}`}
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

          {/* Descuento Global + IVA */}
          <div className="flex flex-col sm:flex-row sm:items-end gap-3 p-3 bg-muted/50 rounded-lg">
            <div className="flex-1">
              <Label className="text-sm">Descuento Global</Label>
              <div className="flex items-center gap-2 mt-1">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0"
                  value={descuentoGlobalValor || ""}
                  onChange={(e) => setDescuentoGlobalValor(parseFloat(e.target.value) || 0)}
                  disabled={loading}
                  className="w-32"
                />
                <Button
                  type="button"
                  variant={descuentoGlobalTipo === "fijo" ? "default" : "outline"}
                  size="icon"
                  className="h-10 w-10 shrink-0"
                  onClick={() => setDescuentoGlobalTipo(descuentoGlobalTipo === "fijo" ? "porcentaje" : "fijo")}
                  disabled={loading}
                >
                  {descuentoGlobalTipo === "fijo" ? <DollarSign className="h-4 w-4" /> : <Percent className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div>
              <Label className="text-sm">IVA</Label>
              <Select
                value={String(ivaPorcentaje)}
                onValueChange={(v) => setIvaPorcentaje(parseFloat(v))}
                disabled={loading}
              >
                <SelectTrigger className="w-32 mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">0%</SelectItem>
                  <SelectItem value="10.5">10.5%</SelectItem>
                  <SelectItem value="21">21%</SelectItem>
                  <SelectItem value="27">27%</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Totales Desglose */}
          <div className="flex justify-end">
            <div className="w-72 p-4 bg-muted rounded-lg space-y-1.5">
              <div className="flex justify-between text-sm">
                <span>Subtotal:</span>
                <span>{formatPrice(subtotalBruto)}</span>
              </div>
              {descuentoItems > 0 && (
                <div className="flex justify-between text-sm text-green-600">
                  <span>Desc. items:</span>
                  <span>-{formatPrice(descuentoItems)}</span>
                </div>
              )}
              {descuentoGlobal > 0 && (
                <div className="flex justify-between text-sm text-green-600">
                  <span>Desc. global:</span>
                  <span>-{formatPrice(descuentoGlobal)}</span>
                </div>
              )}
              {ivaPorcentaje > 0 && (
                <>
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Subtotal gravable:</span>
                    <span>{formatPrice(subtotalGravable)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>IVA ({ivaPorcentaje}%):</span>
                    <span>{formatPrice(ivaAmount)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between font-bold text-lg pt-1 border-t">
                <span>Total:</span>
                <span>{formatPrice(total)}</span>
              </div>
            </div>
          </div>

          {/* Additional Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <DatePicker
                id="fechaVencimiento"
                label="Válida hasta"
                value={fechaVencimiento}
                onChange={setFechaVencimiento}
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

          <div>
            <Label htmlFor="terminos">Términos y Condiciones</Label>
            <Textarea
              id="terminos"
              value={terminos}
              onChange={(e) => setTerminos(e.target.value)}
              placeholder="Términos y condiciones de la cotización..."
              rows={4}
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
