"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ClipboardCheck, Loader2, Save } from "lucide-react"
import { SignaturePad } from "@/components/firma/signature-pad"

interface TemplateItem {
  id: string
  label: string
  tipo: string // BOOLEAN, TEXT, SELECT
  categoria: string
  opciones: string | null
  orden: number
  requerido: boolean
}

interface Template {
  id: string
  nombre: string
  items: TemplateItem[]
}

interface ChecklistFormProps {
  ordenId: string
  template: Template
  initialValues?: Record<string, boolean | string | null>
  initialNotas?: string
  initialFirma?: string | null
  initialFirmaMime?: string | null
  isEditing?: boolean
  onSuccess: () => void
  onCancel: () => void
}

const categoriaLabels: Record<string, string> = {
  CONDICION_FISICA: "Condicion Fisica",
  ACCESORIOS: "Accesorios Entregados",
  FUNCIONAL: "Estado Funcional",
  OTRO: "Otros",
  GENERAL: "General",
}

export function ChecklistForm({
  ordenId,
  template,
  initialValues = {},
  initialNotas = "",
  initialFirma = null,
  initialFirmaMime = null,
  isEditing = false,
  onSuccess,
  onCancel,
}: ChecklistFormProps) {
  const [loading, setLoading] = useState(false)
  const [valores, setValores] = useState<Record<string, boolean | string | null>>(initialValues)
  const [notas, setNotas] = useState(initialNotas)
  const [firmaCliente, setFirmaCliente] = useState<string | null>(initialFirma)
  const [firmaMime, setFirmaMime] = useState<string | null>(initialFirmaMime)

  // Agrupar items por categoría
  const itemsByCategory = template.items.reduce((acc, item) => {
    const cat = item.categoria || "GENERAL"
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(item)
    return acc
  }, {} as Record<string, TemplateItem[]>)

  const handleValueChange = (itemId: string, value: boolean | string | null) => {
    setValores((prev) => ({
      ...prev,
      [itemId]: value,
    }))
  }

  const handleSignatureChange = (data: string | null, mime: string | null) => {
    setFirmaCliente(data)
    setFirmaMime(mime)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validar campos requeridos
    const missingRequired = template.items.filter((item) => {
      if (!item.requerido) return false
      const value = valores[item.id]
      if (item.tipo === "BOOLEAN") return value === undefined || value === null
      return !value
    })

    if (missingRequired.length > 0) {
      alert(`Completá los campos requeridos: ${missingRequired.map((i) => i.label).join(", ")}`)
      return
    }

    setLoading(true)

    try {
      const method = isEditing ? "PUT" : "POST"
      const body = isEditing
        ? { valores, notas, firmaCliente, firmaMime }
        : { templateId: template.id, valores, notas, firmaCliente, firmaMime }

      const res = await fetch(`/api/ordenes/${ordenId}/checklist`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const error = await res.json()
        alert(error.error || "Error al guardar checklist")
        return
      }

      onSuccess()
    } catch (error) {
      console.error("Error:", error)
      alert("Error al guardar checklist")
    } finally {
      setLoading(false)
    }
  }

  const renderItem = (item: TemplateItem) => {
    const value = valores[item.id]

    switch (item.tipo) {
      case "BOOLEAN":
        return (
          <div key={item.id} className="flex items-center justify-between py-2">
            <Label
              htmlFor={item.id}
              className="cursor-pointer flex items-center gap-2"
            >
              {item.label}
              {item.requerido && <span className="text-red-500">*</span>}
            </Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={value === true ? "default" : "outline"}
                size="sm"
                onClick={() => handleValueChange(item.id, true)}
                disabled={loading}
              >
                Sí
              </Button>
              <Button
                type="button"
                variant={value === false ? "default" : "outline"}
                size="sm"
                onClick={() => handleValueChange(item.id, false)}
                disabled={loading}
              >
                No
              </Button>
            </div>
          </div>
        )

      case "TEXT":
        return (
          <div key={item.id} className="py-2">
            <Label htmlFor={item.id}>
              {item.label}
              {item.requerido && <span className="text-red-500">*</span>}
            </Label>
            <Input
              id={item.id}
              value={(value as string) || ""}
              onChange={(e) => handleValueChange(item.id, e.target.value)}
              disabled={loading}
              className="mt-1"
            />
          </div>
        )

      case "SELECT":
        const opciones = item.opciones ? JSON.parse(item.opciones) : []
        return (
          <div key={item.id} className="py-2">
            <Label htmlFor={item.id}>
              {item.label}
              {item.requerido && <span className="text-red-500">*</span>}
            </Label>
            <Select
              value={(value as string) || "none"}
              onValueChange={(val) => handleValueChange(item.id, val === "none" ? "" : val)}
              disabled={loading}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Seleccionar..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Seleccionar...</SelectItem>
                {opciones.map((opt: string) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5" />
          {isEditing ? "Editar Checklist" : "Checklist de Recepción"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {Object.entries(itemsByCategory).map(([categoria, items]) => (
            <div key={categoria}>
              <h3 className="font-medium text-sm text-muted-foreground border-b pb-2 mb-3">
                {categoriaLabels[categoria] || categoria}
              </h3>
              <div className="space-y-1">
                {items.map((item) => renderItem(item))}
              </div>
            </div>
          ))}

          <div>
            <Label htmlFor="notas">Observaciones adicionales</Label>
            <Textarea
              id="notas"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Notas adicionales sobre el estado del equipo..."
              rows={3}
              disabled={loading}
              className="mt-1"
            />
          </div>

          {/* Firma del cliente */}
          <div className="pt-4 border-t">
            <SignaturePad
              label="Firma del Cliente (Conformidad de recepcion)"
              onSignatureChange={handleSignatureChange}
              initialSignature={initialFirma}
              initialMime={initialFirmaMime}
              disabled={loading}
            />
          </div>

          <div className="flex gap-2 justify-end pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  {isEditing ? "Actualizar" : "Guardar"} Checklist
                </>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
