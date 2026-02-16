"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Crown, Calendar, AlertCircle, Clock, Sparkles } from "lucide-react"
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
  const isTrialing = subscription.status === "TRIALING"
  const isCanceled = subscription.cancelAtPeriodEnd
  const isPaid = subscription.paymentProvider !== null

  // Calcular días restantes de trial
  const trialEnd = subscription.trialEnd ? new Date(subscription.trialEnd) : null
  const now = new Date()
  const daysRemaining = trialEnd
    ? Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : 0
  const trialProgress = trialEnd ? Math.max(0, Math.min(100, ((30 - daysRemaining) / 30) * 100)) : 0

  const periodEnd = subscription.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd).toLocaleDateString("es-ES", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null

  const trialEndFormatted = trialEnd
    ? trialEnd.toLocaleDateString("es-ES", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null

  const statusColors: Record<string, string> = {
    ACTIVE: "bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300",
    TRIALING: "bg-gradient-to-r from-blue-100 to-purple-100 dark:from-blue-900/50 dark:to-purple-900/50 text-blue-800 dark:text-blue-300",
    PAST_DUE: "bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-300",
    CANCELED: "bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300",
  }

  const statusLabels: Record<string, string> = {
    ACTIVE: "Activo",
    TRIALING: "Prueba gratuita",
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
        {/* Trial info - prominente */}
        {isTrialing && !isPaid && (
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/30 dark:to-purple-950/30 border border-blue-200 dark:border-blue-800 p-4 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-blue-600" />
                <span className="font-medium">Período de prueba</span>
              </div>
              <Badge variant="outline" className="bg-white dark:bg-background">
                {daysRemaining} {daysRemaining === 1 ? "día" : "días"} restantes
              </Badge>
            </div>
            <Progress value={trialProgress} className="h-2" />
            <p className="text-sm text-muted-foreground">
              Tu prueba gratuita termina el {trialEndFormatted}.
              Suscríbete antes para no perder acceso.
            </p>
            <Button onClick={onUpgrade} className="w-full">
              <Sparkles className="h-4 w-4 mr-2" />
              Suscribirse ahora - $19.999/mes
            </Button>
          </div>
        )}

        {/* Period info for paid users */}
        {periodEnd && isPremium && isPaid && (
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
          <div className="flex items-start gap-2 bg-yellow-50 dark:bg-yellow-950/50 text-yellow-800 dark:text-yellow-300 p-4 rounded-lg">
            <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Suscripción cancelada</p>
              <p className="text-sm">
                Mantendrás acceso a Premium hasta {periodEnd}. Después se bloqueará
                el acceso hasta que reactives tu suscripción.
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
          {/* Solo mostrar botón de upgrade si NO está en trial (porque ya tiene botón arriba) */}
          {!isPremium && !isTrialing && (
            <Button onClick={onUpgrade}>
              <Crown className="h-4 w-4 mr-2" />
              Actualizar a Premium
            </Button>
          )}
          {/* Permitir cancelar solo si está pagando (no en trial) */}
          {isPremium && isPaid && !isCanceled && (
            <Button variant="ghost" className="text-red-600" onClick={onCancel}>
              Cancelar suscripción
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
