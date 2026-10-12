"use client"
import { useTerminologia } from "@/contexts/currency-context"

import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ClipboardCheck, Loader2 } from "lucide-react"

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

export type ChecklistPickerValue = {
  templateId: string
  tipoDispositivoId?: string | null
  valores: Record<string, boolean | string | null>
  notas?: string | null
}

interface Props {
  tipoDispositivoId?: string | null
  value: ChecklistPickerValue | null
  onChange: (value: ChecklistPickerValue | null) => void
  disabled?: boolean
}

const categoriaLabels: Record<string, string> = {
  CONDICION_FISICA: "Condición física",
  ACCESORIOS: "Accesorios entregados",
  FUNCIONAL: "Estado funcional",
  GENERAL: "General",
}

/**
 * Captura un checklist de recepción contra un template del tipo de dispositivo
 * seleccionado. Sin firma, sin network call — todo queda en local state y se
 * envía junto con el payload de la cotización.
 */
export function ChecklistPicker({ tipoDispositivoId, value, onChange, disabled }: Props) {
  const term = useTerminologia()
  const [template, setTemplate] = useState<Template | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load template when tipoDispositivoId changes
  useEffect(() => {
    if (!tipoDispositivoId) {
      setTemplate(null)
      onChange(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const res = await fetch(`/api/checklist-templates/by-device-type?tipoDispositivoId=${tipoDispositivoId}`)
        if (!res.ok) throw new Error("No se encontró checklist para este tipo")
        const data = await res.json()
        const tpl: Template | undefined = data?.template
        if (cancelled) return
        if (!tpl) {
          setTemplate(null)
          setError(`No hay checklist configurado para este tipo de ${term("equipo").toLowerCase()}`)
          onChange(null)
          return
        }
        setTemplate(tpl)
        // Si no hay value previo o es de otro template, inicializar vacío
        if (!value || value.templateId !== tpl.id) {
          onChange({
            templateId: tpl.id,
            tipoDispositivoId,
            valores: value?.templateId === tpl.id ? value.valores : {},
            notas: value?.notas || null,
          })
        }
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : "Error cargando checklist")
        setTemplate(null)
        onChange(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoDispositivoId])

  const setItemValue = (itemId: string, v: boolean | string | null) => {
    if (!value || !template) return
    onChange({
      ...value,
      valores: { ...value.valores, [itemId]: v },
    })
  }

  if (loading) {
    return (
      <div className="p-3 border rounded-lg bg-muted/30 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando checklist...
      </div>
    )
  }

  if (!tipoDispositivoId) {
    return (
      <div className="p-3 border rounded-lg bg-muted/30 text-sm text-muted-foreground">
        Seleccioná primero un tipo de {term("equipo").toLowerCase()} para cargar su checklist.
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-3 border rounded-lg bg-muted/30 text-sm text-muted-foreground">
        {error}
      </div>
    )
  }

  if (!template) return null

  const itemsByCat: Record<string, TemplateItem[]> = {}
  for (const item of template.items || []) {
    const cat = item.categoria || "GENERAL"
    if (!itemsByCat[cat]) itemsByCat[cat] = []
    itemsByCat[cat].push(item)
  }
  for (const cat of Object.keys(itemsByCat)) {
    itemsByCat[cat].sort((a, b) => (a.orden || 0) - (b.orden || 0))
  }

  return (
    <div className="space-y-4 p-3 border rounded-lg bg-muted/20">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ClipboardCheck className="h-4 w-4" /> Checklist de recepción
      </div>

      {Object.entries(itemsByCat).map(([cat, items]) => (
        <div key={cat}>
          <h4 className="text-xs font-medium text-muted-foreground border-b pb-1 mb-2">
            {categoriaLabels[cat] || cat}
          </h4>
          <div className="space-y-1">
            {items.map((it) => {
              const v = value?.valores?.[it.id]
              if (it.tipo === "BOOLEAN") {
                return (
                  <div key={it.id} className="flex items-center justify-between py-1">
                    <Label className="text-sm">
                      {it.label}
                      {it.requerido && <span className="text-red-500 ml-1">*</span>}
                    </Label>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant={v === true ? "default" : "outline"}
                        size="sm"
                        onClick={() => setItemValue(it.id, true)}
                        disabled={disabled}
                      >
                        Sí
                      </Button>
                      <Button
                        type="button"
                        variant={v === false ? "default" : "outline"}
                        size="sm"
                        onClick={() => setItemValue(it.id, false)}
                        disabled={disabled}
                      >
                        No
                      </Button>
                    </div>
                  </div>
                )
              }
              if (it.tipo === "TEXT") {
                return (
                  <div key={it.id} className="py-1">
                    <Label className="text-sm">
                      {it.label}
                      {it.requerido && <span className="text-red-500 ml-1">*</span>}
                    </Label>
                    <Input
                      value={(v as string) || ""}
                      onChange={(e) => setItemValue(it.id, e.target.value)}
                      disabled={disabled}
                      className="mt-1 h-8"
                    />
                  </div>
                )
              }
              if (it.tipo === "SELECT") {
                const opciones: string[] = it.opciones ? JSON.parse(it.opciones) : []
                return (
                  <div key={it.id} className="py-1">
                    <Label className="text-sm">
                      {it.label}
                      {it.requerido && <span className="text-red-500 ml-1">*</span>}
                    </Label>
                    <Select
                      value={(v as string) || "__none"}
                      onValueChange={(nv) => setItemValue(it.id, nv === "__none" ? "" : nv)}
                      disabled={disabled}
                    >
                      <SelectTrigger className="mt-1 h-8">
                        <SelectValue placeholder="Seleccionar..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">Seleccionar...</SelectItem>
                        {opciones.map((opt) => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )
              }
              return null
            })}
          </div>
        </div>
      ))}

      <div>
        <Label className="text-sm">Observaciones</Label>
        <Textarea
          value={value?.notas || ""}
          onChange={(e) =>
            value && onChange({ ...value, notas: e.target.value })
          }
          rows={2}
          disabled={disabled}
          placeholder={`Notas adicionales sobre el estado del ${term("equipo").toLowerCase()}...`}
          className="mt-1"
        />
      </div>
    </div>
  )
}
