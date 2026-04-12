"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Webhook,
  RefreshCw,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  RotateCw,
} from "lucide-react"
import { useSuperadminFetch } from "@/hooks/use-superadmin-fetch"
import { formatDateTime } from "@/lib/utils"
import { toast } from "sonner"

interface WebhookEvent {
  id: string
  provider: "MERCADOPAGO" | "REBILL"
  event_type: string | null
  provider_event_id: string | null
  organization_id: string | null
  organization: { nombre: string; slug: string } | null
  status: string
  http_status: number | null
  signature_valid: boolean | null
  error_message: string | null
  payload: any | null
  raw_payload: string | null
  received_at: string
  processed_at: string | null
  duration_ms: number | null
  retry_count: number | null
  requires_manual_review: boolean | null
}

interface EventsResponse {
  events: WebhookEvent[]
  total: number
  totalAll: number
  errorsLast24h: number
  errorsLast7d: number
  pendingManualReview: number
}

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  PROCESSED: "default",
  SKIPPED: "secondary",
  RECEIVED: "outline",
  INVALID_SIGNATURE: "destructive",
  ERROR: "destructive",
}

interface GroupedEvent {
  type: "single" | "group"
  event?: WebhookEvent
  events?: WebhookEvent[]
  paymentId: string
  count: number
}

export function WebhookEventsCard({ onReconcile }: { onReconcile?: () => void }) {
  const { loading, fetchData } = useSuperadminFetch<EventsResponse>()
  const [events, setEvents] = useState<WebhookEvent[]>([])
  const [providerFilter, setProviderFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [errorsLast24h, setErrorsLast24h] = useState(0)
  const [pendingManualReview, setPendingManualReview] = useState(0)
  const [totalAll, setTotalAll] = useState(0)
  const [errorsLast7d, setErrorsLast7d] = useState(0)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [retryingId, setRetryingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: "50" })
    if (providerFilter) params.set("provider", providerFilter)
    if (statusFilter) params.set("status", statusFilter)
    const result = await fetchData(`/api/superadmin/webhook-events?${params}`)
    if (result) {
      setEvents(result.events || [])
      setErrorsLast24h(result.errorsLast24h ?? 0)
      setErrorsLast7d(result.errorsLast7d ?? 0)
      setPendingManualReview(result.pendingManualReview ?? 0)
      setTotalAll(result.totalAll ?? 0)
    }
  }, [providerFilter, statusFilter, fetchData])

  useEffect(() => {
    load()
  }, [load])

  // Agrupar errores repetidos: si el mismo payment ID aparece con error 3+ veces
  const groupedEvents = useMemo<GroupedEvent[]>(() => {
    const errorsByPaymentId = new Map<string, WebhookEvent[]>()
    const nonGroupable: WebhookEvent[] = []

    for (const e of events) {
      if (e.status === "ERROR" && e.provider_event_id) {
        const existing = errorsByPaymentId.get(e.provider_event_id) || []
        existing.push(e)
        errorsByPaymentId.set(e.provider_event_id, existing)
      } else {
        nonGroupable.push(e)
      }
    }

    const result: GroupedEvent[] = []

    // Add non-error events as singles
    for (const e of nonGroupable) {
      result.push({ type: "single", event: e, paymentId: e.provider_event_id || e.id, count: 1 })
    }

    // Group or single error events
    for (const [paymentId, errorEvents] of errorsByPaymentId) {
      if (errorEvents.length >= 3) {
        result.push({ type: "group", events: errorEvents, paymentId, count: errorEvents.length })
      } else {
        for (const e of errorEvents) {
          result.push({ type: "single", event: e, paymentId, count: 1 })
        }
      }
    }

    // Sort by received_at desc
    result.sort((a, b) => {
      const dateA = a.type === "single" ? a.event!.received_at : a.events![0].received_at
      const dateB = b.type === "single" ? b.event!.received_at : b.events![0].received_at
      return new Date(dateB).getTime() - new Date(dateA).getTime()
    })

    return result
  }, [events])

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleGroup = (paymentId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(paymentId)) next.delete(paymentId)
      else next.add(paymentId)
      return next
    })
  }

  const handleRetry = async (paymentId: string) => {
    if (!paymentId) return
    setRetryingId(paymentId)
    try {
      const res = await fetch("/api/superadmin/payments/reconcile-mp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paymentId, force: false }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data?.message || data?.error || "Error al reintentar")
      } else if (data.already_processed) {
        toast.info("El pago ya estaba registrado")
      } else if (data.result?.status === "PROCESSED") {
        toast.success("Pago reconciliado correctamente")
        onReconcile?.()
      } else {
        toast.warning(`Pago no aplicado: ${data.result?.reason || "razón desconocida"}`)
      }
      load()
    } catch (e: any) {
      toast.error(e?.message || "Error de red")
    } finally {
      setRetryingId(null)
    }
  }

  const handleExportCSV = () => {
    const csv = [
      "received_at,provider,event_type,provider_event_id,organization,status,http_status,error_message,duration_ms",
      ...events.map((e) =>
        [
          e.received_at,
          e.provider,
          e.event_type || "",
          e.provider_event_id || "",
          `"${e.organization ? `${e.organization.nombre} (${e.organization.slug})` : ""}"`,
          e.status,
          e.http_status || "",
          `"${(e.error_message || "").replace(/"/g, '""')}"`,
          e.duration_ms || "",
        ].join(",")
      ),
    ].join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `webhooks-${new Date().toISOString().split("T")[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const renderEventRow = (e: WebhookEvent, isNested = false) => {
    const isExpanded = expandedIds.has(e.id)
    return (
      <div key={e.id} className={isNested ? "ml-4" : ""}>
        <div
          className={`flex items-start justify-between gap-3 p-2 rounded border bg-card text-xs cursor-pointer hover:bg-muted/50 transition-colors ${
            isNested ? "border-dashed" : ""
          }`}
          onClick={() => toggleExpand(e.id)}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {isExpanded ? (
                <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
              )}
              <Badge variant="outline" className="text-[10px]">
                {e.provider}
              </Badge>
              {e.event_type && (
                <span className="font-mono">{e.event_type}</span>
              )}
              <Badge
                variant={STATUS_VARIANT[e.status] || "secondary"}
                className="text-[10px]"
              >
                {e.status}
              </Badge>
              {e.signature_valid === false && (
                <Badge variant="destructive" className="text-[10px]">
                  firma ✗
                </Badge>
              )}
              {e.http_status && (
                <span className="text-muted-foreground">
                  HTTP {e.http_status}
                </span>
              )}
            </div>
            <div className="text-muted-foreground mt-0.5 truncate">
              {e.organization
                ? `${e.organization.nombre} (${e.organization.slug})`
                : "Sin org resuelta"}
              {e.provider_event_id && ` · ${e.provider_event_id}`}
            </div>
            {e.error_message && (
              <div className="text-red-600 mt-0.5 break-words">
                {e.error_message}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {e.status === "ERROR" && e.provider_event_id && e.provider === "MERCADOPAGO" && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px]"
                onClick={(ev) => {
                  ev.stopPropagation()
                  handleRetry(e.provider_event_id!)
                }}
                disabled={retryingId === e.provider_event_id}
                title="Reintentar reconciliación"
              >
                {retryingId === e.provider_event_id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RotateCw className="h-3 w-3" />
                )}
              </Button>
            )}
            <div className="text-right text-muted-foreground">
              <div>{formatDateTime(e.received_at)}</div>
              {e.duration_ms != null && <div>{e.duration_ms}ms</div>}
            </div>
          </div>
        </div>
        {/* Detalle expandible */}
        {isExpanded && (
          <div className="ml-5 mt-1 mb-2 p-3 rounded border border-dashed bg-muted/20 text-xs space-y-2">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <span className="text-muted-foreground">Provider Event ID:</span>
              <span className="font-mono">{e.provider_event_id || "—"}</span>
              <span className="text-muted-foreground">Request ID:</span>
              <span className="font-mono">{(e as any).provider_request_id || "—"}</span>
              <span className="text-muted-foreground">Organization:</span>
              <span>{e.organization ? `${e.organization.nombre} (${e.organization.slug})` : "—"}</span>
              <span className="text-muted-foreground">Signature Valid:</span>
              <span>{e.signature_valid === null ? "N/A" : e.signature_valid ? "Si" : "No"}</span>
              <span className="text-muted-foreground">Processed At:</span>
              <span>{e.processed_at ? formatDateTime(e.processed_at) : "—"}</span>
              <span className="text-muted-foreground">Duration:</span>
              <span>{e.duration_ms != null ? `${e.duration_ms}ms` : "—"}</span>
              {e.retry_count != null && e.retry_count > 0 && (
                <>
                  <span className="text-muted-foreground">Retry Count:</span>
                  <span className="text-red-600">{e.retry_count}</span>
                </>
              )}
            </div>
            {e.error_message && (
              <div>
                <span className="text-muted-foreground block mb-1">Error:</span>
                <pre className="text-red-600 whitespace-pre-wrap break-words bg-red-50 dark:bg-red-950/30 p-2 rounded text-[11px]">
                  {e.error_message}
                </pre>
              </div>
            )}
            {e.payload && (
              <div>
                <span className="text-muted-foreground block mb-1">Payload:</span>
                <pre className="whitespace-pre-wrap break-words bg-muted p-2 rounded text-[11px] max-h-[300px] overflow-y-auto">
                  {typeof e.payload === "string"
                    ? e.payload
                    : JSON.stringify(e.payload, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Webhook className="h-4 w-4" />
            Webhooks recientes
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleExportCSV}
              disabled={events.length === 0}
              className="h-7 px-2 text-xs"
            >
              <Download className="h-3 w-3 mr-1" />
              CSV
            </Button>
            <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Auditoría de notificaciones entrantes. Si un pago no impactó,
          buscalo acá: vas a ver si llegó, si la firma era válida y por
          qué se aplicó o no.
        </p>

        {/* Contador total */}
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">
            {errorsLast24h > 0 ? (
              <span className="text-red-600 font-semibold">{errorsLast24h} error{errorsLast24h !== 1 ? "es" : ""}</span>
            ) : (
              <span className="text-green-600 font-semibold">0 errores</span>
            )}
            {" / "}
            <span>{totalAll} total</span>
          </span>
        </div>

        {(errorsLast24h > 0 || pendingManualReview > 0) && (
          <div className="flex items-center gap-2 p-2 rounded-md bg-red-50 border border-red-200 dark:bg-red-950 dark:border-red-800">
            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
            <p className="text-xs text-red-700 dark:text-red-300">
              {errorsLast24h > 0 && (
                <span className="font-semibold">{errorsLast24h} error{errorsLast24h !== 1 ? "es" : ""} en las últimas 24h. </span>
              )}
              {pendingManualReview > 0 && (
                <span className="font-semibold">{pendingManualReview} webhook{pendingManualReview !== 1 ? "s" : ""} requiere{pendingManualReview !== 1 ? "n" : ""} intervención manual.</span>
              )}
            </p>
          </div>
        )}
        <div className="flex gap-2 pt-2">
          <Select
            value={providerFilter || "all"}
            onValueChange={(v) => setProviderFilter(v === "all" ? "" : v)}
          >
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <SelectValue placeholder="Provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="MERCADOPAGO">MercadoPago</SelectItem>
              <SelectItem value="REBILL">Rebill</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={statusFilter || "all"}
            onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}
          >
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="PROCESSED">Procesados</SelectItem>
              <SelectItem value="SKIPPED">Skipped</SelectItem>
              <SelectItem value="INVALID_SIGNATURE">Firma inválida</SelectItem>
              <SelectItem value="ERROR">Error</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {groupedEvents.length === 0 && !loading ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Sin webhooks registrados todavía.
          </p>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {groupedEvents.map((item) => {
              if (item.type === "single") {
                return renderEventRow(item.event!)
              }

              // Grouped error events
              const isGroupExpanded = expandedGroups.has(item.paymentId)
              const latestEvent = item.events![0]
              return (
                <div key={`group-${item.paymentId}`}>
                  <div
                    className="flex items-start justify-between gap-3 p-2 rounded border border-red-300 bg-red-50/50 dark:bg-red-950/20 text-xs cursor-pointer hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                    onClick={() => toggleGroup(item.paymentId)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {isGroupExpanded ? (
                          <ChevronDown className="h-3 w-3 text-red-600 shrink-0" />
                        ) : (
                          <ChevronRight className="h-3 w-3 text-red-600 shrink-0" />
                        )}
                        <Badge variant="destructive" className="text-[10px]">
                          {item.count} intentos fallidos
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {latestEvent.provider}
                        </Badge>
                        <span className="font-mono">{item.paymentId}</span>
                      </div>
                      <div className="text-muted-foreground mt-0.5 truncate">
                        {latestEvent.organization
                          ? `${latestEvent.organization.nombre} (${latestEvent.organization.slug})`
                          : "Sin org resuelta"}
                        {" · Último error: "}
                        {latestEvent.error_message?.slice(0, 80) || "desconocido"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {latestEvent.provider === "MERCADOPAGO" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[10px]"
                          onClick={(ev) => {
                            ev.stopPropagation()
                            handleRetry(item.paymentId)
                          }}
                          disabled={retryingId === item.paymentId}
                          title="Reintentar reconciliación"
                        >
                          {retryingId === item.paymentId ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RotateCw className="h-3 w-3" />
                          )}
                        </Button>
                      )}
                      <div className="text-right text-muted-foreground">
                        <div>{formatDateTime(latestEvent.received_at)}</div>
                      </div>
                    </div>
                  </div>
                  {isGroupExpanded && (
                    <div className="space-y-1 mt-1">
                      {item.events!.map((e) => renderEventRow(e, true))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
