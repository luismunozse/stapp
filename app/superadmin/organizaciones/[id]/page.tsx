"use client"

import { useEffect, useCallback, use } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ArrowLeft,
  Building2,
  CreditCard,
  AlertTriangle,
  CheckCircle,
  Clock,
} from "lucide-react"
import { useSuperadminFetch } from "@/hooks/use-superadmin-fetch"
import { OrgCommandHeader } from "./_components/org-command-header"
import { OrgQuickActions } from "./_components/org-quick-actions"
import { OrgLimitsSection } from "./_components/org-limits-section"
import { OrgFeatureFlagsSection } from "./_components/org-feature-flags-section"
import { OrgInfoTab } from "./_components/org-info-tab"
import { OrgUsersTab } from "./_components/org-users-tab"
import { OrgUsageTab } from "./_components/org-usage-tab"
import { OrgPaymentsTab } from "./_components/org-payments-tab"
import { formatDate } from "@/lib/utils"
import type { OrganizationDetailResponse } from "@/types/superadmin"

interface PageProps {
  params: Promise<{ id: string }>
}

export default function OrganizacionDetallePage({ params }: PageProps) {
  const { id } = use(params)
  const router = useRouter()
  const { data, loading, fetchData } = useSuperadminFetch<OrganizationDetailResponse>()

  const refresh = useCallback(() => {
    fetchData(`/api/superadmin/organizations/${id}`)
  }, [id, fetchData])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  const organization = data?.organization
  if (!organization) {
    return (
      <div className="text-center py-12 space-y-3">
        <Building2 className="h-12 w-12 text-muted-foreground mx-auto" />
        <p className="text-muted-foreground">Organización no encontrada</p>
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Volver
          </Button>
          <Button onClick={refresh}>
            Reintentar
          </Button>
        </div>
      </div>
    )
  }

  const subscription = data?.subscription ?? null
  const usage = data?.usage ?? null
  const users = data?.users ?? []
  const payments = data?.payments ?? []
  const ordersHistory = data?.ordersHistory ?? []
  const limitOverrides = data?.limitOverrides ?? null

  // Inline read-only subscription summary
  const subscriptionSummaryCard = (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard className="h-4 w-4" />
          Suscripción
        </CardTitle>
      </CardHeader>
      <CardContent>
        {subscription ? (
          <div className="flex flex-wrap items-center gap-3">
            <Badge className="text-sm px-3 py-0.5">
              {subscription.plans?.nombre ?? "Plan"}
            </Badge>
            <Badge variant={subscription.status === "ACTIVE" ? "default" : "secondary"}>
              {subscription.status}
            </Badge>
            {subscription.billing_period && (
              <Badge variant="outline">{subscription.billing_period}</Badge>
            )}
            {subscription.payment_provider && (
              <Badge variant="outline" className="text-muted-foreground">
                {subscription.payment_provider}
              </Badge>
            )}
            {(() => {
              const endDate = subscription.trial_end ?? subscription.current_period_end
              if (!endDate) return null
              const daysLeft = Math.ceil(
                (new Date(endDate).getTime() - Date.now()) / 86400000
              )
              const label = subscription.trial_end ? "Trial" : "Período"
              if (daysLeft <= 0) {
                return (
                  <Badge variant="destructive" className="flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {label} vencido
                  </Badge>
                )
              }
              if (daysLeft < 15) {
                return (
                  <Badge variant="destructive" className="flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {label} vence en {daysLeft}d · {formatDate(endDate)}
                  </Badge>
                )
              }
              if (daysLeft <= 60) {
                return (
                  <Badge className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600">
                    <Clock className="h-3 w-3" />
                    {label} · {daysLeft}d restantes
                  </Badge>
                )
              }
              return (
                <Badge className="flex items-center gap-1 bg-green-600 hover:bg-green-700">
                  <CheckCircle className="h-3 w-3" />
                  {label} · {daysLeft}d restantes
                </Badge>
              )
            })()}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Sin suscripción activa — Plan Free
          </p>
        )}
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-6">
      {/* Back navigation */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <span className="text-sm text-muted-foreground">Organizaciones</span>
      </div>

      {/* 1. Identity + status header */}
      <OrgCommandHeader organization={organization} subscription={subscription} />

      {/* 2. Quick actions (suspend/reactivate, extend trial, change plan, cancel, archive) */}
      <OrgQuickActions
        organization={organization}
        subscription={subscription}
        onUpdated={refresh}
      />

      {/* 3. Usage summary */}
      <OrgUsageTab usage={usage} ordersHistory={ordersHistory} />

      {/* 4. Subscription read-only summary (actions are in QuickActions) */}
      {subscriptionSummaryCard}

      {/* 5. Limits + overrides */}
      <OrgLimitsSection
        organization={organization}
        subscription={subscription}
        usage={usage}
        limitOverrides={limitOverrides}
        onUpdated={refresh}
      />

      {/* 5b. Feature flags per org */}
      <OrgFeatureFlagsSection organization={organization} />

      {/* 6. Users */}
      <OrgUsersTab users={users} onUpdated={refresh} />

      {/* 7. Payments */}
      <OrgPaymentsTab payments={payments} />

      {/* 8. Identity / editable info */}
      <OrgInfoTab organization={organization} onUpdated={refresh} />
    </div>
  )
}
