"use client"

import { useEffect, useCallback, use } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  ArrowLeft,
  Building2,
  Power,
  PowerOff,
  ExternalLink,
} from "lucide-react"
import { useSuperadminFetch, useSuperadminMutation } from "@/hooks/use-superadmin-fetch"
import { OrgInfoTab } from "./_components/org-info-tab"
import { OrgUsersTab } from "./_components/org-users-tab"
import { OrgUsageTab } from "./_components/org-usage-tab"
import { OrgSubscriptionTab } from "./_components/org-subscription-tab"
import { OrgPaymentsTab } from "./_components/org-payments-tab"
import type {
  OrganizationDetail,
  OrganizationUser,
  OrganizationUsage,
  SubscriptionWithPlan,
  PaymentWithOrg,
} from "@/types/superadmin"

interface OrgData {
  organization: OrganizationDetail
  users: OrganizationUser[]
  usage: OrganizationUsage | null
  subscription: SubscriptionWithPlan | null
  payments: PaymentWithOrg[]
}

interface PageProps {
  params: Promise<{ id: string }>
}

export default function OrganizacionDetallePage({ params }: PageProps) {
  const { id } = use(params)
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeTab = searchParams.get("tab") || "info"
  const { data, loading, fetchData } = useSuperadminFetch<OrgData>()
  const { mutate, loading: togglingStatus } = useSuperadminMutation()

  const loadOrganization = useCallback(() => {
    fetchData(`/api/superadmin/organizations/${id}`)
  }, [id, fetchData])

  useEffect(() => {
    loadOrganization()
  }, [loadOrganization])

  const handleToggleStatus = async () => {
    if (!data?.organization) return
    await mutate(
      `/api/superadmin/organizations/${id}/toggle-status`,
      {
        method: "POST",
        body: { activo: !data.organization.activo },
        successMessage: data.organization.activo
          ? "Organización desactivada"
          : "Organización activada",
        errorMessage: "Error al cambiar el estado",
        onSuccess: loadOrganization,
      }
    )
  }

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
          <Button onClick={loadOrganization}>
            Reintentar
          </Button>
        </div>
      </div>
    )
  }

  const users = data?.users || []
  const usage = data?.usage || null
  const subscription = data?.subscription || null
  const payments = data?.payments || []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Building2 className="h-8 w-8" />
              {organization.nombre}
            </h1>
            <p className="text-muted-foreground flex items-center gap-2">
              {organization.slug}.stapp.com.ar
              <a
                href={`https://${organization.slug}.stapp.com.ar`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge
            variant={organization.activo ? "default" : "destructive"}
            className="text-sm px-3 py-1"
          >
            {organization.activo ? "Activa" : "Inactiva"}
          </Badge>
          <Button
            variant={organization.activo ? "destructive" : "default"}
            onClick={handleToggleStatus}
            disabled={togglingStatus}
          >
            {organization.activo ? (
              <>
                <PowerOff className="h-4 w-4 mr-2" />
                Desactivar
              </>
            ) : (
              <>
                <Power className="h-4 w-4 mr-2" />
                Activar
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(tab) => router.replace(`?tab=${tab}`, { scroll: false })}>
        <TabsList>
          <TabsTrigger value="info">Información</TabsTrigger>
          <TabsTrigger value="users">Usuarios ({users.length})</TabsTrigger>
          <TabsTrigger value="usage">Uso</TabsTrigger>
          <TabsTrigger value="subscription">Suscripción</TabsTrigger>
          <TabsTrigger value="payments">Pagos ({payments.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="space-y-4">
          <OrgInfoTab
            organization={organization}
            onUpdated={loadOrganization}
          />
        </TabsContent>

        <TabsContent value="users">
          <OrgUsersTab users={users} />
        </TabsContent>

        <TabsContent value="usage">
          <OrgUsageTab usage={usage} />
        </TabsContent>

        <TabsContent value="subscription">
          <OrgSubscriptionTab
            subscription={subscription}
            organizationId={id}
            organizationName={organization.nombre}
            onUpdated={loadOrganization}
          />
        </TabsContent>

        <TabsContent value="payments">
          <OrgPaymentsTab payments={payments} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
