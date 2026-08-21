"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Plus, Search, Edit, Trash2 } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
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
}

interface ServicioFormState {
  codigo: string
  nombre: string
  descripcion: string
  categoria: string
  precio: number
  duracionEstimadaMin: number | null
  activo: boolean
}

const emptyForm: ServicioFormState = {
  codigo: "",
  nombre: "",
  descripcion: "",
  categoria: "",
  precio: 0,
  duracionEstimadaMin: null,
  activo: true,
}

export function ServiciosClient() {
  const { formatPrice } = useCurrency()
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

  const fetchServicios = async () => {
    try {
      // incluirInactivos: esta pantalla administra el catalogo completo, a
      // diferencia del selector de la orden que solo debe ofrecer activos.
      const res = await fetch("/api/servicios?incluirInactivos=true", { cache: "no-store" })
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
  }, [])

  const resetForm = () => {
    setForm(emptyForm)
    setPrecioDraft("")
    setDuracionDraft("")
    setEditingId(null)
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
    })
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
              className="flex items-center justify-between p-3 border rounded-lg"
            >
              <div>
                <div className="font-medium flex items-center gap-2 flex-wrap">
                  {servicio.nombre}
                  <span className="text-xs text-muted-foreground">{servicio.codigo}</span>
                  {servicio.categoria && (
                    <Badge variant="secondary" className="text-[10px] font-normal">
                      {servicio.categoria}
                    </Badge>
                  )}
                  {!servicio.activo && (
                    <Badge variant="outline" className="text-[10px] font-normal bg-muted">
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
                <span className="font-semibold">{formatPrice(servicio.precio)}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handleOpenEdit(servicio)}
                >
                  <Edit className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={deletingId === servicio.id}
                  onClick={() => handleDelete(servicio)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
