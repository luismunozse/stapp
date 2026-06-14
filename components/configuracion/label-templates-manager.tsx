"use client"

import { useState, useMemo, useCallback, useEffect } from "react"
import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Plus,
  Pencil,
  Trash2,
  Star,
  Printer,
  Loader2,
  Play,
  AlertTriangle,
} from "lucide-react"
import { StatusBanner } from "@/components/ui/status-banner"
import {
  generateZpl,
  generateEpl,
  defaultZplTemplate50x30,
  defaultEplTemplate50x30,
  type LabelItem,
  type LabelTemplate as ZplLabelTemplate,
} from "@/lib/labels/zpl"

type Formato = "ZPL" | "EPL" | "PDF"

interface ApiTemplate {
  id: string
  nombre: string
  formato: Formato
  ancho_mm: number
  alto_mm: number
  dpi: 152 | 203 | 300
  template: string
  es_default: boolean
  notas: string | null
  created_at: string
  updated_at: string
}

const FORMATOS: Formato[] = ["ZPL", "EPL", "PDF"]
const fetcher = (url: string) => fetch(url).then((r) => r.json())

const SAMPLE_ITEM: LabelItem = {
  codigo: "PROD-001",
  nombre: "Producto de prueba",
  barcode: "7790001000017",
  precioVenta: 12500.5,
}

export function LabelTemplatesManager() {
  const [activeFormato, setActiveFormato] = useState<Formato>("ZPL")
  const { data, mutate, isLoading } = useSWR<ApiTemplate[]>(
    "/api/label-templates",
    fetcher,
  )
  const templates = Array.isArray(data) ? data : []

  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<ApiTemplate | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<ApiTemplate | null>(null)
  const [busy, setBusy] = useState(false)

  const byFormato = useMemo(() => {
    const map: Record<Formato, ApiTemplate[]> = { ZPL: [], EPL: [], PDF: [] }
    for (const t of templates) map[t.formato].push(t)
    return map
  }, [templates])

  const handleNew = (formato: Formato) => {
    setEditing({
      id: "",
      nombre: "",
      formato,
      ancho_mm: 50,
      alto_mm: 30,
      dpi: 203,
      template: formato === "EPL" ? defaultEplTemplate50x30() : defaultZplTemplate50x30(),
      es_default: false,
      notas: "",
      created_at: "",
      updated_at: "",
    })
    setEditorOpen(true)
  }

  const handleEdit = (t: ApiTemplate) => {
    setEditing({ ...t })
    setEditorOpen(true)
  }

  const handleSave = async (payload: ApiTemplate) => {
    setBusy(true)
    try {
      const body = {
        nombre: payload.nombre,
        formato: payload.formato,
        ancho_mm: Number(payload.ancho_mm),
        alto_mm: Number(payload.alto_mm),
        dpi: payload.dpi,
        template: payload.template,
        es_default: payload.es_default,
        notas: payload.notas ?? null,
      }
      const url = payload.id
        ? `/api/label-templates/${payload.id}`
        : "/api/label-templates"
      const method = payload.id ? "PATCH" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(j.error || "Error al guardar")
        return
      }
      setEditorOpen(false)
      setEditing(null)
      await mutate()
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (t: ApiTemplate) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/label-templates/${t.id}`, { method: "DELETE" })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(j.error || "Error al eliminar")
        return
      }
      setConfirmDelete(null)
      await mutate()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Tabs value={activeFormato} onValueChange={(v) => setActiveFormato(v as Formato)}>
        <TabsList className="grid w-full max-w-md grid-cols-3">
          {FORMATOS.map((f) => (
            <TabsTrigger key={f} value={f}>
              {f}
            </TabsTrigger>
          ))}
        </TabsList>

        {FORMATOS.map((f) => (
          <TabsContent key={f} value={f} className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {byFormato[f].length} plantilla{byFormato[f].length === 1 ? "" : "s"} {f}
              </p>
              <Button size="sm" onClick={() => handleNew(f)}>
                <Plus className="h-4 w-4 mr-1" />
                Nueva plantilla {f}
              </Button>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : byFormato[f].length === 0 ? (
              <div className="border-2 border-dashed rounded-lg py-10 text-center text-sm text-muted-foreground">
                Sin plantillas {f}. Creá una para empezar.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {byFormato[f].map((t) => (
                  <Card key={t.id} className={t.es_default ? "border-warning-500/60" : ""}>
                    <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
                      <div className="min-w-0">
                        <CardTitle className="text-base truncate">{t.nombre}</CardTitle>
                        <p className="text-xs text-muted-foreground mt-1">
                          {Number(t.ancho_mm)}×{Number(t.alto_mm)}mm @ {t.dpi}dpi
                        </p>
                      </div>
                      {t.es_default && (
                        <Badge className="bg-warning hover:bg-warning text-white gap-1 shrink-0">
                          <Star className="h-3 w-3" /> Default
                        </Badge>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {t.notas && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{t.notas}</p>
                      )}
                      <pre className="text-[10px] font-mono bg-muted/50 rounded p-2 overflow-x-auto max-h-20 whitespace-pre">
                        {t.template.split("\n").slice(0, 4).join("\n")}
                        {t.template.split("\n").length > 4 ? "\n..." : ""}
                      </pre>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEdit(t)}
                          disabled={busy}
                        >
                          <Pencil className="h-3.5 w-3.5 mr-1" />
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setConfirmDelete(t)}
                          disabled={busy}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" />
                          Eliminar
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {editing && (
        <TemplateEditorDialog
          open={editorOpen}
          onOpenChange={(o) => {
            setEditorOpen(o)
            if (!o) setEditing(null)
          }}
          template={editing}
          onSave={handleSave}
          busy={busy}
        />
      )}

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar plantilla</DialogTitle>
            <DialogDescription>
              ¿Eliminar la plantilla &quot;{confirmDelete?.nombre}&quot;? Esta acción se puede
              revertir contactando soporte (soft-delete).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(null)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmDelete && handleDelete(confirmDelete)}
              disabled={busy}
            >
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ============================================================
// Editor: nombre, formato, dim, dpi, textarea + placeholders + test
// ============================================================
interface EditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  template: ApiTemplate
  onSave: (t: ApiTemplate) => Promise<void> | void
  busy: boolean
}

function TemplateEditorDialog({ open, onOpenChange, template, onSave, busy }: EditorProps) {
  const [draft, setDraft] = useState<ApiTemplate>(template)
  const [testOutput, setTestOutput] = useState<string>("")

  // Reset cuando se abre con un template distinto.
  useEffect(() => {
    setDraft(template)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id])

  const renderTest = useCallback(() => {
    if (draft.formato === "PDF") {
      setTestOutput("(El formato PDF no usa templates de spool; el render se hace por HTML)")
      return
    }
    const tpl: ZplLabelTemplate = {
      id: draft.id || "preview",
      formato: draft.formato === "EPL" ? "EPL" : "ZPL",
      ancho_mm: Number(draft.ancho_mm),
      alto_mm: Number(draft.alto_mm),
      dpi: draft.dpi,
      template: draft.template,
    }
    const out =
      tpl.formato === "EPL"
        ? generateEpl([SAMPLE_ITEM], tpl, "Mi Organización")
        : generateZpl([SAMPLE_ITEM], tpl, "Mi Organización")
    setTestOutput(out)
  }, [draft])

  const valid = draft.nombre.trim().length > 0 && draft.template.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-4xl max-h-[90dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-4 w-4" />
            {draft.id ? "Editar plantilla" : "Nueva plantilla"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Nombre</Label>
              <Input
                value={draft.nombre}
                onChange={(e) => setDraft({ ...draft, nombre: e.target.value })}
                placeholder="Ej: ZPL 50x30 con barcode"
                maxLength={80}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Formato</Label>
              <Select
                value={draft.formato}
                onValueChange={(v) =>
                  setDraft({ ...draft, formato: v as Formato })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ZPL">ZPL (Zebra moderna)</SelectItem>
                  <SelectItem value="EPL">EPL (Zebra antigua)</SelectItem>
                  <SelectItem value="PDF">PDF / Hoja común</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Ancho (mm)</Label>
              <Input
                type="number"
                step="0.5"
                min={1}
                max={300}
                value={draft.ancho_mm}
                onChange={(e) =>
                  setDraft({ ...draft, ancho_mm: parseFloat(e.target.value) || 0 })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Alto (mm)</Label>
              <Input
                type="number"
                step="0.5"
                min={1}
                max={300}
                value={draft.alto_mm}
                onChange={(e) =>
                  setDraft({ ...draft, alto_mm: parseFloat(e.target.value) || 0 })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>DPI</Label>
              <Select
                value={String(draft.dpi)}
                onValueChange={(v) =>
                  setDraft({ ...draft, dpi: parseInt(v, 10) as 152 | 203 | 300 })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="152">152 dpi</SelectItem>
                  <SelectItem value="203">203 dpi (más común)</SelectItem>
                  <SelectItem value="300">300 dpi</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Default del formato</Label>
              <div className="flex items-center gap-2 h-10">
                <input
                  type="checkbox"
                  checked={draft.es_default}
                  onChange={(e) =>
                    setDraft({ ...draft, es_default: e.target.checked })
                  }
                  className="h-4 w-4"
                />
                <span className="text-sm text-muted-foreground">
                  Marcar como plantilla por defecto para {draft.formato}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-3">
            <div className="space-y-1.5">
              <Label>Template ({draft.formato})</Label>
              <Textarea
                value={draft.template}
                onChange={(e) => setDraft({ ...draft, template: e.target.value })}
                className="font-mono text-xs min-h-[260px]"
                spellCheck={false}
              />
              <p className="text-[11px] text-muted-foreground">
                Tip: ZPL wrapea cada etiqueta entre <code>^XA</code> y <code>^XZ</code>.
                EPL inicia con <code>N</code> y cierra con <code>P1</code>. Si tu
                template los incluye, no los agregamos automáticamente.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Placeholders</Label>
              <div className="border rounded-md p-3 space-y-1.5 text-xs">
                <PlaceholderRow code="{{codigo}}" desc="SKU / código interno" />
                <PlaceholderRow code="{{nombre}}" desc="Nombre del producto" />
                <PlaceholderRow code="{{barcode}}" desc="Código de barras (barcode || codigo)" />
                <PlaceholderRow code="{{precio}}" desc="Precio de venta (decimal)" />
                <PlaceholderRow code="{{org_nombre}}" desc="Nombre de tu organización" />
              </div>
              <StatusBanner tone="warning" icon={AlertTriangle} className="text-[11px]">
                Los valores se escapan automáticamente para evitar romper el
                spool (ZPL: <code>^</code>→<code>\5E</code>; EPL:{" "}
                <code>&quot;</code>→<code>\&quot;</code>).
              </StatusBanner>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Probar template</Label>
              <Button
                size="sm"
                variant="outline"
                onClick={renderTest}
                disabled={!draft.template.trim()}
              >
                <Play className="h-3.5 w-3.5 mr-1" />
                Renderizar con item de prueba
              </Button>
            </div>
            <Textarea
              value={testOutput}
              readOnly
              placeholder='Item de prueba: { codigo: "PROD-001", nombre: "Producto de prueba", barcode: "7790001000017", precio: 12500.50 }'
              className="font-mono text-[11px] min-h-[100px] resize-none"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Notas (opcional)</Label>
            <Textarea
              value={draft.notas ?? ""}
              onChange={(e) => setDraft({ ...draft, notas: e.target.value })}
              maxLength={500}
              className="min-h-[60px] resize-none"
              placeholder="Descripción interna de la plantilla"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => onSave(draft)} disabled={busy || !valid}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PlaceholderRow({ code, desc }: { code: string; desc: string }) {
  return (
    <div className="flex items-start gap-2">
      <code className="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px] shrink-0">
        {code}
      </code>
      <span className="text-muted-foreground text-[11px] leading-relaxed">{desc}</span>
    </div>
  )
}
