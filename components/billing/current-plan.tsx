"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Crown, Calendar, AlertCircle, Clock, Sparkles } from "lucide-react"
import type { SubscriptionInfo } from "@/lib/subscriptions"
import { useCurrency } from "@/contexts/currency-context"

interface CurrentPlanProps {
  subscription: SubscriptionInfo | null
  onUpgrade: () => void
  onManage: () => void
  onCancel: () => void
}

export function CurrentPlan({ subscription, onUpgrade, onManage, onCancel }: CurrentPlanProps) {
  const { timezone } = useCurrency()
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
        timeZone: timezone,
      })
    : null

  const trialEndFormatted = trialEnd
    ? trialEnd.toLocaleDateString("es-ES", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: timezone,
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
      <CardHeader className="p-4 sm:p-6">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              {isPremium && <Crown className="h-4 w-4 sm:h-5 sm:w-5 text-yellow-500" />}
              Plan {subscription.planNombre}
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">Tu plan actual</CardDescription>
          </div>
          <Badge className={`text-[10px] sm:text-xs shrink-0 ${statusColors[subscription.status]}`}>
            {statusLabels[subscription.status]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-4 sm:p-6 pt-0 space-y-4 sm:space-y-6">
        {/* Trial info - prominente */}
        {isTrialing && !isPaid && (
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/30 dark:to-purple-950/30 border border-blue-200 dark:border-blue-800 p-3 sm:p-4 rounded-lg space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600" />
                <span className="font-medium text-sm">Período de prueba</span>
              </div>
              <Badge variant="outline" className="bg-white dark:bg-background text-[10px] sm:text-xs">
                {daysRemaining} {daysRemaining === 1 ? "día" : "días"}
              </Badge>
            </div>
            <Progress value={trialProgress} className="h-2" />
            <p className="text-xs sm:text-sm text-muted-foreground">
              Termina el {trialEndFormatted}. Suscríbete para no perder acceso.
            </p>
            <Button onClick={onUpgrade} className="w-full" size="sm">
              <Sparkles className="h-4 w-4 mr-2" />
              Suscribirse - $19.999/mes
            </Button>
          </div>
        )}

        {/* Period info for paid users */}
        {periodEnd && isPremium && isPaid && (
          <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
            <Calendar className="h-4 w-4 shrink-0" />
            {isCanceled ? (
              <span>Termina el {periodEnd}</span>
            ) : subscription.autoDebito ? (
              <span>Próxima facturación: {periodEnd}</span>
            ) : (
              <span>Vence el {periodEnd}. Renovás vos.</span>
            )}
          </div>
        )}

        {/* Cancellation warning */}
        {isCanceled && (
          <div className="flex items-start gap-2 bg-yellow-50 dark:bg-yellow-950/50 text-yellow-800 dark:text-yellow-300 p-3 sm:p-4 rounded-lg">
            <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">Suscripción cancelada</p>
              <p className="text-xs sm:text-sm">
                Acceso Premium hasta {periodEnd}.
              </p>
            </div>
          </div>
        )}

        {/* Features list */}
        <div>
          <h4 className="font-medium text-sm mb-2 sm:mb-3">Incluido en tu plan:</h4>
          <ul className="space-y-1.5 sm:space-y-2">
            {subscription.features.map((feature) => (
              <li key={feature} className="flex items-center gap-2 text-xs sm:text-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                {feature}
              </li>
            ))}
          </ul>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 sm:gap-3 pt-3 sm:pt-4 border-t">
          {!isPremium && !isTrialing && (
            <Button onClick={onUpgrade} size="sm">
              <Crown className="h-4 w-4 mr-2" />
              Actualizar a Profesional
            </Button>
          )}
          {isPremium && isPaid && !isCanceled && (
            <Button variant="ghost" size="sm" className="text-red-600" onClick={onCancel}>
              Cancelar suscripción
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
