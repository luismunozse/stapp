"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Mail,
  Eye,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Pencil,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react"
import { useSuperadminFetch, useSuperadminMutation } from "@/hooks/use-superadmin-fetch"
import { cn } from "@/lib/utils"
import { TemplateEditorDialog } from "./template-editor-dialog"

export interface TemplateRow {
  id: string
  type: string
  category: "onboarding" | "conversion" | "retention" | "engagement" | "reactivation" | string
  label: string
  description: string
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED" | string
  hasBody: boolean
  hasHardcodedFallback: boolean
  updatedAt: string
  notes: string
}

const CATEGORY_LABEL: Record<string, string> = {
  onboarding: "Onboarding",
  conversion: "Conversión",
  retention: "Retención",
  engagement: "Engagement",
  reactivation: "Reactivación",
}

const CATEGORY_FILTER_ORDER: { key: string; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "onboarding", label: "Onboarding" },
  { key: "conversion", label: "Conversión" },
  { key: "retention", label: "Retención" },
  { key: "engagement", label: "Engagement" },
  { key: "reactivation", label: "Reactivación" },
]

function StatusBadge({ status }: { status: string }) {
  if (status === "PUBLISHED") {
    return (
      <Badge className="bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200 border-green-200">
        <ShieldCheck className="h-3 w-3 mr-1" />
        Publicado
      </Badge>
    )
  }
  if (status === "ARCHIVED") {
    return (
      <Badge className="bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200">
        Archivado
      </Badge>
    )
  }
  // DRAFT
  return (
    <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200 border-yellow-200">
      <ShieldAlert className="h-3 w-3 mr-1" />
      Borrador
    </Badge>
  )
}

export function LifecycleEmailsContent() {
  const { data, loading, fetchData } = useSuperadminFetch<{ templates: TemplateRow[] }>({ showErrorToast: true })
  const { mutate: previewMutate } = useSuperadminMutation<{ subject: string; html: string; type: string; source: string }>()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<string>("all")
  const [previewState, setPreviewState] = useState<{ type: string; subject: string; html: string; source: string } | null>(null)
  const [previewing, setPreviewing] = useState<string | null>(null)

  const loadTemplates = useCallback(async () => {
    await fetchData("/api/superadmin/lifecycle-preview")
  }, [fetchData])

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  const templates = data?.templates || []

  const filtered = useMemo(() => {
    if (categoryFilter === "all") return templates
    return templates.filter((t) => t.category === categoryFilter)
  }, [templates, categoryFilter])

  const counts = useMemo(() => {
    return {
      total: templates.length,
      drafts: templates.filter((t) => t.status === "DRAFT").length,
      published: templates.filter((t) => t.status === "PUBLISHED").length,
      noBody: templates.filter((t) => !t.hasBody).length,
    }
  }, [templates])

  const handlePreview = async (type: string) => {
    setPreviewing(type)
    const result = await previewMutate("/api/superadmin/lifecycle-preview", {
      method: "POST",
      body: { type },
    })
    setPreviewing(null)
    if (result) setPreviewState({ type, subject: result.subject, html: result.html, source: result.source })
  }

  const handleEdit = (id: string) => setEditingId(id)
  const handleEditorClose = (didChange: boolean) => {
    setEditingId(null)
    if (didChange) loadTemplates()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Plantillas de Email</h1>
          <p className="text-muted-foreground">
            Editá y publicá los emails antes de que el sistema los envíe automáticamente.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadTemplates} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Actualizar
        </Button>
      </div>

      {/* Kill switch info */}
      <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-semibold mb-1">Kill switch activo</p>
              <p className="text-muted-foreground">
                Los emails sólo se envían si el template está <strong>PUBLICADO</strong>. Los que estén en{" "}
                <strong>BORRADOR</strong> se loguean como <code>SKIPPED_DRAFT</code> en{" "}
                <code>lifecycle_emails</code> y no se mandan. Editá, revisá y publicá cada plantilla cuando estés conforme.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-2xl font-bold">{counts.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Publicados</p>
            <p className="text-2xl font-bold text-green-600">{counts.published}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">En borrador</p>
            <p className="text-2xl font-bold text-yellow-600">{counts.drafts}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Sin cuerpo custom</p>
            <p className="text-2xl font-bold text-muted-foreground">{counts.noBody}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-2">
        {CATEGORY_FILTER_ORDER.map((c) => (
          <button
            key={c.key}
            onClick={() => setCategoryFilter(c.key)}
            className={cn(
              "px-3 py-1 rounded-full text-sm border transition-colors",
              categoryFilter === c.key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground hover:bg-muted"
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Lista */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Plantillas
            </CardTitle>
            <CardDescription>Click en "Editar" para abrir el editor o "Preview" para ver el render.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {loading && templates.length === 0 ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
                ))
              ) : (
                filtered.map((t) => (
                  <div
                    key={t.id}
                    className={cn(
                      "p-3 border rounded-lg transition-colors",
                      previewState?.type === t.type && "ring-2 ring-primary bg-muted/30"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-sm">{t.label}</p>
                          <StatusBadge status={t.status} />
                          <Badge variant="outline" className="text-[10px]">
                            {CATEGORY_LABEL[t.category] || t.category}
                          </Badge>
                          {!t.hasBody && (
                            <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700">
                              Sin cuerpo custom
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{t.description}</p>
                        <p className="text-[10px] text-muted-foreground/70 mt-1 font-mono">{t.type}</p>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={previewing === t.type}
                          onClick={() => handlePreview(t.type)}
                        >
                          {previewing === t.type ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Eye className="h-4 w-4 sm:mr-1" />
                          )}
                          <span className="hidden sm:inline">Preview</span>
                        </Button>
                        <Button variant="default" size="sm" onClick={() => handleEdit(t.id)}>
                          <Pencil className="h-4 w-4 sm:mr-1" />
                          <span className="hidden sm:inline">Editar</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
              {!loading && filtered.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No hay plantillas en esta categoría.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Preview lateral */}
        <div className="space-y-3">
          {previewState ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Preview: {previewState.subject}</CardTitle>
                <CardDescription className="text-xs">
                  Fuente: <code>{previewState.source}</code>. Datos de ejemplo.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <iframe
                  srcDoc={previewState.html}
                  className="w-full h-[700px] border-0 border-t bg-white"
                  title="Email preview"
                  sandbox="allow-same-origin"
                />
              </CardContent>
            </Card>
          ) : (
            <Card className="h-full min-h-[400px] flex items-center justify-center">
              <CardContent className="text-center py-16">
                <Mail className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
                <p className="text-muted-foreground">Seleccioná una plantilla para previsualizar</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {editingId && (
        <TemplateEditorDialog id={editingId} onClose={handleEditorClose} />
      )}
    </div>
  )
}
