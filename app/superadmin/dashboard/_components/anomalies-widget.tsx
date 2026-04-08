"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle, ExternalLink } from "lucide-react"
import { useSuperadminFetch } from "@/hooks/use-superadmin-fetch"
import { formatDate } from "@/lib/utils"

interface AnomaliesData {
  inflatedPeriod: Array<{
    id: string
    organization_id: string
    billing_period: "MONTHLY" | "YEARLY"
    current_period_end: string
    payment_provider: string | null
    organization: { nombre: string; slug: string } | null
  }>
  mixedProviderPayments: Array<{
    organization_id: string
    organization: { nombre: string; slug: string } | null
    payments: Array<{
      id: string
      payment_provider: string
      amount: number
      paid_at: string
    }>
  }>
  totals: {
    inflatedPeriod: number
    mixedProviderPayments: number
  }
}

/**
 * Widget que muestra anomalías de facturación detectadas:
 * - Suscripciones con período absurdamente largo (probable doble extensión)
 * - Orgs con pagos de proveedores mixtos en 48h (manual + MP, etc.)
 *
 * Se oculta automáticamente si no hay anomalías. La idea es que si
 * todo está bien, el dashboard no se llene de ruido — pero si pasa
 * algo raro, salta a la vista.
 */
export function AnomaliesWidget() {
  const { fetchData } = useSuperadminFetch<AnomaliesData>({ showErrorToast: false })
  const [data, setData] = useState<AnomaliesData | null>(null)

  const load = useCallback(async () => {
    const r = await fetchData("/api/superadmin/subscriptions/anomalies")
    if (r) setData(r)
  }, [fetchData])

  useEffect(() => {
    load()
  }, [load])

  if (!data) return null
  const total = data.totals.inflatedPeriod + data.totals.mixedProviderPayments
  if (total === 0) return null

  return (
    <Card className="border-amber-300 dark:border-amber-800">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-amber-900 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4" />
          Anomalías de facturación detectadas
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Posibles dobles cobros, dobles extensiones, o pagos cruzados
          entre MercadoPago y activación manual. Revisalas antes de
          renovar/cancelar nada en la org afectada.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.inflatedPeriod.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">
              Período inflado ({data.totals.inflatedPeriod})
            </h4>
            <div className="space-y-1.5">
              {data.inflatedPeriod.map((s) => (
                <Link
                  key={s.id}
                  href={`/superadmin/organizaciones/${s.organization_id}`}
                  className="flex items-center justify-between text-xs p-2 rounded border bg-card hover:bg-muted/50"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {s.organization?.nombre || s.organization_id}
                    </div>
                    <div className="text-muted-foreground">
                      Vence {formatDate(s.current_period_end)} ·{" "}
                      {s.billing_period} · {s.payment_provider || "—"}
                    </div>
                  </div>
                  <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0 ml-2" />
                </Link>
              ))}
            </div>
          </div>
        )}

        {data.mixedProviderPayments.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">
              Pagos de proveedores mixtos en 48h ({data.totals.mixedProviderPayments})
            </h4>
            <div className="space-y-1.5">
              {data.mixedProviderPayments.map((m) => (
                <Link
                  key={m.organization_id}
                  href={`/superadmin/organizaciones/${m.organization_id}`}
                  className="flex items-start justify-between text-xs p-2 rounded border bg-card hover:bg-muted/50 gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">
                      {m.organization?.nombre || m.organization_id}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {m.payments.map((p) => (
                        <Badge key={p.id} variant="outline" className="text-[10px]">
                          {p.payment_provider} · ${p.amount}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                </Link>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
