"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Crown, Calendar, AlertCircle } from "lucide-react"
import type { SubscriptionInfo } from "@/lib/subscriptions"

interface CurrentPlanProps {
  subscription: SubscriptionInfo | null
  onUpgrade: () => void
  onManage: () => void
  onCancel: () => void
}

export function CurrentPlan({ subscription, onUpgrade, onManage, onCancel }: CurrentPlanProps) {
  if (!subscription) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Plan Actual</CardTitle>
          <CardDescription>No hay suscripción activa</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const isPremium = subscription.planTipo === "PREMIUM"
  const isCanceled = subscription.cancelAtPeriodEnd
  const periodEnd = subscription.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd).toLocaleDateString("es-ES", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null

  const statusColors: Record<string, string> = {
    ACTIVE: "bg-green-100 text-green-800",
    TRIALING: "bg-blue-100 text-blue-800",
    PAST_DUE: "bg-yellow-100 text-yellow-800",
    CANCELED: "bg-red-100 text-red-800",
  }

  const statusLabels: Record<string, string> = {
    ACTIVE: "Activo",
    TRIALING: "Período de prueba",
    PAST_DUE: "Pago pendiente",
    CANCELED: "Cancelado",
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              {isPremium && <Crown className="h-5 w-5 text-yellow-500" />}
              Plan {subscription.planNombre}
            </CardTitle>
            <CardDescription>Tu plan actual y beneficios</CardDescription>
          </div>
          <Badge className={statusColors[subscription.status]}>
            {statusLabels[subscription.status]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Period info */}
        {periodEnd && isPremium && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            {isCanceled ? (
              <span>
                Tu suscripción termina el {periodEnd}
              </span>
            ) : (
              <span>
                Próxima facturación: {periodEnd}
              </span>
            )}
          </div>
        )}

        {/* Cancellation warning */}
        {isCanceled && (
          <div className="flex items-start gap-2 bg-yellow-50 text-yellow-800 p-4 rounded-lg">
            <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Suscripción cancelada</p>
              <p className="text-sm">
                Mantendrás acceso a Premium hasta {periodEnd}. Después pasarás
                automáticamente al plan Free.
              </p>
            </div>
          </div>
        )}

        {/* Features list */}
        <div>
          <h4 className="font-medium mb-3">Incluido en tu plan:</h4>
          <ul className="space-y-2">
            {subscription.features.map((feature, index) => (
              <li key={index} className="flex items-center gap-2 text-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {feature}
              </li>
            ))}
          </ul>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-3 pt-4 border-t">
          {!isPremium && (
            <Button onClick={onUpgrade}>
              <Crown className="h-4 w-4 mr-2" />
              Actualizar a Premium
            </Button>
          )}
          {isPremium && subscription.paymentProvider === "STRIPE" && !isCanceled && (
            <Button variant="outline" onClick={onManage}>
              Gestionar facturación
            </Button>
          )}
          {isPremium && !isCanceled && (
            <Button variant="ghost" className="text-red-600" onClick={onCancel}>
              Cancelar suscripción
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
