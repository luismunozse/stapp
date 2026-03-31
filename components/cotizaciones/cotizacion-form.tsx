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
import { X, Plus, FileText, Calculator, Percent, DollarSign, Loader2, BookOpen } from "lucide-react"
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
    sectorId?: string | null
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
  const [tipoCambio, setTipoCambio] = useState<number | null>((initialData as any)?.tipoCambio || null)
  const [clienteId, setClienteId] = useState<string | null>(initialData?.clienteId || null)
  const [clienteObj, setClienteObj] = useState<{ tipoCliente?: string | null; razonSocial?: string | null } | null>(null)
  const [selectedSectorId, setSelectedSectorId] = useState<string>(initialData?.sectorId || "")
  const [sectoresCliente, setSectoresCliente] = useState<Array<{ id: string; nombre: string }>>([])
  const [nuevoSectorNombre, setNuevoSectorNombre] = useState("")
  const [crearSectorLoading, setCrearSectorLoading] = useState(false)
  const [configLoaded, setConfigLoaded] = useState(false)
  const [templates, setTemplates] = useState<any[]>([])
  const [templatesLoaded, setTemplatesLoaded] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)

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

  const esClienteEmpresa = clienteObj?.tipoCliente === "EMPRESA" || !!clienteObj?.razonSocial

  // Fetch sectors when client changes (empresa only)
  useEffect(() => {
    setSelectedSectorId("")
    setSectoresCliente([])
    if (!clienteId || !esClienteEmpresa) return

    const fetchSectores = async () => {
      try {
        const res = await fetch(`/api/clientes/${clienteId}/sectores`)
        if (res.ok) {
          const data = await res.json()
          setSectoresCliente(data)
        }
      } catch {
        // ignore
      }
    }
    fetchSectores()
  }, [clienteId, esClienteEmpresa])

  const handleCrearSector = async () => {
    if (!nuevoSectorNombre.trim() || !clienteId) return
    setCrearSectorLoading(true)
    try {
      const res = await fetch(`/api/clientes/${clienteId}/sectores`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nuevoSectorNombre.trim() }),
      })
      if (res.ok) {
        const sector = await res.json()
        setSectoresCliente((prev) => [...prev, sector])
        setSelectedSectorId(sector.id)
        setNuevoSectorNombre("")
      } else {
        const err = await res.json()
        alert(err.error || "Error al crear sector")
      }
    } catch {
      // ignore
    } finally {
      setCrearSectorLoading(false)
    }
  }

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

  const handleLoadTemplates = async () => {
    if (!templatesLoaded) {
      try {
        const res = await fetch("/api/cotizacion-templates")
        if (res.ok) {
          const data = await res.json()
          setTemplates(data)
        }
      } catch { /* ignore */ }
      setTemplatesLoaded(true)
    }
    setShowTemplates(!showTemplates)
  }

  const applyTemplate = (template: any) => {
    setItems(template.items.map((i: any) => ({
      descripcion: i.descripcion,
      cantidad: i.cantidad,
      precioUnitario: i.precioUnitario,
      unidad: i.unidad || "Unidad",
      descuentoTipo: i.descuentoTipo || "porcentaje",
      descuentoValor: i.descuentoValor || 0,
    })))
    if (template.notas) setNotas(template.notas)
    if (template.terminos) setTerminos(template.terminos)
    if (template.descuentoGlobalTipo) setDescuentoGlobalTipo(template.descuentoGlobalTipo)
    if (template.descuentoGlobalValor) setDescuentoGlobalValor(template.descuentoGlobalValor)
    if (template.ivaPorcentaje) setIvaPorcentaje(template.ivaPorcentaje)
    setShowTemplates(false)
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

    if (fechaVencimiento) {
      const today = new Date().toISOString().split("T")[0]
      if (fechaVencimiento < today) {
        alert("La fecha de vencimiento no puede ser anterior a hoy")
        return
      }
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
        tipoCambio: tipoCambio || undefined,
      }

      if (ordenId) payload.ordenId = ordenId
      if (isStandalone && clienteId) payload.clienteId = clienteId
      if (selectedSectorId) payload.sectorId = selectedSectorId

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
          {/* Cliente selector for standalone (only when creating, not editing) */}
          {isStandalone && !isEditing && (
            <>
              <ClienteSelector
                value={clienteId}
                onChange={(id, cliente) => {
                  setClienteId(id)
                  setClienteObj(cliente ? { tipoCliente: cliente.tipoCliente, razonSocial: cliente.razonSocial } : null)
                }}
                disabled={loading}
              />

              {/* Sector selector for empresa clients */}
              {esClienteEmpresa && (
                <div>
                  <Label>Sector / Área</Label>
                  {sectoresCliente.length > 0 ? (
                    <Select
                      value={selectedSectorId}
                      onValueChange={setSelectedSectorId}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar sector (opcional)..." />
                      </SelectTrigger>
                      <SelectContent>
                        {sectoresCliente.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-muted-foreground py-1">No hay sectores creados</p>
                  )}
                  <div className="flex gap-2 mt-2">
                    <Input
                      value={nuevoSectorNombre}
                      onChange={(e) => setNuevoSectorNombre(e.target.value)}
                      placeholder="Nuevo sector (ej: Contaduría, Tránsito)"
                      className="flex-1"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          handleCrearSector()
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={!nuevoSectorNombre.trim() || crearSectorLoading}
                      onClick={handleCrearSector}
                    >
                      {crearSectorLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              )}
            </>
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

          <div className="flex gap-2 flex-wrap">
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
            {!isEditing && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleLoadTemplates}
                disabled={loading}
              >
                <BookOpen className="mr-2 h-4 w-4" />
                Cargar Plantilla
              </Button>
            )}
          </div>

          {/* Template selector */}
          {showTemplates && (
            <div className="border rounded-lg p-3 bg-muted/30 space-y-2">
              <p className="text-sm font-medium">Seleccionar plantilla:</p>
              {templates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay plantillas guardadas</p>
              ) : (
                templates.map((t: any) => (
                  <Button
                    key={t.id}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => applyTemplate(t)}
                  >
                    {t.nombre}
                    <span className="ml-auto text-xs text-muted-foreground">{t.items.length} items</span>
                  </Button>
                ))
              )}
            </div>
          )}

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
            <div>
              <Label className="text-sm">Tipo cambio USD (opcional)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="Ej: 1250"
                value={tipoCambio ?? ""}
                onChange={(e) => setTipoCambio(e.target.value ? parseFloat(e.target.value) : null)}
                disabled={loading}
                className="w-36 mt-1"
              />
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
                min={new Date().toISOString().split("T")[0]}
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
