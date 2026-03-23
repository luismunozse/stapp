"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import {
  Plus,
  Monitor,
  Trash2,
  Copy,
  ExternalLink,
  Loader2,
  CheckCircle2,
  Settings,
  ChevronDown,
  ChevronUp,
  Save,
} from "lucide-react"
import { useModal } from "@/contexts/modal-context"

const ESTADOS_DISPONIBLES = [
  { value: "RECIBIDO", label: "Recibido" },
  { value: "EN_DIAGNOSTICO", label: "En Diagnóstico" },
  { value: "PRESUPUESTADO", label: "Presupuestado" },
  { value: "APROBADO", label: "Aprobado" },
  { value: "EN_REPARACION", label: "En Reparación" },
  { value: "ESPERANDO_REPUESTO", label: "Esperando Repuesto" },
  { value: "REPARADO", label: "Listo para Retirar" },
]

interface KioskConfig {
  filter_estados: string[]
  auto_refresh_seconds: number
  font_size: "small" | "large"
  show_branding: boolean
  show_cliente: boolean
  show_dispositivo: boolean
  show_marca: boolean
  display_mode: "grid" | "grouped"
  auto_paginate_seconds: number
}

interface KioskToken {
  id: string
  token: string
  name: string
  config: KioskConfig
  activo: boolean
  created_at: string
}

const DEFAULT_CONFIG: KioskConfig = {
  filter_estados: [],
  auto_refresh_seconds: 30,
  font_size: "large",
  show_branding: true,
  show_cliente: true,
  show_dispositivo: true,
  show_marca: false,
  display_mode: "grid",
  auto_paginate_seconds: 0,
}

function parseConfig(raw: Record<string, unknown>): KioskConfig {
  return {
    filter_estados: (raw.filter_estados as string[]) || [],
    auto_refresh_seconds: (raw.auto_refresh_seconds as number) || 30,
    font_size: (raw.font_size as "small" | "large") || "large",
    show_branding: raw.show_branding !== false,
    show_cliente: raw.show_cliente !== false,
    show_dispositivo: raw.show_dispositivo !== false,
    show_marca: raw.show_marca === true,
    display_mode: (raw.display_mode as "grid" | "grouped") || "grid",
    auto_paginate_seconds: (raw.auto_paginate_seconds as number) || 0,
  }
}

export function KioskConfigView() {
  const [tokens, setTokens] = useState<KioskToken[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [copied, setCopied] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editConfigs, setEditConfigs] = useState<Record<string, KioskConfig>>({})
  const [editNames, setEditNames] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const { confirm, showError } = useModal()

  const fetchTokens = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/kiosco")
      if (res.ok) {
        const data = await res.json()
        setTokens(data)
      }
    } catch (err) {
      console.error("Error fetching tokens:", err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTokens()
  }, [])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const res = await fetch("/api/kiosco", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, config: DEFAULT_CONFIG }),
      })

      if (!res.ok) {
        const data = await res.json()
        if (data.code === "PREMIUM_REQUIRED") {
          await showError("Esta función requiere el plan Premium.")
        } else {
          await showError(data.error || "Error al crear kiosco")
        }
        return
      }

      setNewName("")
      fetchTokens()
    } catch (err) {
      console.error("Error creating token:", err)
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string, name: string) => {
    const confirmed = await confirm({
      title: "Eliminar pantalla",
      description: `¿Eliminar la pantalla "${name}"? El link dejará de funcionar.`,
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      variant: "danger",
    })

    if (!confirmed) return

    try {
      await fetch(`/api/kiosco/${id}`, { method: "DELETE" })
      if (expandedId === id) setExpandedId(null)
      fetchTokens()
    } catch (err) {
      console.error("Error deleting token:", err)
    }
  }

  const handleToggleActivo = async (t: KioskToken) => {
    try {
      const res = await fetch(`/api/kiosco/${t.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: !t.activo }),
      })
      if (res.ok) fetchTokens()
    } catch (err) {
      console.error("Error toggling kiosk:", err)
    }
  }

  const toggleExpand = (t: KioskToken) => {
    if (expandedId === t.id) {
      setExpandedId(null)
    } else {
      setExpandedId(t.id)
      setEditConfigs((prev) => ({ ...prev, [t.id]: parseConfig(t.config as unknown as Record<string, unknown>) }))
      setEditNames((prev) => ({ ...prev, [t.id]: t.name }))
    }
  }

  const updateEditConfig = (id: string, partial: Partial<KioskConfig>) => {
    setEditConfigs((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || DEFAULT_CONFIG), ...partial },
    }))
  }

  const toggleEstadoFilter = (id: string, estado: string) => {
    const current = editConfigs[id]?.filter_estados || []
    const next = current.includes(estado)
      ? current.filter((e) => e !== estado)
      : [...current, estado]
    updateEditConfig(id, { filter_estados: next })
  }

  const handleSave = async (id: string) => {
    setSaving(id)
    try {
      const res = await fetch(`/api/kiosco/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editNames[id],
          config: editConfigs[id],
        }),
      })
      if (res.ok) {
        fetchTokens()
        setExpandedId(null)
      } else {
        const data = await res.json()
        await showError(data.error || "Error al guardar")
      }
    } catch (err) {
      console.error("Error saving config:", err)
    } finally {
      setSaving(null)
    }
  }

  const getKioskUrl = (token: string) => {
    if (typeof window === "undefined") return ""
    const host = window.location.host
    const protocol = window.location.protocol
    return `${protocol}//${host}/kiosco/${token}`
  }

  const copyUrl = (token: string) => {
    navigator.clipboard.writeText(getKioskUrl(token))
    setCopied(token)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="space-y-6">
      {/* Create new */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Monitor className="h-5 w-5" />
            Nueva pantalla
          </CardTitle>
          <CardDescription>
            Creá un link para mostrar el estado de las órdenes en una TV o monitor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <div className="flex-1">
              <Label className="sr-only">Nombre de la pantalla</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ej: Pantalla del local"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
            <Button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
            >
              {creating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Crear
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Token list */}
      {loading ? (
        <div className="text-center py-8 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
          Cargando...
        </div>
      ) : tokens.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Monitor className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No tenés pantallas configuradas</p>
            <p className="text-sm">Creá una para empezar a mostrar el estado en tu local.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {tokens.map((t) => {
            const isExpanded = expandedId === t.id
            const config = editConfigs[t.id] || parseConfig(t.config as unknown as Record<string, unknown>)

            return (
              <Card key={t.id} className={!t.activo ? "opacity-60" : ""}>
                <CardContent className="py-4">
                  {/* Header row */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <Switch
                        checked={t.activo}
                        onCheckedChange={() => handleToggleActivo(t)}
                        aria-label={t.activo ? "Desactivar" : "Activar"}
                      />
                      <div className="min-w-0">
                        <p className="font-medium">{t.name}</p>
                        <p className="text-sm text-muted-foreground mt-0.5 font-mono break-all">
                          {getKioskUrl(t.token)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyUrl(t.token)}
                        title="Copiar link"
                      >
                        {copied === t.token ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(getKioskUrl(t.token), "_blank")}
                        title="Abrir en nueva pestaña"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleExpand(t)}
                        title="Configurar"
                      >
                        <Settings className="h-4 w-4" />
                        {isExpanded ? (
                          <ChevronUp className="h-3 w-3 ml-1" />
                        ) : (
                          <ChevronDown className="h-3 w-3 ml-1" />
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(t.id, t.name)}
                        title="Eliminar"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>

                  {/* Config panel */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t space-y-5">
                      {/* Nombre */}
                      <div className="space-y-1.5">
                        <Label>Nombre de la pantalla</Label>
                        <Input
                          value={editNames[t.id] ?? t.name}
                          onChange={(e) => setEditNames((prev) => ({ ...prev, [t.id]: e.target.value }))}
                        />
                      </div>

                      {/* Filtrar por estados */}
                      <div className="space-y-1.5">
                        <Label>Filtrar por estados</Label>
                        <p className="text-xs text-muted-foreground">
                          Si no seleccionás ninguno, se muestran todos los estados activos.
                        </p>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {ESTADOS_DISPONIBLES.map((est) => {
                            const selected = config.filter_estados.includes(est.value)
                            return (
                              <Badge
                                key={est.value}
                                variant={selected ? "default" : "outline"}
                                className="cursor-pointer select-none"
                                onClick={() => toggleEstadoFilter(t.id, est.value)}
                              >
                                {est.label}
                              </Badge>
                            )
                          })}
                        </div>
                      </div>

                      {/* Refresh interval */}
                      <div className="space-y-1.5">
                        <Label>Intervalo de actualización</Label>
                        <Select
                          value={String(config.auto_refresh_seconds)}
                          onValueChange={(v) => updateEditConfig(t.id, { auto_refresh_seconds: Number(v) })}
                        >
                          <SelectTrigger className="w-48">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="15">15 segundos</SelectItem>
                            <SelectItem value="30">30 segundos</SelectItem>
                            <SelectItem value="60">1 minuto</SelectItem>
                            <SelectItem value="120">2 minutos</SelectItem>
                            <SelectItem value="300">5 minutos</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Font size */}
                      <div className="space-y-1.5">
                        <Label>Tamaño de fuente</Label>
                        <Select
                          value={config.font_size}
                          onValueChange={(v) => updateEditConfig(t.id, { font_size: v as "small" | "large" })}
                        >
                          <SelectTrigger className="w-48">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="small">Pequeño</SelectItem>
                            <SelectItem value="large">Grande</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Display mode */}
                      <div className="space-y-1.5">
                        <Label>Modo de visualización</Label>
                        <Select
                          value={config.display_mode}
                          onValueChange={(v) => updateEditConfig(t.id, { display_mode: v as "grid" | "grouped" })}
                        >
                          <SelectTrigger className="w-48">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="grid">Grilla</SelectItem>
                            <SelectItem value="grouped">Agrupado por estado</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          {config.display_mode === "grouped"
                            ? "Las órdenes se agrupan por estado en secciones."
                            : "Las órdenes se muestran en una grilla con paginación automática."}
                        </p>
                      </div>

                      {/* Auto paginate (only for grid mode) */}
                      {config.display_mode !== "grouped" && (
                        <div className="space-y-1.5">
                          <Label>Paginación automática</Label>
                          <Select
                            value={String(config.auto_paginate_seconds)}
                            onValueChange={(v) => updateEditConfig(t.id, { auto_paginate_seconds: Number(v) })}
                          >
                            <SelectTrigger className="w-48">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">Desactivada</SelectItem>
                              <SelectItem value="5">Cada 5 segundos</SelectItem>
                              <SelectItem value="10">Cada 10 segundos</SelectItem>
                              <SelectItem value="15">Cada 15 segundos</SelectItem>
                              <SelectItem value="30">Cada 30 segundos</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            Cuando hay muchas órdenes, rota entre páginas automáticamente.
                          </p>
                        </div>
                      )}

                      {/* Toggles */}
                      <div className="space-y-3">
                        <Label>Información visible</Label>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm">Mostrar nombre del cliente</span>
                            <Switch
                              checked={config.show_cliente}
                              onCheckedChange={(v) => updateEditConfig(t.id, { show_cliente: v })}
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm">Mostrar dispositivo</span>
                            <Switch
                              checked={config.show_dispositivo}
                              onCheckedChange={(v) => updateEditConfig(t.id, { show_dispositivo: v })}
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm">Mostrar marca</span>
                            <Switch
                              checked={config.show_marca}
                              onCheckedChange={(v) => updateEditConfig(t.id, { show_marca: v })}
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm">Mostrar branding (logo y nombre)</span>
                            <Switch
                              checked={config.show_branding}
                              onCheckedChange={(v) => updateEditConfig(t.id, { show_branding: v })}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Save button */}
                      <div className="flex justify-end pt-2">
                        <Button onClick={() => handleSave(t.id)} disabled={saving === t.id}>
                          {saving === t.id ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="mr-2 h-4 w-4" />
                          )}
                          Guardar cambios
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
