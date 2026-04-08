"use client"

import { useEffect, useState, useCallback } from "react"
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
import { Webhook, RefreshCw, Loader2 } from "lucide-react"
import { useSuperadminFetch } from "@/hooks/use-superadmin-fetch"
import { formatDateTime } from "@/lib/utils"

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
  received_at: string
  duration_ms: number | null
}

interface EventsResponse {
  events: WebhookEvent[]
  total: number
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

export function WebhookEventsCard() {
  const { loading, fetchData } = useSuperadminFetch<EventsResponse>()
  const [events, setEvents] = useState<WebhookEvent[]>([])
  const [providerFilter, setProviderFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("")

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: "20" })
    if (providerFilter) params.set("provider", providerFilter)
    if (statusFilter) params.set("status", statusFilter)
    const result = await fetchData(`/api/superadmin/webhook-events?${params}`)
    if (result) setEvents(result.events || [])
  }, [providerFilter, statusFilter, fetchData])

  useEffect(() => {
    load()
  }, [load])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Webhook className="h-4 w-4" />
            Webhooks recientes
          </CardTitle>
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Auditoría de notificaciones entrantes. Si un pago no impactó,
          buscalo acá: vas a ver si llegó, si la firma era válida y por
          qué se aplicó o no.
        </p>
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
        {events.length === 0 && !loading ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Sin webhooks registrados todavía.
          </p>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {events.map((e) => (
              <div
                key={e.id}
                className="flex items-start justify-between gap-3 p-2 rounded border bg-card text-xs"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
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
                <div className="text-right text-muted-foreground shrink-0">
                  <div>{formatDateTime(e.received_at)}</div>
                  {e.duration_ms != null && <div>{e.duration_ms}ms</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
