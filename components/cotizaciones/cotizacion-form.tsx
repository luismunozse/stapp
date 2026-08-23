"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DatePicker } from "@/components/ui/date-picker"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FormActionBar } from "@/components/ui/form-action-bar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { X, Plus, FileText, Calculator, Percent, DollarSign, Loader2, BookOpen, Smartphone, Wrench } from "lucide-react"
import { CollapsibleSection } from "@/components/ui/collapsible-section"
import { useCurrency, useTerminologia } from "@/contexts/currency-context"
import { useModal } from "@/contexts/modal-context"
import { ItemRow, calcItemNeto } from "./item-row"
import { ClienteSelector } from "./cliente-selector"
import { OrdenSelector, type OrdenLite } from "./orden-selector"
import { ChecklistPicker, type ChecklistPickerValue } from "./checklist-picker"

interface CotizacionItem {
  descripcion: string
  cantidad: number
  precioUnitario: number
  // Costo de compra (cost). Para items linkeados se snapshot al ACEPTAR via trigger.
  // Para manuales, admin lo carga acá. NULL = costo desconocido.
  costoUnitario?: number | null
  unidad?: string
  descuentoTipo?: string
  descuentoValor?: number
  inventarioId?: string | null
  servicioId?: string | null
  tipoRepuesto?: "ORIGINAL" | "ALTERNATIVO" | "RECICLADO" | "NO_APLICA"
  // Solo runtime: capturado al seleccionar del inventario para mostrar margen.
  precioCompra?: number | null
}

/**
 * Traduce un item del formulario al payload de la API.
 *
 * `precioCompra` es solo de runtime: se captura al elegir un producto del
 * inventario para poder mostrar el margen en pantalla, y viaja al servidor como
 * `costoUnitario`. Un servicio no tiene costo conocido, asi que queda en null:
 * null significa "no se sabe", que no es lo mismo que "el costo es cero".
 */
export function toItemPayload(item: CotizacionItem) {
  return {
    descripcion: item.descripcion,
    cantidad: item.cantidad,
    precioUnitario: item.precioUnitario,
    costoUnitario: item.costoUnitario ?? item.precioCompra ?? null,
    unidad: item.unidad || "Unidad",
    descuentoTipo: item.descuentoTipo || "porcentaje",
    descuentoValor: item.descuentoValor || 0,
    inventarioId: item.inventarioId || null,
    servicioId: item.servicioId || null,
    tipoRepuesto: item.tipoRepuesto || "NO_APLICA",
  }
}

interface CondicionesTecnicas {
  diagnostico: string | null
  plazoEstimadoDias: number | null
  anticipoTipo: "porcentaje" | "fijo"
  anticipoValor: number
  garantiaDias: number
  garantiaAlcance: "REPUESTO" | "MANO_OBRA" | "AMBOS" | "NINGUNA"
  politicaAbandonoDias: number | null
}

interface EquipoData {
  dispositivo: string
  tipoDispositivoId?: string | null
  tipoDispositivo?: string | null
  marca?: string | null
  modelo?: string | null
  color?: string | null
  imei?: string | null
  numeroSerie?: string | null
  problemaReportado: string
  condiciones?: CondicionesTecnicas | null
}

interface CotizacionFormProps {
  tipo?: "ORDEN" | "PRESUPUESTO"
  ordenId?: string
  initialClienteId?: string
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
    equipo?: EquipoData | null
    checklist?: ChecklistPickerValue | null
  }
}

export function CotizacionForm({
  tipo = "ORDEN",
  ordenId,
  initialClienteId,
  onClose,
  onSuccess,
  initialData,
}: CotizacionFormProps) {
  const isPresupuesto = tipo === "PRESUPUESTO"
  const [loading, setLoading] = useState(false)
  const { formatPrice } = useCurrency()
  const t = useTerminologia()
  const { showError, showWarning } = useModal()
  const [items, setItems] = useState<CotizacionItem[]>(
    initialData?.items || [{ descripcion: "", cantidad: 1, precioUnitario: 0, unidad: "Unidad", descuentoTipo: "porcentaje", descuentoValor: 0, tipoRepuesto: "NO_APLICA" }]
  )
  const [notas, setNotas] = useState(initialData?.notas || "")
  const [fechaVencimiento, setFechaVencimiento] = useState(
    initialData?.fechaVencimiento?.split("T")[0] || ""
  )
  const [terminos, setTerminos] = useState(initialData?.terminos || "")
  const [descuentoGlobalTipo, setDescuentoGlobalTipo] = useState(initialData?.descuentoGlobalTipo || "porcentaje")
  // Raw string for free typing; numeric value (used in totals/submit) is parsed below.
  const [descuentoGlobalValorStr, setDescuentoGlobalValorStr] = useState(
    initialData?.descuentoGlobalValor ? String(initialData.descuentoGlobalValor) : ""
  )
  const descuentoGlobalValor = parseFloat(descuentoGlobalValorStr) || 0
  const [ivaPorcentaje, setIvaPorcentaje] = useState(initialData?.ivaPorcentaje ?? 0)
  const [tipoCambio, setTipoCambio] = useState<number | null>((initialData as any)?.tipoCambio || null)
  const [clienteId, setClienteId] = useState<string | null>(initialData?.clienteId || initialClienteId || null)
  const [clienteObj, setClienteObj] = useState<{ tipoCliente?: string | null; razonSocial?: string | null } | null>(null)
  const [selectedSectorId, setSelectedSectorId] = useState<string>(initialData?.sectorId || "")
  const [sectoresCliente, setSectoresCliente] = useState<Array<{ id: string; nombre: string }>>([])
  const [nuevoSectorNombre, setNuevoSectorNombre] = useState("")
  const [crearSectorLoading, setCrearSectorLoading] = useState(false)
  const [configLoaded, setConfigLoaded] = useState(false)
  const [templates, setTemplates] = useState<any[]>([])
  const [templatesLoaded, setTemplatesLoaded] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)

  // Estado para PRESUPUESTO: datos del equipo + checklist
  const [equipo, setEquipo] = useState<EquipoData>({
    dispositivo: initialData?.equipo?.dispositivo || "",
    tipoDispositivoId: initialData?.equipo?.tipoDispositivoId || null,
    tipoDispositivo: initialData?.equipo?.tipoDispositivo || null,
    marca: initialData?.equipo?.marca || null,
    modelo: initialData?.equipo?.modelo || null,
    color: initialData?.equipo?.color || null,
    imei: initialData?.equipo?.imei || null,
    numeroSerie: initialData?.equipo?.numeroSerie || null,
    problemaReportado: initialData?.equipo?.problemaReportado || "",
  })
  const [condiciones, setCondiciones] = useState<CondicionesTecnicas>({
    diagnostico: initialData?.equipo?.condiciones?.diagnostico ?? null,
    plazoEstimadoDias: initialData?.equipo?.condiciones?.plazoEstimadoDias ?? null,
    anticipoTipo: initialData?.equipo?.condiciones?.anticipoTipo ?? "porcentaje",
    anticipoValor: initialData?.equipo?.condiciones?.anticipoValor ?? 0,
    garantiaDias: initialData?.equipo?.condiciones?.garantiaDias ?? 30,
    garantiaAlcance: initialData?.equipo?.condiciones?.garantiaAlcance ?? "AMBOS",
    politicaAbandonoDias: initialData?.equipo?.condiciones?.politicaAbandonoDias ?? null,
  })
  // Raw strings for free typing on the technical-condition numeric inputs.
  // Parsed back into numbers at submit (anticipoValor/garantiaDias) so the saved
  // values are unchanged. Initialized from the same defaults as `condiciones`.
  const [anticipoValorStr, setAnticipoValorStr] = useState(
    initialData?.equipo?.condiciones?.anticipoValor
      ? String(initialData.equipo.condiciones.anticipoValor)
      : ""
  )
  const [garantiaDiasStr, setGarantiaDiasStr] = useState(
    String(initialData?.equipo?.condiciones?.garantiaDias ?? 30)
  )
  const [checklistValue, setChecklistValue] = useState<ChecklistPickerValue | null>(
    initialData?.checklist || null
  )
  const [tiposDispositivo, setTiposDispositivo] = useState<Array<{ id: string; codigo: string; nombre: string }>>([])

  const isEditing = !!initialData?.id
  const [linkedOrdenId, setLinkedOrdenId] = useState<string | null>(ordenId || null)
  const isStandalone = !linkedOrdenId

  // Cargar tipos de dispositivo (solo para PRESUPUESTO)
  useEffect(() => {
    if (!isPresupuesto || tiposDispositivo.length > 0) return
    ;(async () => {
      try {
        const res = await fetch("/api/tipos-dispositivo")
        if (res.ok) {
          const data = await res.json()
          setTiposDispositivo(Array.isArray(data) ? data : [])
        }
      } catch { /* ignore */ }
    })()
  }, [isPresupuesto, tiposDispositivo.length])

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
          if (isPresupuesto) {
            setCondiciones((prev) => ({
              ...prev,
              garantiaDias: data.garantiaDiasDefault ?? prev.garantiaDias,
              politicaAbandonoDias: data.politicaAbandonoDiasDefault ?? prev.politicaAbandonoDias,
              anticipoValor: data.anticipoPorcentajeDefault ?? prev.anticipoValor,
            }))
            if (data.garantiaDiasDefault != null) setGarantiaDiasStr(String(data.garantiaDiasDefault))
            if (data.anticipoPorcentajeDefault != null) setAnticipoValorStr(String(data.anticipoPorcentajeDefault))
          }
        }
      } catch {
        // ignore
      }
      setConfigLoaded(true)
    }
    fetchConfig()
  }, [isEditing, configLoaded, fechaVencimiento, isPresupuesto])

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
        await showError(err.error || "Error al crear sector")
      }
    } catch {
      // ignore
    } finally {
      setCrearSectorLoading(false)
    }
  }

  const updateItem = (index: number, field: string, value: string | number | null) => {
    setItems((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index))
    }
  }

  const addItem = () => {
    setItems([...items, { descripcion: "", cantidad: 1, precioUnitario: 0, unidad: "Unidad", descuentoTipo: "porcentaje", descuentoValor: 0, inventarioId: null, servicioId: null, tipoRepuesto: "NO_APLICA" }])
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
      tipoRepuesto: i.tipoRepuesto || "NO_APLICA",
    })))
    if (template.notas) setNotas(template.notas)
    if (template.terminos) setTerminos(template.terminos)
    if (template.descuentoGlobalTipo) setDescuentoGlobalTipo(template.descuentoGlobalTipo)
    if (template.descuentoGlobalValor) setDescuentoGlobalValorStr(String(template.descuentoGlobalValor))
    if (template.ivaPorcentaje) setIvaPorcentaje(template.ivaPorcentaje)
    setShowTemplates(false)
  }

  // Calculations
  const subtotalBruto = items.reduce((sum, item) => sum + item.cantidad * item.precioUnitario, 0)
  const subtotalNeto = items.reduce((sum, item) => sum + calcItemNeto(item), 0)
  const descuentoItems = subtotalBruto - subtotalNeto
  const costoRepuestos = items.reduce(
    (sum, item) => sum + (Number(item.precioCompra) || 0) * (item.cantidad || 0),
    0
  )
  const tieneCostos = costoRepuestos > 0

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
      await showWarning("Debe agregar al menos un item válido")
      return
    }

    if (isStandalone && !clienteId) {
      await showWarning("Debe seleccionar un cliente")
      return
    }

    if (isPresupuesto) {
      if (!equipo.tipoDispositivoId) {
        await showWarning(`Seleccioná el tipo de ${t("equipo").toLowerCase()}`)
        return
      }
      if (!equipo.marca?.trim() || !equipo.modelo?.trim()) {
        await showWarning(`Ingresá ${t("marca").toLowerCase()} y ${t("modelo").toLowerCase()} del ${t("equipo").toLowerCase()}`)
        return
      }
      if (!equipo.problemaReportado.trim()) {
        await showWarning("Ingresá el problema reportado")
        return
      }
    }

    if (fechaVencimiento) {
      const today = new Date().toISOString().split("T")[0]
      if (fechaVencimiento < today) {
        await showWarning("La fecha de vencimiento no puede ser anterior a hoy")
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
        tipo,
        items: validItems.map(toItemPayload),
        notas: notas || undefined,
        fechaVencimiento: fechaVencimiento || undefined,
        terminos: terminos || undefined,
        descuentoGlobalTipo,
        descuentoGlobalValor,
        ivaPorcentaje,
        tipoCambio: tipoCambio || undefined,
      }

      if (linkedOrdenId) payload.ordenId = linkedOrdenId
      if (isStandalone && clienteId) payload.clienteId = clienteId
      if (selectedSectorId) payload.sectorId = selectedSectorId

      if (isPresupuesto) {
        const marca = equipo.marca?.trim() || ""
        const modelo = equipo.modelo?.trim() || ""
        const dispositivo = `${marca} ${modelo}`.trim()
        const isCelular = equipo.tipoDispositivo === "CELULAR"
        payload.equipo = {
          dispositivo,
          tipoDispositivoId: equipo.tipoDispositivoId,
          tipoDispositivo: equipo.tipoDispositivo,
          marca: marca || null,
          modelo: modelo || null,
          color: equipo.color || null,
          imei: isCelular ? (equipo.imei || null) : null,
          numeroSerie: equipo.numeroSerie || null,
          problemaReportado: equipo.problemaReportado.trim(),
          condiciones: {
            diagnostico: condiciones.diagnostico?.trim() || null,
            plazoEstimadoDias: condiciones.plazoEstimadoDias && condiciones.plazoEstimadoDias > 0 ? condiciones.plazoEstimadoDias : null,
            anticipoTipo: condiciones.anticipoTipo,
            anticipoValor: parseFloat(anticipoValorStr) || 0,
            garantiaDias: condiciones.garantiaAlcance === "NINGUNA" ? 0 : (parseInt(garantiaDiasStr, 10) || 0),
            garantiaAlcance: condiciones.garantiaAlcance,
            politicaAbandonoDias: condiciones.politicaAbandonoDias && condiciones.politicaAbandonoDias > 0 ? condiciones.politicaAbandonoDias : null,
          },
        }
        if (checklistValue) payload.checklist = checklistValue
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const error = await res.json()
        await showError(error.error || "Error al guardar cotización")
        return
      }

      onSuccess()
    } catch (error) {
      console.error("Error:", error)
      await showError("Error al guardar cotización")
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
            {isEditing
              ? isPresupuesto ? "Editar Presupuesto" : "Editar Cotización"
              : isPresupuesto ? "Nuevo Presupuesto" : "Nueva Cotización"}
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Orden selector: solo creación, tipo ORDEN, abierto desde /cotizaciones (sin ordenId pre-set) */}
          {!isEditing && !isPresupuesto && !ordenId && (
            <OrdenSelector
              value={linkedOrdenId}
              onChange={(id, orden: OrdenLite | null) => {
                setLinkedOrdenId(id)
                if (orden) {
                  if (orden.clienteId) {
                    setClienteId(orden.clienteId)
                    if (orden.cliente) {
                      setClienteObj({
                        tipoCliente: orden.cliente.tipoCliente,
                        razonSocial: orden.cliente.razonSocial,
                      })
                    }
                  }
                  if (orden.sectorId) setSelectedSectorId(orden.sectorId)
                } else {
                  setClienteId(null)
                  setClienteObj(null)
                  setSelectedSectorId("")
                }
              }}
              disabled={loading}
            />
          )}

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

          {/* Datos del equipo + Checklist + Condiciones técnicas (solo PRESUPUESTO) */}
          {isPresupuesto && (
            <CollapsibleSection title={`Datos del ${t("equipo").toLowerCase()}`} icon={Smartphone} defaultOpen>
              <div className="space-y-3 p-3 border rounded-lg bg-muted/20">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Tipo de {t("equipo").toLowerCase()} *</Label>
                    <Select
                      value={equipo.tipoDispositivoId || ""}
                      onValueChange={(id) => {
                        const td = tiposDispositivo.find((t) => t.id === id)
                        setEquipo((prev) => ({
                          ...prev,
                          tipoDispositivoId: id,
                          tipoDispositivo: td?.codigo || null,
                        }))
                        // Reset checklist si cambia el tipo
                        setChecklistValue(null)
                      }}
                      disabled={loading}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Seleccionar..." />
                      </SelectTrigger>
                      <SelectContent>
                        {tiposDispositivo.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Marca *</Label>
                    <Input
                      value={equipo.marca || ""}
                      onChange={(e) => setEquipo((p) => ({ ...p, marca: e.target.value || null }))}
                      placeholder="Ej: Apple, Samsung, Dell"
                      disabled={loading}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>Modelo *</Label>
                    <Input
                      value={equipo.modelo || ""}
                      onChange={(e) => setEquipo((p) => ({ ...p, modelo: e.target.value || null }))}
                      placeholder="Ej: iPhone 13 Pro, Latitude 5520"
                      disabled={loading}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>Color</Label>
                    <Input
                      value={equipo.color || ""}
                      onChange={(e) => setEquipo((p) => ({ ...p, color: e.target.value || null }))}
                      disabled={loading}
                      className="mt-1"
                    />
                  </div>
                  {equipo.tipoDispositivo === "CELULAR" && (
                    <div>
                      <Label>IMEI</Label>
                      <Input
                        value={equipo.imei || ""}
                        onChange={(e) => setEquipo((p) => ({ ...p, imei: e.target.value || null }))}
                        disabled={loading}
                        className="mt-1"
                      />
                    </div>
                  )}
                  <div>
                    <Label>N° de serie</Label>
                    <Input
                      value={equipo.numeroSerie || ""}
                      onChange={(e) => setEquipo((p) => ({ ...p, numeroSerie: e.target.value || null }))}
                      disabled={loading}
                      className="mt-1"
                    />
                  </div>
                </div>
                <div>
                  <Label>Problema reportado *</Label>
                  <Textarea
                    value={equipo.problemaReportado}
                    onChange={(e) => setEquipo((p) => ({ ...p, problemaReportado: e.target.value }))}
                    placeholder={`Descripción del problema del ${t("equipo").toLowerCase()}...`}
                    rows={2}
                    disabled={loading}
                    className="mt-1"
                  />
                </div>
              </div>

              <ChecklistPicker
                tipoDispositivoId={equipo.tipoDispositivoId || null}
                value={checklistValue}
                onChange={setChecklistValue}
                disabled={loading}
              />

              <div className="space-y-3 p-3 border rounded-lg bg-muted/20">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Wrench className="h-4 w-4" /> Condiciones técnicas
                </div>
                <div>
                  <Label>Diagnóstico técnico</Label>
                  <Textarea
                    value={condiciones.diagnostico || ""}
                    onChange={(e) => setCondiciones((p) => ({ ...p, diagnostico: e.target.value || null }))}
                    placeholder={`Qué encontró el ${t("tecnico").toLowerCase()} al revisar el ${t("equipo").toLowerCase()} (distinto del problema reportado por el cliente)`}
                    rows={2}
                    disabled={loading}
                    className="mt-1"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label>Plazo estimado (días)</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      min="0"
                      value={condiciones.plazoEstimadoDias ?? ""}
                      onChange={(e) => setCondiciones((p) => ({ ...p, plazoEstimadoDias: e.target.value ? parseInt(e.target.value) : null }))}
                      placeholder="Ej: 5"
                      disabled={loading}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>Anticipo</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <Input
                        type="text"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={anticipoValorStr}
                        onChange={(e) => setAnticipoValorStr(e.target.value)}
                        placeholder="0"
                        disabled={loading}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant={condiciones.anticipoTipo === "fijo" ? "default" : "outline"}
                        size="icon"
                        className="h-10 w-10 shrink-0"
                        onClick={() => setCondiciones((p) => ({ ...p, anticipoTipo: p.anticipoTipo === "fijo" ? "porcentaje" : "fijo" }))}
                        disabled={loading}
                      >
                        {condiciones.anticipoTipo === "fijo" ? <DollarSign className="h-4 w-4" /> : <Percent className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <div>
                    <Label>Plazo de retiro (días)</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      min="0"
                      value={condiciones.politicaAbandonoDias ?? ""}
                      onChange={(e) => setCondiciones((p) => ({ ...p, politicaAbandonoDias: e.target.value ? parseInt(e.target.value) : null }))}
                      placeholder="Ej: 60"
                      disabled={loading}
                      className="mt-1"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Garantía (días)</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      min="0"
                      value={garantiaDiasStr}
                      onChange={(e) => setGarantiaDiasStr(e.target.value)}
                      placeholder="30"
                      disabled={loading || condiciones.garantiaAlcance === "NINGUNA"}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>Alcance de garantía</Label>
                    <Select
                      value={condiciones.garantiaAlcance}
                      onValueChange={(v) => setCondiciones((p) => ({ ...p, garantiaAlcance: v as CondicionesTecnicas["garantiaAlcance"] }))}
                      disabled={loading}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="AMBOS">Repuesto y mano de obra</SelectItem>
                        <SelectItem value="REPUESTO">Solo repuesto</SelectItem>
                        <SelectItem value="MANO_OBRA">Solo mano de obra</SelectItem>
                        <SelectItem value="NINGUNA">Sin garantía</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </CollapsibleSection>
          )}

          {/* Ítems */}
          <CollapsibleSection title="Ítems" icon={FileText} defaultOpen>
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

            {items.map((item, index) => (
              <ItemRow
                key={`item-${index}`}
                item={item}
                index={index}
                onUpdate={updateItem}
                onRemove={removeItem}
                disabled={loading}
                showTipoRepuesto={isPresupuesto}
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
          </CollapsibleSection>

          {/* Descuentos y totales */}
          <CollapsibleSection title="Descuentos y totales" icon={Calculator} defaultOpen>
            {/* Descuento Global + IVA */}
            <div className="flex flex-col sm:flex-row sm:items-end gap-3 p-3 bg-muted/50 rounded-lg">
              <div className="flex-1">
                <Label className="text-sm">Descuento Global</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    type="text"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="0"
                    value={descuentoGlobalValorStr}
                    onChange={(e) => setDescuentoGlobalValorStr(e.target.value)}
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
                  type="text"
                  inputMode="decimal"
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
                  <div className="flex justify-between text-sm text-success-600">
                    <span>Desc. items:</span>
                    <span>-{formatPrice(descuentoItems)}</span>
                  </div>
                )}
                {descuentoGlobal > 0 && (
                  <div className="flex justify-between text-sm text-success-600">
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
                {tieneCostos && (
                  <div className="pt-2 mt-1 border-t space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Costo repuestos:</span>
                      <span>{formatPrice(costoRepuestos)}</span>
                    </div>
                    <div className="flex justify-between text-sm font-medium text-success-600">
                      <span>Ganancia bruta:</span>
                      <span>{formatPrice(Math.max(0, subtotalGravable - costoRepuestos))}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CollapsibleSection>

          {/* Detalles y notas */}
          <CollapsibleSection title="Detalles y notas" icon={FileText} defaultOpen={false}>
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
          </CollapsibleSection>

          {/* Actions */}
          <FormActionBar>
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
          </FormActionBar>
        </form>
      </CardContent>
    </Card>
  )
}
