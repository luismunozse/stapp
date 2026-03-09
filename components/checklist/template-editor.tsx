"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Settings,
  Plus,
  Trash2,
  GripVertical,
  Save,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react"
import { useModal } from "@/contexts/modal-context"
import { useTiposDispositivo } from "@/hooks/use-tipos-dispositivo"

interface TemplateItem {
  id: string
  label: string
  tipo: string
  categoria: string
  opciones: string | null
  orden: number
  requerido: boolean
}

interface Template {
  id: string
  nombre: string
  activo: boolean
  items: TemplateItem[]
  tipoDispositivoId?: string | null
  tipoDispositivo?: { id: string; nombre: string; codigo: string } | null
  _count?: { checklists: number }
}

const categoriaOptions = [
  { value: "CONDICION_FISICA", label: "Condicion Fisica" },
  { value: "ACCESORIOS", label: "Accesorios" },
  { value: "FUNCIONAL", label: "Estado Funcional" },
  { value: "OTRO", label: "Otros" },
]

const tipoOptions = [
  { value: "BOOLEAN", label: "Si/No" },
  { value: "TEXT", label: "Texto libre" },
  { value: "SELECT", label: "Opciones" },
]

export function TemplateEditor() {
  const { confirm } = useModal()
  const { tipos: tiposDispositivo } = useTiposDispositivo()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  const [newItemLabel, setNewItemLabel] = useState("")
  const [newItemTipo, setNewItemTipo] = useState("BOOLEAN")
  const [newItemCategoria, setNewItemCategoria] = useState("CONDICION_FISICA")
  const [newItemOpciones, setNewItemOpciones] = useState("")
  const [newItemRequerido, setNewItemRequerido] = useState(false)
  const [showNewTemplateForm, setShowNewTemplateForm] = useState(false)
  const [newTemplateName, setNewTemplateName] = useState("")
  const [newTemplateDeviceType, setNewTemplateDeviceType] = useState<string>("")
  const [creatingTemplate, setCreatingTemplate] = useState(false)

  const fetchTemplates = async () => {
    try {
      const res = await fetch("/api/checklist-templates")
      if (!res.ok) throw new Error("Error fetching templates")
      const data = await res.json()
      setTemplates(data)
      if (data.length > 0 && !selectedTemplate) {
        setSelectedTemplate(data[0])
      }
    } catch (error) {
      console.error("Error:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTemplates()
  }, [])

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTemplateName.trim()) return

    setCreatingTemplate(true)
    try {
      const res = await fetch("/api/checklist-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: newTemplateName,
          tipoDispositivoId: newTemplateDeviceType && newTemplateDeviceType !== "all" ? newTemplateDeviceType : null,
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        alert(error.error || "Error al crear template")
        return
      }

      const template = await res.json()
      // Add device type info for display
      const effectiveDeviceType = newTemplateDeviceType && newTemplateDeviceType !== "all" ? newTemplateDeviceType : null
      const tipoInfo = effectiveDeviceType
        ? tiposDispositivo.find(t => t.id === effectiveDeviceType)
        : null
      const enriched = {
        ...template,
        items: [],
        tipoDispositivoId: effectiveDeviceType,
        tipoDispositivo: tipoInfo ? { id: tipoInfo.id, nombre: tipoInfo.nombre, codigo: tipoInfo.codigo } : null,
      }
      setTemplates((prev) => [enriched, ...prev])
      setSelectedTemplate(enriched)
      setShowNewTemplateForm(false)
      setNewTemplateName("")
      setNewTemplateDeviceType("")
    } catch (error) {
      console.error("Error:", error)
      alert("Error al crear template")
    } finally {
      setCreatingTemplate(false)
    }
  }

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedTemplate || !newItemLabel.trim()) return

    setSaving(true)
    try {
      const body: any = {
        label: newItemLabel,
        tipo: newItemTipo,
        categoria: newItemCategoria,
        requerido: newItemRequerido,
      }

      if (newItemTipo === "SELECT" && newItemOpciones.trim()) {
        body.opciones = JSON.stringify(
          newItemOpciones.split(",").map((o) => o.trim()).filter(Boolean)
        )
      }

      const res = await fetch(
        `/api/checklist-templates/${selectedTemplate.id}/items`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      )

      if (!res.ok) {
        const error = await res.json()
        alert(error.error || "Error al agregar item")
        return
      }

      const newItem = await res.json()
      setSelectedTemplate((prev) =>
        prev
          ? { ...prev, items: [...prev.items, newItem] }
          : null
      )
      setNewItemLabel("")
      setNewItemOpciones("")
      setNewItemRequerido(false)
    } catch (error) {
      console.error("Error:", error)
      alert("Error al agregar item")
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteItem = async (itemId: string) => {
    if (!selectedTemplate) return

    const confirmed = await confirm({
      title: "Eliminar Item",
      description: "¿Eliminar este item del checklist?",
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      variant: "danger",
    })

    if (!confirmed) return

    try {
      const res = await fetch(
        `/api/checklist-templates/${selectedTemplate.id}/items?itemId=${itemId}`,
        { method: "DELETE" }
      )

      if (!res.ok) {
        return
      }

      setSelectedTemplate((prev) =>
        prev
          ? { ...prev, items: prev.items.filter((i) => i.id !== itemId) }
          : null
      )
    } catch (error) {
      console.error("Error:", error)
    }
  }

  const handleMoveItem = async (itemId: string, direction: "up" | "down") => {
    if (!selectedTemplate) return

    const items = [...selectedTemplate.items]
    const index = items.findIndex((i) => i.id === itemId)
    if (index === -1) return
    if (direction === "up" && index === 0) return
    if (direction === "down" && index === items.length - 1) return

    const newIndex = direction === "up" ? index - 1 : index + 1
    const temp = items[index]
    items[index] = items[newIndex]
    items[newIndex] = temp

    // Update orden values
    const reorderedItems = items.map((item, i) => ({
      id: item.id,
      orden: i,
    }))

    setSelectedTemplate((prev) =>
      prev ? { ...prev, items: items.map((item, i) => ({ ...item, orden: i })) } : null
    )

    try {
      await fetch(`/api/checklist-templates/${selectedTemplate.id}/items`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: reorderedItems }),
      })
    } catch (error) {
      console.error("Error reordering items:", error)
    }
  }

  const handleDeleteTemplate = async () => {
    if (!selectedTemplate) return

    const confirmed = await confirm({
      title: "Eliminar Template",
      description: `¿Eliminar el template "${selectedTemplate.nombre}"? Esta acción no se puede deshacer.`,
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      variant: "danger",
    })

    if (!confirmed) return

    try {
      const res = await fetch(
        `/api/checklist-templates/${selectedTemplate.id}`,
        { method: "DELETE" }
      )

      if (!res.ok) {
        return
      }

      setTemplates((prev) => prev.filter((t) => t.id !== selectedTemplate.id))
      setSelectedTemplate(templates.length > 1 ? templates[0] : null)
    } catch (error) {
      console.error("Error:", error)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Templates de Checklist
              </CardTitle>
              <CardDescription>
                Configure los items que apareceran en el checklist de recepcion
              </CardDescription>
            </div>
            <Button
              variant="outline"
              onClick={() => setShowNewTemplateForm(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Template
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {showNewTemplateForm && (
            <form
              onSubmit={handleCreateTemplate}
              className="flex flex-col gap-3 mb-4 p-3 bg-muted rounded-lg"
            >
              <div className="flex gap-2">
                <Input
                  placeholder="Nombre del template..."
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  disabled={creatingTemplate}
                  className="flex-1"
                />
                <Select value={newTemplateDeviceType} onValueChange={setNewTemplateDeviceType}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Todos los tipos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">General (todos los tipos)</SelectItem>
                    {tiposDispositivo.map((tipo) => (
                      <SelectItem key={tipo.id} value={tipo.id}>
                        {tipo.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={creatingTemplate || !newTemplateName.trim()}>
                  {creatingTemplate ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Crear"
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => { setShowNewTemplateForm(false); setNewTemplateDeviceType("") }}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          )}

          {templates.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No hay templates configurados. Cree uno para comenzar.
            </p>
          ) : (
            <div className="flex gap-2 flex-wrap">
              {templates.map((template) => (
                <Button
                  key={template.id}
                  variant={
                    selectedTemplate?.id === template.id ? "default" : "outline"
                  }
                  size="sm"
                  onClick={() => setSelectedTemplate(template)}
                  className="flex items-center gap-1"
                >
                  {template.nombre}
                  {template.tipoDispositivo && (
                    <Badge className="ml-1 text-xs" variant="secondary">
                      {template.tipoDispositivo.nombre}
                    </Badge>
                  )}
                  {!template.tipoDispositivoId && (
                    <Badge className="ml-1 text-xs" variant="outline">
                      General
                    </Badge>
                  )}
                  {template.activo && (
                    <Badge className="ml-1 bg-green-100 text-green-800" variant="outline">
                      Activo
                    </Badge>
                  )}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedTemplate && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{selectedTemplate.nombre}</CardTitle>
                <CardDescription>
                  {selectedTemplate.items.length} items configurados
                  {selectedTemplate._count?.checklists
                    ? ` - Usado en ${selectedTemplate._count.checklists} orden(es)`
                    : ""}
                </CardDescription>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteTemplate}
                disabled={selectedTemplate._count?.checklists! > 0}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Eliminar Template
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Lista de items existentes */}
            {selectedTemplate.items.length > 0 && (
              <div className="space-y-2">
                {selectedTemplate.items
                  .sort((a, b) => a.orden - b.orden)
                  .map((item, index) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 p-3 border rounded-lg bg-background"
                    >
                      <div className="flex flex-col gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => handleMoveItem(item.id, "up")}
                          disabled={index === 0}
                        >
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => handleMoveItem(item.id, "down")}
                          disabled={index === selectedTemplate.items.length - 1}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex-1">
                        <div className="font-medium">{item.label}</div>
                        <div className="text-xs text-muted-foreground flex gap-2">
                          <Badge variant="outline" className="text-xs">
                            {tipoOptions.find((t) => t.value === item.tipo)?.label}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {categoriaOptions.find((c) => c.value === item.categoria)
                              ?.label}
                          </Badge>
                          {item.requerido && (
                            <Badge className="bg-red-100 text-red-800 text-xs">
                              Requerido
                            </Badge>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteItem(item.id)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
              </div>
            )}

            {/* Formulario para agregar nuevo item */}
            <form
              onSubmit={handleAddItem}
              className="space-y-4 p-4 border rounded-lg bg-muted/50"
            >
              <h4 className="font-medium">Agregar nuevo item</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="col-span-1 sm:col-span-2">
                  <Label htmlFor="label">Etiqueta</Label>
                  <Input
                    id="label"
                    value={newItemLabel}
                    onChange={(e) => setNewItemLabel(e.target.value)}
                    placeholder="Ej: Pantalla con rayones"
                    disabled={saving}
                  />
                </div>
                <div>
                  <Label htmlFor="tipo">Tipo de respuesta</Label>
                  <Select
                    value={newItemTipo}
                    onValueChange={setNewItemTipo}
                    disabled={saving}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      {tipoOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="categoria">Categoria</Label>
                  <Select
                    value={newItemCategoria}
                    onValueChange={setNewItemCategoria}
                    disabled={saving}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar categoría" />
                    </SelectTrigger>
                    <SelectContent>
                      {categoriaOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {newItemTipo === "SELECT" && (
                  <div className="col-span-1 sm:col-span-2">
                    <Label htmlFor="opciones">
                      Opciones (separadas por coma)
                    </Label>
                    <Input
                      id="opciones"
                      value={newItemOpciones}
                      onChange={(e) => setNewItemOpciones(e.target.value)}
                      placeholder="Ej: Bueno, Regular, Malo"
                      disabled={saving}
                    />
                  </div>
                )}
                <div className="col-span-1 sm:col-span-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="requerido"
                    checked={newItemRequerido}
                    onChange={(e) => setNewItemRequerido(e.target.checked)}
                    disabled={saving}
                    className="h-4 w-4"
                  />
                  <Label htmlFor="requerido" className="cursor-pointer">
                    Campo requerido
                  </Label>
                </div>
              </div>
              <Button type="submit" disabled={saving || !newItemLabel.trim()}>
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Agregar Item
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
