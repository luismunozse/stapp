"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Save, RotateCcw, Eye, EyeOff, Loader2 } from "lucide-react"
import {
  PLANTILLAS_CATALOG,
  CATEGORIES,
  getPlantillasByCategory,
  renderTemplate,
  type PlantillaCategory,
  type PlantillaDefinition,
  type PlantillaVariable,
} from "@/lib/whatsapp/plantillas-catalog"

type PlantillasMap = Record<string, string>

function buildPreviewContext(variables: PlantillaVariable[]): Record<string, string> {
  const ctx: Record<string, string> = {}
  for (const v of variables) {
    ctx[v.key] = v.example ?? `[${v.label}]`
  }
  return ctx
}

interface PlantillaEditorCardProps {
  plantilla: PlantillaDefinition
  value: string
  onChange: (next: string) => void
  disabled: boolean
}

function PlantillaEditorCard({ plantilla, value, onChange, disabled }: PlantillaEditorCardProps) {
  const [showPreview, setShowPreview] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const effectiveText = value || plantilla.defaultText
  const previewCtx = buildPreviewContext(plantilla.variables)
  const previewText = renderTemplate(effectiveText, previewCtx)
  const isCustomized = value.trim().length > 0 && value !== plantilla.defaultText

  const handleInsertVar = (varKey: string) => {
    const el = textareaRef.current
    const current = value || plantilla.defaultText
    if (!el) {
      onChange(current + `{${varKey}}`)
      return
    }
    const start = el.selectionStart ?? current.length
    const end = el.selectionEnd ?? current.length
    const next = current.slice(0, start) + `{${varKey}}` + current.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      const newPos = start + varKey.length + 2
      el.setSelectionRange(newPos, newPos)
    })
  }

  return (
    <Card>
      <CardHeader className="p-4 sm:p-5 pb-2">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              {plantilla.label}
              {isCustomized && (
                <Badge variant="secondary" className="text-[10px] font-normal">
                  Personalizada
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              {plantilla.description}
            </CardDescription>
          </div>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowPreview((v) => !v)}
              className="h-7 px-2 text-xs"
            >
              {showPreview ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              <span className="ml-1">Vista previa</span>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 sm:p-5 pt-2 space-y-2">
        <div className="flex flex-wrap gap-1">
          {plantilla.variables.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => handleInsertVar(v.key)}
              disabled={disabled}
              title={v.label}
              className="px-1.5 py-0.5 rounded bg-muted hover:bg-muted-foreground/10 text-[10px] font-mono disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {`{${v.key}}`}
            </button>
          ))}
        </div>

        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          rows={Math.min(12, Math.max(4, effectiveText.split("\n").length + 1))}
          placeholder={plantilla.defaultText}
          className="font-mono text-xs"
        />

        <div className="flex justify-between items-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || !value}
            onClick={() => onChange("")}
            className="h-7 text-xs"
          >
            <RotateCcw className="mr-1.5 h-3 w-3" />
            Restaurar predeterminado
          </Button>
          <span className="text-[10px] text-muted-foreground">
            {value.length} / 4000
          </span>
        </div>

        {showPreview && (
          <div className="border rounded-md p-3 bg-muted/30 text-xs whitespace-pre-wrap font-mono">
            <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">
              Vista previa
            </div>
            {previewText}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function PlantillasWhatsappEditor() {
  const [plantillas, setPlantillas] = useState<PlantillasMap>({})
  const [originalPlantillas, setOriginalPlantillas] = useState<PlantillasMap>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)

  const grouped = getPlantillasByCategory()
  const categoryKeys = Object.keys(CATEGORIES) as PlantillaCategory[]
  const hasChanges = JSON.stringify(plantillas) !== JSON.stringify(originalPlantillas)

  useEffect(() => {
    let cancelled = false
    fetch("/api/notificaciones/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return
        const initial = (data?.plantillasWhatsapp ?? {}) as PlantillasMap
        setPlantillas(initial)
        setOriginalPlantillas(initial)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleChange = (key: string, next: string) => {
    setPlantillas((prev) => ({ ...prev, [key]: next }))
  }

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)

    // Enviar solo las plantillas con valor; las vacías se interpretan como
    // "usar default" y serán eliminadas en el backend.
    const payload: PlantillasMap = {}
    for (const [k, v] of Object.entries(plantillas)) {
      payload[k] = v
    }

    try {
      const res = await fetch("/api/notificaciones/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plantillasWhatsapp: payload }),
      })

      if (res.ok) {
        const data = await res.json()
        const saved = (data?.plantillasWhatsapp ?? {}) as PlantillasMap
        setPlantillas(saved)
        setOriginalPlantillas(saved)
        setMessage({ type: "success", text: "Plantillas guardadas" })
        setTimeout(() => setMessage(null), 3000)
      } else {
        const error = await res.json().catch(() => ({}))
        setMessage({ type: "error", text: error.error || "Error al guardar" })
      }
    } catch {
      setMessage({ type: "error", text: "Error al guardar plantillas" })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando plantillas...
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {message && (
        <div
          className={`px-4 py-3 rounded text-sm ${
            message.type === "success"
              ? "bg-green-50 dark:bg-green-950/50 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400"
              : "bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400"
          }`}
        >
          {message.text}
        </div>
      )}

      <Tabs defaultValue={categoryKeys[0]} className="space-y-4">
        <TabsList className="w-full justify-start overflow-x-auto flex-nowrap">
          {categoryKeys.map((cat) => {
            const count = grouped[cat].length
            if (count === 0) return null
            return (
              <TabsTrigger key={cat} value={cat} className="text-xs sm:text-sm">
                {CATEGORIES[cat].label}
                <span className="ml-1.5 text-[10px] text-muted-foreground">({count})</span>
              </TabsTrigger>
            )
          })}
        </TabsList>

        {categoryKeys.map((cat) => (
          <TabsContent key={cat} value={cat} className="space-y-3">
            <p className="text-sm text-muted-foreground">{CATEGORIES[cat].description}</p>
            {grouped[cat].map((p) => (
              <PlantillaEditorCard
                key={p.key}
                plantilla={p}
                value={plantillas[p.key] ?? ""}
                onChange={(next) => handleChange(p.key, next)}
                disabled={saving}
              />
            ))}
          </TabsContent>
        ))}
      </Tabs>

      <div className="sticky bottom-4 z-10">
        <div className="bg-background border rounded-lg p-3 shadow-lg flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {hasChanges ? "Cambios sin guardar" : "Sin cambios pendientes"}
          </span>
          <Button onClick={handleSave} disabled={saving || !hasChanges}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {saving ? "Guardando..." : "Guardar plantillas"}
          </Button>
        </div>
      </div>
    </div>
  )
}
