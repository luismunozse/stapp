import type { ReactNode } from "react"
import { Ban } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { OrganizationDetail, SubscriptionWithPlan } from "@/types/superadmin"
import { DEFAULT_TIMEZONE } from "@/lib/timezone"

interface OrgCommandHeaderProps {
  organization: OrganizationDetail
  subscription: SubscriptionWithPlan | null
}

export function OrgCommandHeader({ organization, subscription }: OrgCommandHeaderProps) {
  const contactParts = [
    organization.email,
    organization.telefono,
    organization.direccion,
  ].filter(Boolean)

  const planName = subscription?.plans?.nombre ?? "Free"

  const isTrialing =
    subscription?.status === "TRIALING" && !!subscription.trial_end

  let trialBadge: ReactNode = null
  if (isTrialing) {
    const daysLeft = Math.ceil(
      (new Date(subscription!.trial_end!).getTime() - Date.now()) / 86400000
    )
    if (daysLeft > 0) {
      const trialEndFormatted = new Date(subscription!.trial_end!).toLocaleDateString(
        "es-AR",
        { day: "2-digit", month: "2-digit", timeZone: DEFAULT_TIMEZONE }
      )
      trialBadge = (
        <Badge variant="warningSoft">
          Trial: {daysLeft}d · {trialEndFormatted}
        </Badge>
      )
    } else {
      trialBadge = <Badge variant="warningSoft">Trial vencido</Badge>
    }
  }

  const createdAt = new Date(organization.created_at).toLocaleDateString("es-AR", { timeZone: DEFAULT_TIMEZONE })

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          {/* Left: identity */}
          <div className="space-y-1">
            <div className="flex items-baseline gap-2">
              <h1 className="text-2xl font-semibold leading-none tracking-tight">
                🔧 {organization.nombre}
              </h1>
              <span className="text-sm text-muted-foreground font-mono">
                {organization.slug}
              </span>
            </div>

            {contactParts.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {contactParts.join(" · ")}
              </p>
            )}
          </div>

          {/* Right: status badges */}
          <div className="flex flex-wrap items-center gap-2">
            {organization.activo ? (
              <Badge variant="successSoft" showIcon>
                Activo
              </Badge>
            ) : (
              <Badge variant="secondary">Suspendido</Badge>
            )}

            <Badge variant="outline">{planName}</Badge>

            {trialBadge}

            <Badge variant="outline" className="text-muted-foreground">
              Alta: {createdAt}
            </Badge>
          </div>
        </div>

        {/* Suspension detail — only when the org is suspended */}
        {!organization.activo && organization.suspension_reason && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
            <Ban className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="text-sm">
              <p className="font-medium text-destructive">
                Motivo de la suspensión
              </p>
              <p className="text-foreground/80">{organization.suspension_reason}</p>
              {(organization.suspended_at || organization.suspended_by) && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {organization.suspended_at &&
                    `Suspendida el ${new Date(organization.suspended_at).toLocaleDateString("es-AR", { timeZone: DEFAULT_TIMEZONE })}`}
                  {organization.suspended_by && ` · por ${organization.suspended_by}`}
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
