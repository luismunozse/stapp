"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Webhook as WebhookIcon,
  Send,
  History,
  Copy,
  Check,
  AlertTriangle,
  RotateCw,
} from "lucide-react"

// Lista de eventos disponibles. Mantener en sync con EVENT_TYPES del dispatcher.
const EVENT_TYPES = [
  { id: "inventario.created", label: "Inventario creado" },
  { id: "inventario.updated", label: "Inventario actualizado" },
  { id: "inventario.archived", label: "Inventario archivado" },
  { id: "inventario.stock_bajo", label: "Stock bajo" },
  { id: "venta.completada", label: "Venta completada" },
  { id: "orden.estado_cambiado", label: "Cambio estado orden" },
  { id: "cotizacion.aceptada", label: "Cotización aceptada" },
] as const

interface Webhook {
  id: string
  name: string
  url: string
  events: string[]
  activo: boolean
  headers: Record<string, string> | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  consecutiveFailures: number
  createdAt: string
  secret?: string
}

interface Delivery {
  id: string
  event: string
  payload: unknown
  status: "PENDING" | "SUCCESS" | "FAILED"
  httpStatus: number | null
  responseBody: string | null
  attempts: number
  lastAttemptAt: string | null
  createdAt: string
}

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Webhook | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Form state
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [selectedEvents, setSelectedEvents] = useState<string[]>([])
  const [headerRows, setHeaderRows] = useState<Array<{ k: string; v: string }>>([])
  const [activo, setActivo] = useState(true)
  const [formError, setFormError] = useState("")

  // Secret one-time view (post-creación o post-rotación)
  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [secretCopied, setSecretCopied] = useState(false)

  // Test modal
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{
    ok: boolean
    httpStatus: number | null
    responseBody: string | null
  } | null>(null)
  const [testing, setTesting] = useState(false)

  // Deliveries modal
  const [deliveriesFor, setDeliveriesFor] = useState<Webhook | null>(null)
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [deliveriesLoading, setDeliveriesLoading] = useState(false)
  const [retryingId, setRetryingId] = useState<string | null>(null)

  const fetchWebhooks = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/webhooks")
      const json = await res.json()
      setWebhooks(json.data || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchWebhooks()
  }, [fetchWebhooks])

  const openNew = () => {
    setEditing(null)
    setName("")
    setUrl("")
    setSelectedEvents([])
    setHeaderRows([])
    setActivo(true)
    setFormError("")
    setDialogOpen(true)
  }

  const openEdit = (w: Webhook) => {
    setEditing(w)
    setName(w.name)
    setUrl(w.url)
    setSelectedEvents([...w.events])
    setHeaderRows(
      w.headers
        ? Object.entries(w.headers).map(([k, v]) => ({ k, v: String(v) }))
        : [],
    )
    setActivo(w.activo)
    setFormError("")
    setDialogOpen(true)
  }

  const toggleEvent = (id: string) => {
    setSelectedEvents((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id],
    )
  }

  const addHeaderRow = () => setHeaderRows((rs) => [...rs, { k: "", v: "" }])
  const removeHeaderRow = (i: number) =>
    setHeaderRows((rs) => rs.filter((_, idx) => idx !== i))
  const updateHeaderRow = (i: number, key: "k" | "v", value: string) =>
    setHeaderRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)))

  const handleSave = async () => {
    setFormError("")
    if (!name.trim()) return setFormError("Nombre requerido")
    if (!url.trim()) return setFormError("URL requerida")
    if (!url.startsWith("https://"))
      return setFormError("URL debe ser HTTPS (HTTP expone el secret HMAC)")
    if (selectedEvents.length === 0) return setFormError("Seleccioná al menos un evento")

    // Headers: filtrar vacíos y construir objeto.
    const headers: Record<string, string> = {}
    for (const r of headerRows) {
      const k = r.k.trim()
      if (k) headers[k] = r.v
    }

    setSaving(true)
    try {
      const body = {
        name: name.trim(),
        url: url.trim(),
        events: selectedEvents,
        headers: Object.keys(headers).length > 0 ? headers : null,
        ...(editing ? { activo } : {}),
      }
      const res = editing
        ? await fetch(`/api/webhooks/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/webhooks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || "Error al guardar")
      }
      const saved = await res.json()
      setDialogOpen(false)
      // Solo creación: mostrar secret una sola vez.
      if (!editing && saved.secret) setNewSecret(saved.secret)
      fetchWebhooks()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Error al guardar")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    setSaving(true)
    try {
      await fetch(`/api/webhooks/${deleteId}`, { method: "DELETE" })
      setDeleteId(null)
      fetchWebhooks()
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActivo = async (w: Webhook) => {
    await fetch(`/api/webhooks/${w.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !w.activo }),
    })
    fetchWebhooks()
  }

  const handleTest = async (id: string) => {
    setTestingId(id)
    setTestResult(null)
    setTesting(true)
    try {
      const res = await fetch(`/api/webhooks/${id}/test`, { method: "POST" })
      const json = await res.json()
      if (!res.ok) {
        setTestResult({ ok: false, httpStatus: null, responseBody: json.error })
      } else {
        setTestResult({
          ok: json.ok,
          httpStatus: json.httpStatus,
          responseBody: json.responseBody,
        })
      }
      // Refrescar para ver consecutive_failures / last_success_at actualizados
      fetchWebhooks()
    } finally {
      setTesting(false)
    }
  }

  const openDeliveries = async (w: Webhook) => {
    setDeliveriesFor(w)
    setDeliveriesLoading(true)
    setDeliveries([])
    try {
      const res = await fetch(`/api/webhooks/${w.id}/deliveries?limit=50`)
      const json = await res.json()
      setDeliveries(json.data || [])
    } finally {
      setDeliveriesLoading(false)
    }
  }

  const handleRetry = async (deliveryId: string) => {
    setRetryingId(deliveryId)
    try {
      await fetch(`/api/webhooks/deliveries/${deliveryId}/retry`, {
        method: "POST",
      })
      // Re-fetch lista para reflejar nuevo estado
      if (deliveriesFor) {
        const res = await fetch(`/api/webhooks/${deliveriesFor.id}/deliveries?limit=50`)
        const json = await res.json()
        setDeliveries(json.data || [])
      }
      fetchWebhooks()
    } finally {
      setRetryingId(null)
    }
  }

  const copySecret = async () => {
    if (!newSecret) return
    await navigator.clipboard.writeText(newSecret)
    setSecretCopied(true)
    setTimeout(() => setSecretCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Link href="/configuracion">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
              <WebhookIcon className="h-6 w-6" /> Webhooks
            </h1>
            <p className="text-sm text-muted-foreground">
              Endpoints que reciben notificaciones HTTPS firmadas con HMAC SHA256
              cuando ocurren eventos en tu cuenta.
            </p>
          </div>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-1" /> Nuevo webhook
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : webhooks.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Sin webhooks configurados.
            <br />
            Creá uno para empezar a recibir eventos en tu sistema externo.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {webhooks.map((w) => (
            <Card key={w.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-semibold truncate">{w.name}</span>
                      {!w.activo && (
                        <Badge variant="secondary" className="text-xs">
                          Desactivado
                        </Badge>
                      )}
                      {w.consecutiveFailures > 0 && (
                        <Badge variant="destructive" className="text-xs gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          {w.consecutiveFailures} fallos
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono truncate mb-2">
                      {w.url}
                    </div>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {w.events.map((e) => (
                        <Badge key={e} variant="outline" className="text-[10px]">
                          {e}
                        </Badge>
                      ))}
                    </div>
                    {w.lastSuccessAt && (
                      <div className="text-[11px] text-muted-foreground">
                        Último éxito: {new Date(w.lastSuccessAt).toLocaleString()}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Switch
                      checked={w.activo}
                      onCheckedChange={() => handleToggleActivo(w)}
                    />
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Probar"
                        onClick={() => handleTest(w.id)}
                      >
                        <Send className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Entregas"
                        onClick={() => openDeliveries(w)}
                      >
                        <History className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Editar"
                        onClick={() => openEdit(w)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Archivar"
                        onClick={() => setDeleteId(w.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Editor */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar webhook" : "Nuevo webhook"}</DialogTitle>
            <DialogDescription>
              El secret HMAC se genera automáticamente y solo se muestra una vez al
              crear.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium">Nombre</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Slack notificaciones"
                className="mt-1"
                maxLength={100}
              />
            </div>
            <div>
              <label className="text-sm font-medium">URL (HTTPS)</label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://tuapp.com/webhooks/stapp"
                className="mt-1 font-mono text-xs"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Eventos</label>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {EVENT_TYPES.map((ev) => (
                  <label
                    key={ev.id}
                    className={`flex items-center gap-2 p-2 rounded-md border text-sm cursor-pointer ${
                      selectedEvents.includes(ev.id)
                        ? "border-primary bg-primary/5"
                        : "border-border"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedEvents.includes(ev.id)}
                      onChange={() => toggleEvent(ev.id)}
                      className="rounded"
                    />
                    <span className="flex-1 min-w-0">
                      <div className="font-medium truncate">{ev.label}</div>
                      <div className="text-[10px] text-muted-foreground font-mono truncate">
                        {ev.id}
                      </div>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Headers custom (opcional)</label>
                <Button variant="ghost" size="sm" onClick={addHeaderRow}>
                  <Plus className="h-3 w-3 mr-1" /> Agregar
                </Button>
              </div>
              {headerRows.length === 0 ? (
                <p className="text-xs text-muted-foreground mt-1">
                  Sin headers custom. Útil para Authorization, X-Tenant-Id, etc.
                </p>
              ) : (
                <div className="space-y-2 mt-2">
                  {headerRows.map((r, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        placeholder="Header"
                        value={r.k}
                        onChange={(e) => updateHeaderRow(i, "k", e.target.value)}
                        className="flex-1 font-mono text-xs"
                      />
                      <Input
                        placeholder="Value"
                        value={r.v}
                        onChange={(e) => updateHeaderRow(i, "v", e.target.value)}
                        className="flex-1 font-mono text-xs"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeHeaderRow(i)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {editing && (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="text-sm font-medium">Activo</div>
                  <div className="text-xs text-muted-foreground">
                    Desactivado no recibe eventos nuevos.
                  </div>
                </div>
                <Switch checked={activo} onCheckedChange={setActivo} />
              </div>
            )}

            {formError && <p className="text-sm text-red-600">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Secret one-time */}
      <Dialog open={!!newSecret} onOpenChange={(o) => !o && setNewSecret(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Guardá el secret ahora
            </DialogTitle>
            <DialogDescription>
              Este secret HMAC se muestra <strong>solo una vez</strong>. Guardalo en
              tu sistema para verificar la firma del header{" "}
              <code className="font-mono">X-Webhook-Signature</code>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border bg-muted p-3 font-mono text-xs break-all">
              {newSecret}
            </div>
            <Button onClick={copySecret} variant="outline" className="w-full">
              {secretCopied ? (
                <>
                  <Check className="h-4 w-4 mr-1" /> Copiado
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-1" /> Copiar
                </>
              )}
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setNewSecret(null)}>Entendido</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Test */}
      <Dialog
        open={!!testingId}
        onOpenChange={(o) => {
          if (!o) {
            setTestingId(null)
            setTestResult(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Probar webhook</DialogTitle>
            <DialogDescription>
              Envía un evento <code className="font-mono">webhook.test</code> al
              endpoint.
            </DialogDescription>
          </DialogHeader>
          {testing ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : testResult ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                {testResult.ok ? (
                  <Badge variant="success">Éxito</Badge>
                ) : (
                  <Badge variant="destructive">Falló</Badge>
                )}
                {testResult.httpStatus !== null && (
                  <Badge variant="outline">HTTP {testResult.httpStatus}</Badge>
                )}
              </div>
              {testResult.responseBody && (
                <div>
                  <div className="text-xs font-medium mb-1">Respuesta:</div>
                  <pre className="rounded-md border bg-muted p-2 text-xs max-h-48 overflow-auto whitespace-pre-wrap break-all">
                    {testResult.responseBody}
                  </pre>
                </div>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              onClick={() => {
                setTestingId(null)
                setTestResult(null)
              }}
            >
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deliveries */}
      <Dialog
        open={!!deliveriesFor}
        onOpenChange={(o) => !o && setDeliveriesFor(null)}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Entregas — {deliveriesFor?.name}</DialogTitle>
            <DialogDescription>Últimas 50 entregas.</DialogDescription>
          </DialogHeader>
          {deliveriesLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : deliveries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Sin entregas todavía.
            </p>
          ) : (
            <div className="space-y-2">
              {deliveries.map((d) => (
                <DeliveryRow
                  key={d.id}
                  delivery={d}
                  onRetry={handleRetry}
                  retrying={retryingId === d.id}
                />
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Archivar webhook"
        description="El webhook dejará de recibir eventos. El historial de entregas se preserva."
        confirmText="Archivar"
        cancelText="Cancelar"
        variant="danger"
        loading={saving}
        onConfirm={handleDelete}
      />
    </div>
  )
}

function DeliveryRow({
  delivery,
  onRetry,
  retrying,
}: {
  delivery: Delivery
  onRetry: (id: string) => void
  retrying: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const variant: "success" | "destructive" | "warning" =
    delivery.status === "SUCCESS"
      ? "success"
      : delivery.status === "FAILED"
        ? "destructive"
        : "warning"
  return (
    <div className="rounded-md border p-3 text-xs">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={variant} className="text-[10px]">
            {delivery.status}
          </Badge>
          <span className="font-mono">{delivery.event}</span>
          {delivery.httpStatus !== null && (
            <Badge variant="outline" className="text-[10px]">
              HTTP {delivery.httpStatus}
            </Badge>
          )}
          <span className="text-muted-foreground">
            {delivery.attempts} intento{delivery.attempts === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">
            {new Date(delivery.createdAt).toLocaleString()}
          </span>
          {delivery.status === "FAILED" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRetry(delivery.id)}
              disabled={retrying}
            >
              {retrying ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RotateCw className="h-3 w-3" />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? "Ocultar" : "Ver"}
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="mt-2 space-y-2">
          <div>
            <div className="font-medium mb-1">Payload:</div>
            <pre className="rounded bg-muted p-2 max-h-48 overflow-auto whitespace-pre-wrap break-all">
              {JSON.stringify(delivery.payload, null, 2)}
            </pre>
          </div>
          {delivery.responseBody && (
            <div>
              <div className="font-medium mb-1">Respuesta:</div>
              <pre className="rounded bg-muted p-2 max-h-32 overflow-auto whitespace-pre-wrap break-all">
                {delivery.responseBody}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
