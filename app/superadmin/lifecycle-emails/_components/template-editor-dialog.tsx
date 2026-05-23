"use client"

import { useEffect, useState, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Loader2,
  Save,
  Send,
  AlertTriangle,
  Copy,
  Monitor,
  Smartphone,
  ShieldCheck,
  Mail,
  RefreshCw,
} from "lucide-react"
import { useSuperadminMutation } from "@/hooks/use-superadmin-fetch"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface Template {
  id: string
  type: string
  category: string
  label: string
  description: string | null
  subject: string
  html_body: string
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED"
  notes: string | null
  variables: string[]
  updated_at: string
  updated_by: string | null
}

interface Props {
  id: string
  onClose: (didChange: boolean) => void
}

const SUGGESTED_VARIABLES = [
  "nombre",
  "organizacion",
  "slug",
  "appUrl",
  "reactivarUrl",
  "billingUrl",
  "diasRestantes",
  "accountAgeDays",
  "milestone.tipo",
  "milestone.valor",
]

export function TemplateEditorDialog({ id, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [template, setTemplate] = useState<Template | null>(null)
  const [subject, setSubject] = useState("")
  const [htmlBody, setHtmlBody] = useState("")
  const [notes, setNotes] = useState("")
  const [tab, setTab] = useState<"editor" | "preview">("editor")
  const [viewMode, setViewMode] = useState<"desktop" | "mobile">("desktop")
  const [previewHtml, setPreviewHtml] = useState<string>("")
  const [previewSubject, setPreviewSubject] = useState<string>("")
  const [previewSource, setPreviewSource] = useState<string>("")
  const [previewLoading, setPreviewLoading] = useState(false)
  const [testEmail, setTestEmail] = useState("")
  const [didChange, setDidChange] = useState(false)

  const { mutate } = useSuperadminMutation<{ template: Template }>()
  const { mutate: previewMutate } = useSuperadminMutation<{ subject: string; html: string; source: string }>()
  const { mutate: testSendMutate } = useSuperadminMutation<{ success: boolean }>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/superadmin/email-templates/${id}`)
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || "Error cargando template")
        onClose(false)
        return
      }
      const t = data.template as Template
      setTemplate(t)
      setSubject(t.subject || "")
      setHtmlBody(t.html_body || "")
      setNotes(t.notes || "")
    } catch (e) {
      toast.error("Error cargando template")
      onClose(false)
    } finally {
      setLoading(false)
    }
  }, [id, onClose])

  useEffect(() => {
    load()
  }, [load])

  const refreshPreview = useCallback(async () => {
    setPreviewLoading(true)
    const result = await previewMutate(`/api/superadmin/email-templates/${id}/preview`, {
      method: "POST",
      body: { subject, html_body: htmlBody },
    })
    setPreviewLoading(false)
    if (result) {
      setPreviewHtml(result.html)
      setPreviewSubject(result.subject)
      setPreviewSource(result.source)
    }
  }, [id, subject, htmlBody, previewMutate])

  useEffect(() => {
    if (tab === "preview") {
      refreshPreview()
    }
  }, [tab, refreshPreview])

  const handleSaveDraft = async () => {
    if (!template) return
    setSaving(true)
    const result = await mutate(`/api/superadmin/email-templates/${id}`, {
      method: "PATCH",
      body: { subject, html_body: htmlBody, notes },
      successMessage: "Borrador guardado",
    })
    setSaving(false)
    if (result) {
      setTemplate(result.template)
      setDidChange(true)
    }
  }

  const handlePublish = async () => {
    if (!template) return
    if (!htmlBody.trim()) {
      toast.error("No podés publicar sin contenido HTML")
      return
    }
    if (!subject.trim()) {
      toast.error("No podés publicar sin subject")
      return
    }
    setPublishing(true)
    const result = await mutate(`/api/superadmin/email-templates/${id}`, {
      method: "PATCH",
      body: { subject, html_body: htmlBody, notes, status: "PUBLISHED" },
      successMessage: "Template publicado. El cron ya lo puede enviar.",
    })
    setPublishing(false)
    if (result) {
      setTemplate(result.template)
      setDidChange(true)
    }
  }

  const handleUnpublish = async () => {
    if (!template) return
    setPublishing(true)
    const result = await mutate(`/api/superadmin/email-templates/${id}`, {
      method: "PATCH",
      body: { status: "DRAFT" },
      successMessage: "Template pasado a borrador. El cron dejó de enviarlo.",
    })
    setPublishing(false)
    if (result) {
      setTemplate(result.template)
      setDidChange(true)
    }
  }

  const handleTestSend = async () => {
    if (!testEmail.trim()) {
      toast.error("Ingresá un email destino")
      return
    }
    const result = await testSendMutate(`/api/superadmin/email-templates/${id}/test-send`, {
      method: "POST",
      body: { to: testEmail.trim() },
      successMessage: `Email de prueba enviado a ${testEmail}`,
    })
    if (result?.success) setTestEmail("")
  }

  const copyVar = (v: string) => {
    const txt = `{{${v}}}`
    navigator.clipboard.writeText(txt)
    toast.success(`${txt} copiado`)
  }

  const status = template?.status || "DRAFT"
  const isDraft = status === "DRAFT"
  const isPublished = status === "PUBLISHED"
  const hasBody = !!htmlBody.trim()

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(didChange)}>
      <DialogContent className="max-w-7xl w-[95vw] h-[92vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                {template?.label || "Cargando..."}
                {isPublished ? (
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200">
                    <ShieldCheck className="h-3 w-3 mr-1" />
                    Publicado
                  </Badge>
                ) : isDraft ? (
                  <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
                    Borrador
                  </Badge>
                ) : (
                  <Badge variant="outline">{status}</Badge>
                )}
              </DialogTitle>
              <DialogDescription className="text-xs mt-1 font-mono">
                {template?.type}
              </DialogDescription>
            </div>
            <div className="flex gap-2">
              {/* Tabs */}
              <div className="flex rounded-md border overflow-hidden">
                <button
                  className={cn(
                    "px-3 py-1 text-sm",
                    tab === "editor" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                  )}
                  onClick={() => setTab("editor")}
                >
                  Editor
                </button>
                <button
                  className={cn(
                    "px-3 py-1 text-sm",
                    tab === "preview" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                  )}
                  onClick={() => setTab("preview")}
                >
                  Preview
                </button>
              </div>
            </div>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            {/* Warnings */}
            {isDraft && (
              <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 px-6 py-2 text-sm flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-amber-900 dark:text-amber-100">
                  Esta plantilla está en BORRADOR. El cron <strong>no la está enviando</strong>. Publicala cuando estés conforme con el contenido.
                </p>
              </div>
            )}
            {!hasBody && template && (
              <div className="bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-800 px-6 py-2 text-sm">
                Sin cuerpo HTML custom. {isPublished ? "El cron usa el fallback hardcoded actual." : "Editá HTML para poder publicar."}
              </div>
            )}

            <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_280px] overflow-hidden">
              {/* Editor / Preview area */}
              <div className="overflow-auto p-6 space-y-4 min-h-0">
                {tab === "editor" ? (
                  <>
                    <div>
                      <label className="text-sm font-medium block mb-1">Subject</label>
                      <Input
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        placeholder="Asunto del email — soporta {{variables}}"
                      />
                    </div>

                    <div>
                      <label className="text-sm font-medium block mb-1">HTML body</label>
                      <Textarea
                        value={htmlBody}
                        onChange={(e) => setHtmlBody(e.target.value)}
                        className="font-mono text-xs min-h-[500px]"
                        placeholder="<html>...</html> — soporta {{variables}}"
                        spellCheck={false}
                      />
                    </div>

                    <div>
                      <label className="text-sm font-medium block mb-1">Notas internas (opcional)</label>
                      <Textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        className="text-sm"
                        placeholder="Notas para el equipo (no se envían al destinatario)"
                        rows={2}
                      />
                    </div>
                  </>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="text-sm">
                        <strong>Subject:</strong> {previewSubject}
                        {previewSource && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            fuente: {previewSource}
                          </Badge>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={refreshPreview} disabled={previewLoading}>
                          <RefreshCw className={cn("h-4 w-4", previewLoading && "animate-spin")} />
                        </Button>
                        <Button
                          variant={viewMode === "desktop" ? "default" : "ghost"}
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setViewMode("desktop")}
                        >
                          <Monitor className="h-4 w-4" />
                        </Button>
                        <Button
                          variant={viewMode === "mobile" ? "default" : "ghost"}
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setViewMode("mobile")}
                        >
                          <Smartphone className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div
                      className={cn(
                        "mx-auto border bg-white rounded-md overflow-hidden",
                        viewMode === "mobile" ? "max-w-[375px]" : "w-full"
                      )}
                    >
                      <iframe
                        srcDoc={previewHtml}
                        className={cn(
                          "w-full border-0",
                          viewMode === "mobile" ? "h-[600px]" : "h-[600px]"
                        )}
                        title="Preview"
                        sandbox="allow-same-origin"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Sidebar: variables */}
              <div className="border-l overflow-auto p-4 bg-muted/20 min-h-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Variables disponibles
                </p>
                <p className="text-[11px] text-muted-foreground mb-3">
                  Click para copiar. Se reemplazan al renderizar.
                </p>
                <div className="space-y-1">
                  {SUGGESTED_VARIABLES.map((v) => (
                    <button
                      key={v}
                      onClick={() => copyVar(v)}
                      className="w-full text-left flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted text-xs font-mono group"
                    >
                      <span>{`{{${v}}}`}</span>
                      <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100" />
                    </button>
                  ))}
                </div>

                <div className="border-t mt-4 pt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Test send
                  </p>
                  <Input
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    placeholder="prueba@ejemplo.com"
                    className="text-sm h-8 mb-2"
                  />
                  <Button size="sm" variant="outline" className="w-full" onClick={handleTestSend}>
                    <Mail className="h-3.5 w-3.5 mr-1" />
                    Enviar test
                  </Button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="border-t px-6 py-3 flex flex-wrap items-center justify-end gap-2 bg-background shrink-0">
              <Button variant="ghost" onClick={() => onClose(didChange)}>
                Cerrar
              </Button>
              <Button variant="outline" onClick={handleSaveDraft} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                Guardar borrador
              </Button>
              {isPublished ? (
                <Button variant="outline" onClick={handleUnpublish} disabled={publishing}>
                  {publishing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                  Despublicar
                </Button>
              ) : (
                <Button onClick={handlePublish} disabled={publishing || !hasBody}>
                  {publishing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                  Publicar
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
