"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import {
  Save,
  RotateCcw,
  Loader2,
  Search,
  X,
  Check,
  ChevronLeft,
  Sparkles,
  ClipboardList,
  ShoppingCart,
  Calendar,
  Wallet,
  Wrench,
  Megaphone,
  MessageCircle,
} from "lucide-react"
import {
  PLANTILLAS_CATALOG,
  CATEGORIES,
  renderTemplate,
  type PlantillaCategory,
  type PlantillaDefinition,
  type PlantillaVariable,
} from "@/lib/whatsapp/plantillas-catalog"
import { cn } from "@/lib/utils"

type PlantillasMap = Record<string, string>

const CATEGORY_ICONS: Record<PlantillaCategory, React.ComponentType<{ className?: string }>> = {
  ordenes: ClipboardList,
  ventas: ShoppingCart,
  turnos: Calendar,
  cobranza: Wallet,
  operativo: Wrench,
  marketing: Megaphone,
}

const CATEGORY_COLORS: Record<PlantillaCategory, string> = {
  ordenes: "text-blue-600 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900",
  ventas: "text-green-600 bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-900",
  turnos: "text-purple-600 bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-900",
  cobranza: "text-amber-600 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900",
  operativo: "text-orange-600 bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-900",
  marketing: "text-pink-600 bg-pink-50 dark:bg-pink-950/40 border-pink-200 dark:border-pink-900",
}

function buildPreviewContext(variables: PlantillaVariable[]): Record<string, string> {
  const ctx: Record<string, string> = {}
  for (const v of variables) {
    ctx[v.key] = v.example ?? `[${v.label}]`
  }
  return ctx
}

function snippet(text: string, maxLen = 80): string {
  const single = text.replace(/\s+/g, " ").trim()
  if (single.length <= maxLen) return single
  return single.slice(0, maxLen).trimEnd() + "…"
}

// =====================================================================
// WhatsApp-style preview bubble
// =====================================================================

function WhatsAppPreview({ text }: { text: string }) {
  // Convert WhatsApp markdown (*bold*) to JSX
  const renderMarkdown = (line: string) => {
    const parts: React.ReactNode[] = []
    const regex = /\*([^*]+)\*/g
    let lastIdx = 0
    let m: RegExpExecArray | null
    while ((m = regex.exec(line)) !== null) {
      if (m.index > lastIdx) parts.push(line.slice(lastIdx, m.index))
      parts.push(<strong key={parts.length}>{m[1]}</strong>)
      lastIdx = m.index + m[0].length
    }
    if (lastIdx < line.length) parts.push(line.slice(lastIdx))
    return parts.length > 0 ? parts : line
  }

  const lines = text.split("\n")
  const time = new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })

  return (
    <div className="rounded-lg p-3 bg-[#e5ddd5] dark:bg-[#0b141a]">
      <div className="text-[10px] text-center text-muted-foreground mb-2 font-medium">
        Vista previa en WhatsApp
      </div>
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-[#dcf8c6] dark:bg-[#005c4b] px-2.5 py-1.5 text-sm relative shadow-sm">
          <div className="whitespace-pre-wrap break-words text-gray-900 dark:text-gray-100 leading-snug">
            {lines.map((line, i) => (
              <div key={i}>{renderMarkdown(line) || " "}</div>
            ))}
          </div>
          <div className="text-[9px] text-gray-500 dark:text-gray-300 text-right mt-0.5 flex items-center justify-end gap-0.5">
            {time}
            <Check className="h-2.5 w-2.5" />
            <Check className="h-2.5 w-2.5 -ml-1.5" />
          </div>
        </div>
      </div>
    </div>
  )
}

// =====================================================================
// Variable chip
// =====================================================================

function VariableChip({
  variable,
  onClick,
  disabled,
}: {
  variable: PlantillaVariable
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className="px-2 py-1 rounded-md bg-muted hover:bg-primary/10 hover:text-primary border border-transparent hover:border-primary/30 text-[11px] font-mono transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
        >
          <Sparkles className="h-2.5 w-2.5" />
          {`{${variable.key}}`}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <div className="font-medium">{variable.label}</div>
        {variable.example && (
          <div className="text-muted-foreground mt-0.5">Ejemplo: {variable.example}</div>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

// =====================================================================
// Editor panel for a single plantilla
// =====================================================================

interface PlantillaEditorProps {
  plantilla: PlantillaDefinition
  value: string
  onChange: (next: string) => void
  onBack?: () => void
  disabled: boolean
}

function PlantillaEditor({ plantilla, value, onChange, onBack, disabled }: PlantillaEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const effectiveText = value || plantilla.defaultText
  const previewCtx = buildPreviewContext(plantilla.variables)
  const previewText = renderTemplate(effectiveText, previewCtx)
  const isCustomized = value.trim().length > 0 && value !== plantilla.defaultText
  const Icon = CATEGORY_ICONS[plantilla.category]
  const colorClass = CATEGORY_COLORS[plantilla.category]

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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b p-4 flex items-start gap-3">
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack} className="lg:hidden -ml-2 mt-0.5">
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}
        <div className={cn("rounded-lg p-2 border shrink-0", colorClass)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-semibold text-base sm:text-lg">{plantilla.label}</h2>
            {isCustomized && (
              <Badge variant="secondary" className="text-[10px] font-normal h-5">
                <Sparkles className="h-2.5 w-2.5 mr-1" />
                Personalizada
              </Badge>
            )}
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            {plantilla.description}
          </p>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Variables */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Variables disponibles
            </label>
            <span className="text-[10px] text-muted-foreground">Click para insertar</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {plantilla.variables.map((v) => (
              <VariableChip
                key={v.key}
                variable={v}
                onClick={() => handleInsertVar(v.key)}
                disabled={disabled}
              />
            ))}
          </div>
        </div>

        {/* Editor + Preview side-by-side on desktop */}
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Mensaje
              </label>
              <span className="text-[10px] text-muted-foreground">
                {(value || plantilla.defaultText).length} / 4000
              </span>
            </div>
            <Textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              disabled={disabled}
              rows={Math.min(20, Math.max(8, effectiveText.split("\n").length + 1))}
              placeholder={plantilla.defaultText}
              className="font-mono text-xs resize-none"
            />
            <div className="flex justify-between items-center gap-2">
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
              {!value && (
                <span className="text-[10px] text-muted-foreground italic">
                  Usando predeterminado
                </span>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Vista previa
            </label>
            <WhatsAppPreview text={previewText} />
            <p className="text-[10px] text-muted-foreground italic">
              Los valores son de ejemplo. En envíos reales se reemplazan con datos del cliente.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// =====================================================================
// Sidebar item
// =====================================================================

interface SidebarItemProps {
  plantilla: PlantillaDefinition
  isActive: boolean
  isCustomized: boolean
  preview: string
  onClick: () => void
}

function SidebarItem({ plantilla, isActive, isCustomized, preview, onClick }: SidebarItemProps) {
  const Icon = CATEGORY_ICONS[plantilla.category]
  const colorClass = CATEGORY_COLORS[plantilla.category]
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left p-3 border-b hover:bg-muted/50 transition-colors flex gap-3 items-start",
        isActive && "bg-primary/10 hover:bg-primary/15 border-l-2 border-l-primary",
      )}
    >
      <div className={cn("rounded-md p-1.5 border shrink-0", colorClass)}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium truncate">{plantilla.label}</span>
          {isCustomized && (
            <span title="Personalizada" className="shrink-0">
              <Sparkles className="h-3 w-3 text-primary" />
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground truncate mt-0.5">{preview}</p>
      </div>
    </button>
  )
}

// =====================================================================
// Main editor
// =====================================================================

export function PlantillasWhatsappEditor() {
  const [plantillas, setPlantillas] = useState<PlantillasMap>({})
  const [originalPlantillas, setOriginalPlantillas] = useState<PlantillasMap>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [activeKey, setActiveKey] = useState<string>(PLANTILLAS_CATALOG[0]?.key ?? "")
  const [categoryFilter, setCategoryFilter] = useState<PlantillaCategory | "all">("all")
  const [search, setSearch] = useState("")
  const [showEditorMobile, setShowEditorMobile] = useState(false)

  const hasChanges = JSON.stringify(plantillas) !== JSON.stringify(originalPlantillas)

  const filtered = useMemo(() => {
    return PLANTILLAS_CATALOG.filter((p) => {
      if (categoryFilter !== "all" && p.category !== categoryFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (
          !p.label.toLowerCase().includes(q) &&
          !p.description.toLowerCase().includes(q) &&
          !p.key.toLowerCase().includes(q)
        ) {
          return false
        }
      }
      return true
    })
  }, [categoryFilter, search])

  const stats = useMemo(() => {
    const customized = PLANTILLAS_CATALOG.filter(
      (p) => (plantillas[p.key] ?? "").trim().length > 0,
    ).length
    return { customized, total: PLANTILLAS_CATALOG.length }
  }, [plantillas])

  const activePlantilla = useMemo(
    () => PLANTILLAS_CATALOG.find((p) => p.key === activeKey),
    [activeKey],
  )

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
    try {
      const res = await fetch("/api/notificaciones/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plantillasWhatsapp: plantillas }),
      })
      if (res.ok) {
        const data = await res.json()
        const saved = (data?.plantillasWhatsapp ?? {}) as PlantillasMap
        setPlantillas(saved)
        setOriginalPlantillas(saved)
        setMessage({ type: "success", text: "Plantillas guardadas correctamente" })
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

  const handleResetAll = () => {
    setPlantillas({})
  }

  if (loading) {
    return (
      <div className="border rounded-lg p-12 text-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
        <p className="text-sm">Cargando plantillas...</p>
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        {/* Toast */}
        {message && (
          <div
            className={cn(
              "px-4 py-3 rounded-lg text-sm flex items-center gap-2",
              message.type === "success"
                ? "bg-green-50 dark:bg-green-950/50 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400"
                : "bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400",
            )}
          >
            {message.type === "success" ? (
              <Check className="h-4 w-4" />
            ) : (
              <X className="h-4 w-4" />
            )}
            {message.text}
          </div>
        )}

        {/* Stats bar */}
        <div className="border rounded-lg p-3 sm:p-4 bg-muted/30 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="bg-green-100 dark:bg-green-950 rounded-full p-2">
              <WhatsAppIcon className="h-4 w-4 text-green-600" />
            </div>
            <div>
              <div className="text-sm font-semibold">
                {stats.customized} de {stats.total} plantillas personalizadas
              </div>
              <p className="text-xs text-muted-foreground">
                Las plantillas sin personalizar usan el texto predeterminado.
              </p>
            </div>
          </div>
          {stats.customized > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleResetAll}
              disabled={saving}
              className="text-xs"
            >
              <RotateCcw className="mr-1.5 h-3 w-3" />
              Restaurar todas
            </Button>
          )}
        </div>

        {/* Master-detail layout */}
        <div className="border rounded-lg overflow-hidden grid lg:grid-cols-[320px_1fr] h-[640px]">
          {/* Sidebar */}
          <div
            className={cn(
              "border-r flex flex-col bg-muted/20",
              showEditorMobile && "hidden lg:flex",
            )}
          >
            {/* Search + filter */}
            <div className="border-b p-3 space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Buscar plantilla..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-9 text-sm"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => setCategoryFilter("all")}
                  className={cn(
                    "px-2 py-1 rounded-md text-[11px] border transition-colors",
                    categoryFilter === "all"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background hover:bg-muted border-border",
                  )}
                >
                  Todas ({PLANTILLAS_CATALOG.length})
                </button>
                {(Object.keys(CATEGORIES) as PlantillaCategory[]).map((cat) => {
                  const Icon = CATEGORY_ICONS[cat]
                  const count = PLANTILLAS_CATALOG.filter((p) => p.category === cat).length
                  if (count === 0) return null
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategoryFilter(cat)}
                      className={cn(
                        "px-2 py-1 rounded-md text-[11px] border transition-colors flex items-center gap-1",
                        categoryFilter === cat
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background hover:bg-muted border-border",
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      {CATEGORIES[cat].label}
                      <span className="opacity-60">({count})</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Plantillas list */}
            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">
                  <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  Sin resultados
                </div>
              ) : (
                filtered.map((p) => {
                  const value = plantillas[p.key] ?? ""
                  const isCustomized = value.trim().length > 0
                  const preview = snippet(value || p.defaultText)
                  return (
                    <SidebarItem
                      key={p.key}
                      plantilla={p}
                      isActive={activeKey === p.key}
                      isCustomized={isCustomized}
                      preview={preview}
                      onClick={() => {
                        setActiveKey(p.key)
                        setShowEditorMobile(true)
                      }}
                    />
                  )
                })
              )}
            </div>
          </div>

          {/* Editor panel */}
          <div
            className={cn(
              "flex flex-col bg-background",
              !showEditorMobile && "hidden lg:flex",
            )}
          >
            {activePlantilla ? (
              <PlantillaEditor
                plantilla={activePlantilla}
                value={plantillas[activePlantilla.key] ?? ""}
                onChange={(next) => handleChange(activePlantilla.key, next)}
                onBack={() => setShowEditorMobile(false)}
                disabled={saving}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground p-6 text-sm text-center">
                <div>
                  <MessageCircle className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p>Seleccioná una plantilla de la lista</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sticky save bar */}
        <div className="sticky bottom-4 z-10">
          <div
            className={cn(
              "border rounded-lg p-3 shadow-lg flex items-center justify-between gap-3",
              hasChanges
                ? "bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-800"
                : "bg-background",
            )}
          >
            <span className="text-xs sm:text-sm">
              {hasChanges ? (
                <span className="text-amber-700 dark:text-amber-400 font-medium">
                  Tenés cambios sin guardar
                </span>
              ) : (
                <span className="text-muted-foreground">Sin cambios pendientes</span>
              )}
            </span>
            <Button onClick={handleSave} disabled={saving || !hasChanges} size="sm">
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {saving ? "Guardando..." : "Guardar cambios"}
            </Button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
