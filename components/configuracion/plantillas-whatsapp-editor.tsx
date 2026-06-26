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
  Undo2,
  Loader2,
  Search,
  X,
  Check,
  ChevronLeft,
  ChevronDown,
  Sparkles,
  ClipboardList,
  ShoppingCart,
  Calendar,
  Wallet,
  Wrench,
  Megaphone,
  MessageCircle,
  AlertTriangle,
  Copy,
} from "lucide-react"
import {
  PLANTILLAS_CATALOG,
  CATEGORIES,
  renderTemplate,
  type PlantillaCategory,
  type PlantillaDefinition,
  type PlantillaVariable,
} from "@/lib/whatsapp/plantillas-catalog"
import { StatusBanner } from "@/components/ui/status-banner"
import { cn } from "@/lib/utils"
import { useCurrency } from "@/contexts/currency-context"

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

function buildPreviewContext(
  variables: PlantillaVariable[],
  overrides?: Record<string, string>,
): Record<string, string> {
  const ctx: Record<string, string> = {}
  for (const v of variables) {
    const override = overrides?.[v.key]
    ctx[v.key] = (override && override.trim().length > 0) ? override : (v.example ?? `[${v.label}]`)
  }
  return ctx
}

function snippet(text: string, maxLen = 80): string {
  const single = text.replace(/\s+/g, " ").trim()
  if (single.length <= maxLen) return single
  return single.slice(0, maxLen).trimEnd() + "…"
}

function extractVariables(text: string): string[] {
  const set = new Set<string>()
  const regex = /\{(\w+)\}/g
  let m: RegExpExecArray | null
  while ((m = regex.exec(text)) !== null) set.add(m[1])
  return Array.from(set)
}

// =====================================================================
// WhatsApp-style preview bubble
// =====================================================================

function WhatsAppPreview({ text, timezone }: { text: string; timezone: string }) {
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
  const time = new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: timezone })

  return (
    <div className="rounded-lg p-3 bg-[#e5ddd5] dark:bg-[#0b141a]">
      <div className="text-[10px] text-center text-muted-foreground mb-2 font-medium">
        Vista previa en WhatsApp
      </div>
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-[#dcf8c6] dark:bg-[#005c4b] px-2.5 py-1.5 text-sm relative shadow-sm">
          <div className="whitespace-pre-wrap break-words text-gray-900 dark:text-gray-100 leading-snug">
            {lines.map((line, i) => (
              <div key={i}>{renderMarkdown(line) || " "}</div>
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
// Variable chip with flash-on-insert feedback
// =====================================================================

function VariableChip({
  variable,
  onClick,
  disabled,
  recentlyInserted,
}: {
  variable: PlantillaVariable
  onClick: () => void
  disabled?: boolean
  recentlyInserted?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className={cn(
            "px-2 py-1 rounded-md text-[11px] font-mono transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1 border",
            recentlyInserted
              ? "bg-primary text-primary-foreground border-primary scale-105"
              : "bg-muted hover:bg-primary/10 hover:text-primary border-transparent hover:border-primary/30",
          )}
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
  savedValue: string
  onChange: (next: string) => void
  onBack?: () => void
  disabled: boolean
  organizationName?: string
  timezone: string
}

function PlantillaEditor({
  plantilla,
  value,
  savedValue,
  onChange,
  onBack,
  disabled,
  organizationName,
  timezone,
}: PlantillaEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [lastInserted, setLastInserted] = useState<string | null>(null)

  const effectiveText = value || plantilla.defaultText
  const previewCtx = buildPreviewContext(
    plantilla.variables,
    organizationName ? { empresa: organizationName } : undefined,
  )
  const previewText = renderTemplate(effectiveText, previewCtx)
  const isCustomized = value.trim().length > 0 && value !== plantilla.defaultText
  const isDirty = value !== savedValue
  const Icon = CATEGORY_ICONS[plantilla.category]
  const colorClass = CATEGORY_COLORS[plantilla.category]

  // Detect unknown variables
  const allowedKeys = new Set(plantilla.variables.map((v) => v.key))
  const usedVars = extractVariables(effectiveText)
  const unknownVars = usedVars.filter((v) => !allowedKeys.has(v))

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
    setLastInserted(varKey)
    setTimeout(() => setLastInserted((cur) => (cur === varKey ? null : cur)), 600)
    requestAnimationFrame(() => {
      el.focus()
      const newPos = start + varKey.length + 2
      el.setSelectionRange(newPos, newPos)
    })
  }

  const handleCopyDefault = async () => {
    try {
      await navigator.clipboard.writeText(plantilla.defaultText)
    } catch {}
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
            {isCustomized && !isDirty && (
              <Badge variant="secondary" className="text-[10px] font-normal h-5">
                <Sparkles className="h-2.5 w-2.5 mr-1" />
                Personalizada
              </Badge>
            )}
            {isDirty && (
              <Badge className="text-[10px] font-normal h-5 bg-warning hover:bg-warning text-white">
                Sin guardar
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
            <span className="text-[10px] text-muted-foreground">Click para insertar en el cursor</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {plantilla.variables.map((v) => (
              <VariableChip
                key={v.key}
                variable={v}
                onClick={() => handleInsertVar(v.key)}
                disabled={disabled}
                recentlyInserted={lastInserted === v.key}
              />
            ))}
          </div>
          {plantilla.variables.some((v) => v.label.includes("(auto)")) && (
            <p className="text-[10px] text-muted-foreground mt-1.5 italic">
              Variables con <span className="font-mono">(auto)</span> ya incluyen el salto de
              línea y el texto fijo (p. ej. "Presupuesto estimado: $45.000"). Si el dato no
              existe, no aparece nada. No las borres si querés que ese dato se muestre.
            </p>
          )}
        </div>

        {/* Unknown variables warning */}
        {unknownVars.length > 0 && (
          <StatusBanner tone="warning" icon={AlertTriangle}>
            <span className="font-medium">Variables desconocidas:</span>{" "}
            Estas variables no se reemplazarán y aparecerán vacías:{" "}
            {unknownVars.map((v, i) => (
              <span key={v}>
                <code className="font-mono bg-warning-100/60 px-1 rounded">{`{${v}}`}</code>
                {i < unknownVars.length - 1 ? ", " : ""}
              </span>
            ))}
          </StatusBanner>
        )}

        {/* Editor + Preview side-by-side on desktop */}
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Mensaje
              </label>
              <span className="text-[10px] text-muted-foreground tabular-nums">
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
            <div className="flex justify-between items-center gap-2 flex-wrap">
              <div className="flex gap-1">
                {isDirty && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    onClick={() => onChange(savedValue)}
                    className="h-7 text-xs"
                  >
                    <Undo2 className="mr-1.5 h-3 w-3" />
                    Descartar cambios
                  </Button>
                )}
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
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={handleCopyDefault}
                  className="h-7 text-xs"
                  title="Copiar texto predeterminado al portapapeles"
                >
                  <Copy className="mr-1.5 h-3 w-3" />
                  Copiar default
                </Button>
              </div>
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
            <WhatsAppPreview text={previewText} timezone={timezone} />
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
// Sidebar list item
// =====================================================================

interface SidebarItemProps {
  plantilla: PlantillaDefinition
  isActive: boolean
  isCustomized: boolean
  isDirty: boolean
  preview: string
  onClick: () => void
}

function SidebarItem({
  plantilla,
  isActive,
  isCustomized,
  isDirty,
  preview,
  onClick,
}: SidebarItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left p-2.5 hover:bg-muted/50 transition-colors flex gap-2 items-start border-l-2",
        isActive ? "bg-primary/10 hover:bg-primary/15 border-l-primary" : "border-l-transparent",
      )}
    >
      <div className="flex flex-col items-center gap-1 pt-1 shrink-0">
        {isDirty ? (
          <span title="Cambios sin guardar" className="h-2 w-2 rounded-full bg-amber-500" />
        ) : isCustomized ? (
          <Sparkles className="h-3 w-3 text-primary" />
        ) : (
          <span className="h-2 w-2 rounded-full bg-transparent" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{plantilla.label}</div>
        <p className="text-[11px] text-muted-foreground truncate mt-0.5">{preview}</p>
      </div>
    </button>
  )
}

// =====================================================================
// Main editor
// =====================================================================

export function PlantillasWhatsappEditor() {
  const { timezone } = useCurrency()
  const [plantillas, setPlantillas] = useState<PlantillasMap>({})
  const [originalPlantillas, setOriginalPlantillas] = useState<PlantillasMap>({})
  const [organizationName, setOrganizationName] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [activeKey, setActiveKey] = useState<string>(PLANTILLAS_CATALOG[0]?.key ?? "")
  const [categoryFilter, setCategoryFilter] = useState<PlantillaCategory | "all">("all")
  const [search, setSearch] = useState("")
  const [showEditorMobile, setShowEditorMobile] = useState(false)
  const [collapsedCategories, setCollapsedCategories] = useState<Set<PlantillaCategory>>(new Set())

  const hasChanges = useMemo(
    () => JSON.stringify(plantillas) !== JSON.stringify(originalPlantillas),
    [plantillas, originalPlantillas],
  )

  const dirtyCount = useMemo(() => {
    let n = 0
    const keys = new Set([...Object.keys(plantillas), ...Object.keys(originalPlantillas)])
    for (const k of keys) {
      if ((plantillas[k] ?? "") !== (originalPlantillas[k] ?? "")) n++
    }
    return n
  }, [plantillas, originalPlantillas])

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

  // Group filtered list by category
  const filteredByCategory = useMemo(() => {
    const map: Record<string, PlantillaDefinition[]> = {}
    for (const p of filtered) {
      if (!map[p.category]) map[p.category] = []
      map[p.category].push(p)
    }
    return map
  }, [filtered])

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

  // Initial fetch
  useEffect(() => {
    let cancelled = false
    fetch("/api/notificaciones/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return
        const initial = (data?.plantillasWhatsapp ?? {}) as PlantillasMap
        setPlantillas(initial)
        setOriginalPlantillas(initial)
        if (typeof data?.organizationName === "string") {
          setOrganizationName(data.organizationName)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Warn on navigation if unsaved changes
  useEffect(() => {
    if (!hasChanges) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [hasChanges])

  // Auto-select first filtered if active not in filtered list
  useEffect(() => {
    if (filtered.length === 0) return
    if (!filtered.some((p) => p.key === activeKey)) {
      setActiveKey(filtered[0].key)
    }
  }, [filtered, activeKey])

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

  // Ctrl+S / Cmd+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault()
        if (hasChanges && !saving) handleSave()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasChanges, saving, plantillas])

  const handleResetAll = () => {
    if (!confirm("¿Restaurar TODAS las plantillas a sus valores predeterminados? Esta acción puede deshacerse con 'Descartar cambios'.")) return
    setPlantillas({})
  }

  const handleDiscardAll = () => {
    setPlantillas(originalPlantillas)
  }

  const toggleCategory = (cat: PlantillaCategory) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
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
              "px-4 py-3 rounded-lg text-sm flex items-center gap-2 ease-snappy animate-in slide-in-from-top-2",
              message.type === "success"
                ? "bg-success-50 dark:bg-success/15 border border-success-200 dark:border-success/30 text-success-600 dark:text-success-500"
                : "bg-destructive/10 dark:bg-destructive/15 border border-destructive/30 text-destructive",
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
            <div className="bg-success-100 dark:bg-success/15 rounded-full p-2">
              <WhatsAppIcon className="h-4 w-4 text-success-600" />
            </div>
            <div>
              <div className="text-sm font-semibold">
                {stats.customized} de {stats.total} plantillas personalizadas
              </div>
              <p className="text-xs text-muted-foreground">
                Sin personalizar usan el texto predeterminado. Atajo:{" "}
                <kbd className="px-1 py-0.5 rounded bg-muted border text-[10px] font-mono">Ctrl</kbd>{" "}
                +{" "}
                <kbd className="px-1 py-0.5 rounded bg-muted border text-[10px] font-mono">S</kbd>{" "}
                para guardar.
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

            {/* Plantillas list grouped by category */}
            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">
                  <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  Sin resultados
                </div>
              ) : (
                (Object.keys(CATEGORIES) as PlantillaCategory[]).map((cat) => {
                  const items = filteredByCategory[cat]
                  if (!items || items.length === 0) return null
                  const Icon = CATEGORY_ICONS[cat]
                  const colorClass = CATEGORY_COLORS[cat]
                  const isCollapsed = collapsedCategories.has(cat)
                  const dirtyInCat = items.filter(
                    (p) => (plantillas[p.key] ?? "") !== (originalPlantillas[p.key] ?? ""),
                  ).length
                  return (
                    <div key={cat}>
                      <button
                        type="button"
                        onClick={() => toggleCategory(cat)}
                        className="w-full px-3 py-2 bg-muted/40 hover:bg-muted/70 border-b text-left flex items-center gap-2 sticky top-0 z-10 backdrop-blur"
                      >
                        <div className={cn("rounded p-1 border", colorClass)}>
                          <Icon className="h-3 w-3" />
                        </div>
                        <span className="text-[11px] font-semibold uppercase tracking-wide flex-1">
                          {CATEGORIES[cat].label}
                        </span>
                        {dirtyInCat > 0 && (
                          <span className="text-[10px] bg-warning text-white px-1.5 py-0.5 rounded-full font-medium">
                            {dirtyInCat}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground">{items.length}</span>
                        <ChevronDown
                          className={cn(
                            "h-3 w-3 transition-transform",
                            isCollapsed && "-rotate-90",
                          )}
                        />
                      </button>
                      {!isCollapsed && items.map((p) => {
                        const value = plantillas[p.key] ?? ""
                        const savedVal = originalPlantillas[p.key] ?? ""
                        const isCustomized = value.trim().length > 0
                        const isDirty = value !== savedVal
                        const preview = snippet(value || p.defaultText)
                        return (
                          <SidebarItem
                            key={p.key}
                            plantilla={p}
                            isActive={activeKey === p.key}
                            isCustomized={isCustomized}
                            isDirty={isDirty}
                            preview={preview}
                            onClick={() => {
                              setActiveKey(p.key)
                              setShowEditorMobile(true)
                            }}
                          />
                        )
                      })}
                    </div>
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
                savedValue={originalPlantillas[activePlantilla.key] ?? ""}
                onChange={(next) => handleChange(activePlantilla.key, next)}
                onBack={() => setShowEditorMobile(false)}
                disabled={saving}
                organizationName={organizationName}
                timezone={timezone}
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
                ? "bg-warning-50 dark:bg-warning/10 border-warning-200 dark:border-warning/30"
                : "bg-background",
            )}
          >
            <span className="text-xs sm:text-sm">
              {hasChanges ? (
                <span className="text-warning-700 dark:text-warning-600 font-medium">
                  {dirtyCount} {dirtyCount === 1 ? "cambio" : "cambios"} sin guardar
                </span>
              ) : (
                <span className="text-muted-foreground">Sin cambios pendientes</span>
              )}
            </span>
            <div className="flex gap-2">
              {hasChanges && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDiscardAll}
                  disabled={saving}
                >
                  <Undo2 className="mr-2 h-4 w-4" />
                  Descartar
                </Button>
              )}
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
      </div>
    </TooltipProvider>
  )
}
