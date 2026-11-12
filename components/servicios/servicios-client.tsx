"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Plus, Search, Edit, Trash2 } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SelectorMoneda } from "@/components/moneda/selector-moneda"
import { PrecioEnMoneda } from "@/components/moneda/precio-en-moneda"
import { EquivalenteLocal } from "@/components/moneda/equivalente-local"
import { DialogoCambioMoneda } from "@/components/moneda/dialogo-cambio-moneda"
import { useMoneda } from "@/hooks/use-moneda"
import { convertirPrecioCatalogo, cotizacionDe, type MonedaCatalogo } from "@/lib/currency/catalogo"
import { unidadRedondeo } from "@/lib/currency/convert"
import { useModal } from "@/contexts/modal-context"

interface Servicio {
  id: string
  codigo: string
  nombre: string
  descripcion: string | null
  categoria: string | null
  precio: number
  duracionEstimadaMin: number | null
  activo: boolean
  moneda: MonedaCatalogo
}

interface ServicioFormState {
  codigo: string
  nombre: string
  descripcion: string
  categoria: string
  precio: number
  duracionEstimadaMin: number | null
  activo: boolean
  moneda: MonedaCatalogo
}

const emptyForm: ServicioFormState = {
  codigo: "",
  nombre: "",
  descripcion: "",
  categoria: "",
  precio: 0,
  duracionEstimadaMin: null,
  activo: true,
  moneda: null,
}

export function ServiciosClient() {
  const { config: configMoneda, tipoCambio } = useMoneda()
  const { confirm, alert } = useModal()

  const [servicios, setServicios] = useState<Servicio[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [form, setForm] = useState<ServicioFormState>(emptyForm)
  const [precioDraft, setPrecioDraft] = useState("")
  const [duracionDraft, setDuracionDraft] = useState("")
  /** Currency filter: "" all, "local" or "divisa" (the API's ?moneda=). */
  const [monedaFiltro, setMonedaFiltro] = useState<"" | "local" | "divisa">("")
  // The currency the service was saved with: the PUT only sends the currency when it changed.
  const monedaGuardada = useRef<MonedaCatalogo>(null)
  const [monedaPedida, setMonedaPedida] = useState<{ a: MonedaCatalogo } | null>(null)

  const fetchServicios = async () => {
    try {
      // incluirInactivos: esta pantalla administra el catalogo completo, a
      // diferencia del selector de la orden que solo debe ofrecer activos.
      const params = new URLSearchParams({ incluirInactivos: "true" })
      if (monedaFiltro) params.set("moneda", monedaFiltro)
      const res = await fetch(`/api/servicios?${params.toString()}`, { cache: "no-store" })
      const data = await res.json()
      setServicios(data.servicios ?? [])
    } catch (error) {
      console.error("Error fetching servicios:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchServicios()
  }, [monedaFiltro])

  const resetForm = () => {
    setForm(emptyForm)
    setPrecioDraft("")
    setDuracionDraft("")
    setEditingId(null)
    setMonedaPedida(null)
    monedaGuardada.current = null
  }

  const handleOpenCreate = () => {
    resetForm()
    setShowForm(true)
  }

  const handleOpenEdit = (servicio: Servicio) => {
    setForm({
      codigo: servicio.codigo,
      nombre: servicio.nombre,
      descripcion: servicio.descripcion || "",
      categoria: servicio.categoria || "",
      precio: servicio.precio,
      duracionEstimadaMin: servicio.duracionEstimadaMin,
      activo: servicio.activo,
      moneda: servicio.moneda ?? null,
    })
    monedaGuardada.current = servicio.moneda ?? null
    setPrecioDraft(String(servicio.precio))
    setDuracionDraft(servicio.duracionEstimadaMin != null ? String(servicio.duracionEstimadaMin) : "")
    setEditingId(servicio.id)
    setShowForm(true)
  }

  const handleCancelForm = () => {
    setShowForm(false)
    resetForm()
  }

  const handleSave = async () => {
    if (!form.codigo.trim() || !form.nombre.trim() || form.precio < 0) {
      await alert({
        title: "Datos incompletos",
        description: "Completa código, nombre y precio",
        variant: "warning",
      })
      return
    }

    setSaving(true)
    try {
      const payload = {
        codigo: form.codigo.trim(),
        nombre: form.nombre.trim(),
        descripcion: form.descripcion.trim() || null,
        categoria: form.categoria.trim() || null,
        precio: form.precio,
        duracionEstimadaMin: form.duracionEstimadaMin,
        activo: form.activo,
        // POST always says it (null = local); PUT only when it changed, so an edit never touches it.
        moneda: !editingId || form.moneda !== monedaGuardada.current ? form.moneda : undefined,
      }

      const res = await fetch(editingId ? `/api/servicios/${editingId}` : "/api/servicios", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        // Esperamos el refetch antes de cerrar el formulario: si no, la lista
        // muestra brevemente el estado anterior sin ningun indicador de carga,
        // lo que invita a reintentar y crear un servicio duplicado.
        await fetchServicios()
        handleCancelForm()
      } else {
        const error = await res.json()
        await alert({
          title: "Error",
          description: error.error || "Error al guardar el servicio",
          variant: "error",
        })
      }
    } catch (error) {
      console.error("Error saving servicio:", error)
      await alert({ title: "Error", description: "Error al guardar el servicio", variant: "error" })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (servicio: Servicio) => {
    const confirmed = await confirm({
      title: "Eliminar servicio",
      description: `¿Estás seguro de eliminar "${servicio.nombre}"? Esta acción no se puede deshacer.`,
      confirmText: "Eliminar",
      variant: "danger",
    })
    if (!confirmed) return

    setDeletingId(servicio.id)
    try {
      const res = await fetch(`/api/servicios/${servicio.id}`, { method: "DELETE" })
      if (res.ok) {
        await fetchServicios()
      } else {
        const error = await res.json()
        await alert({
          title: "Error",
          description: error.error || "Error al eliminar el servicio",
          variant: "error",
        })
      }
    } catch (error) {
      console.error("Error deleting servicio:", error)
      await alert({ title: "Error", description: "Error al eliminar el servicio", variant: "error" })
    } finally {
      setDeletingId(null)
    }
  }

  // --- Moneda del precio -----------------------------------------------------
  const cotizacionCambio =
    monedaPedida && configMoneda ? cotizacionDe(form.moneda ?? monedaPedida.a, configMoneda, tipoCambio ?? null) : null
  const pedirMoneda = (m: MonedaCatalogo) => {
    if (m === form.moneda) return
    if (form.precio > 0) setMonedaPedida({ a: m })
    else setForm({ ...form, moneda: m })
  }
  const convertirMoneda = () => {
    if (!monedaPedida || !configMoneda || cotizacionCambio === null) return
    const unidad = unidadRedondeo(configMoneda.redondeoConversion, configMoneda.monedaLocal)
    const precio = convertirPrecioCatalogo(form.precio, form.moneda, monedaPedida.a, cotizacionCambio, unidad)
    setForm({ ...form, precio, moneda: monedaPedida.a })
    setPrecioDraft(String(precio))
    setMonedaPedida(null)
  }
  const mantenerMoneda = () => {
    if (monedaPedida) setForm({ ...form, moneda: monedaPedida.a })
    setMonedaPedida(null)
  }
  // The filter shows with the feature on, or while some loaded service is priced in a foreign
  // currency (the feature may have been turned off since), or while the filter is in use.
  const mostrarFiltroMoneda =
    !!configMoneda && (configMoneda.habilitada || monedaFiltro !== "" || servicios.some((s) => (s.moneda ?? null) !== null))

  const visibles = servicios.filter((s) =>
    s.nombre.toLowerCase().includes(search.trim().toLowerCase())
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre…"
            className="pl-8"
          />
        </div>
        {mostrarFiltroMoneda && configMoneda && (
          <Select value={monedaFiltro || "all"} onValueChange={(v) => setMonedaFiltro(v === "all" ? "" : (v as "local" | "divisa"))}>
            <SelectTrigger className="w-full sm:w-48" aria-label="Moneda">
              <SelectValue placeholder="Todas las monedas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las monedas</SelectItem>
              <SelectItem value="local">Moneda local</SelectItem>
              <SelectItem value="divisa">{configMoneda.monedaExtranjera}</SelectItem>
            </SelectContent>
          </Select>
        )}
        {!showForm && (
          <Button onClick={handleOpenCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Nuevo servicio
          </Button>
        )}
      </div>

      {showForm && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {editingId ? "Editar servicio" : "Nuevo servicio"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Código</Label>
                <Input
                  placeholder="Ej: SRV-001"
                  value={form.codigo}
                  onChange={(e) => setForm({ ...form, codigo: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs">Nombre</Label>
                <Input
                  placeholder="Ej: Instalación de Windows"
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">Descripción</Label>
              <Input
                placeholder="Opcional"
                value={form.descripcion}
                onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label className="text-xs">Categoría</Label>
                <Input
                  placeholder="Opcional"
                  value={form.categoria}
                  onChange={(e) => setForm({ ...form, categoria: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs">Precio</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={precioDraft}
                  onChange={(e) => {
                    setPrecioDraft(e.target.value)
                    setForm({ ...form, precio: parseFloat(e.target.value) || 0 })
                  }}
                />
                {form.moneda !== null && <EquivalenteLocal monto={form.precio} moneda={form.moneda} />}
              </div>
              <div>
                <Label className="text-xs">Duración estimada (min)</Label>
                <Input
                  type="number"
                  min="1"
                  placeholder="Opcional"
                  value={duracionDraft}
                  onChange={(e) => {
                    const raw = e.target.value
                    setDuracionDraft(raw)
                    setForm({ ...form, duracionEstimadaMin: raw === "" ? null : parseInt(raw, 10) || null })
                  }}
                />
              </div>
            </div>

            <div className="sm:w-1/3">
              <SelectorMoneda value={form.moneda} onChange={pedirMoneda} />
            </div>

            <DialogoCambioMoneda
              open={monedaPedida !== null}
              de={form.moneda}
              a={monedaPedida?.a ?? null}
              puedeConvertir={cotizacionCambio !== null}
              onConvertir={convertirMoneda}
              onMantener={mantenerMoneda}
              onCancelar={() => setMonedaPedida(null)}
            />

            <div className="flex items-center justify-between pt-1">
              <Label htmlFor="servicio-activo">Activo</Label>
              <Switch
                id="servicio-activo"
                checked={form.activo}
                onCheckedChange={(checked) => setForm({ ...form, activo: checked })}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {editingId ? "Guardar cambios" : "Crear"}
              </Button>
              <Button size="sm" variant="ghost" onClick={handleCancelForm}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {servicios.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Todavía no cargaste ningún servicio
          </CardContent>
        </Card>
      ) : visibles.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            No hay servicios que coincidan con la búsqueda.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {visibles.map((servicio) => (
            <div
              key={servicio.id}
              className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between p-3 border rounded-lg"
            >
              <div className="min-w-0">
                <div className="font-medium flex items-center gap-2 flex-wrap">
                  {servicio.nombre}
                  <span className="text-xs text-muted-foreground">{servicio.codigo}</span>
                  {servicio.categoria && (
                    <Badge variant="secondary" className="text-xs font-normal">
                      {servicio.categoria}
                    </Badge>
                  )}
                  {!servicio.activo && (
                    <Badge variant="outline" className="text-xs font-normal bg-muted">
                      Inactivo
                    </Badge>
                  )}
                </div>
                {servicio.descripcion && (
                  <div className="text-sm text-muted-foreground">{servicio.descripcion}</div>
                )}
                {servicio.duracionEstimadaMin != null && (
                  <div className="text-xs text-muted-foreground">
                    {servicio.duracionEstimadaMin} min estimados
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3">
                <div className="mr-auto sm:mr-0 sm:text-right">
                  <div className="font-semibold whitespace-nowrap">
                    <PrecioEnMoneda monto={servicio.precio} moneda={servicio.moneda ?? null} />
                  </div>
                  <EquivalenteLocal monto={servicio.precio} moneda={servicio.moneda ?? null} />
                </div>
                <IconButton
                  label="Editar servicio"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => handleOpenEdit(servicio)}
                >
                  <Edit className="h-4 w-4" />
                </IconButton>
                <IconButton
                  label="Eliminar servicio"
                  variant="ghost"
                  className="h-8 w-8"
                  disabled={deletingId === servicio.id}
                  onClick={() => handleDelete(servicio)}
                >
                  <Trash2 className="h-4 w-4 text-destructive-text" />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
