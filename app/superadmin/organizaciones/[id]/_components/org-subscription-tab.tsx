"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  CreditCard,
  RefreshCw,
  Loader2,
  CheckCircle,
  Clock,
  AlertTriangle,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useSuperadminMutation } from "@/hooks/use-superadmin-fetch"
import { formatDate } from "@/lib/utils"
import type { SubscriptionWithPlan } from "@/types/superadmin"

interface OrgSubscriptionTabProps {
  subscription: SubscriptionWithPlan | null
  organizationId: string
  organizationName: string
  onUpdated: () => void
}

export function OrgSubscriptionTab({
  subscription,
  organizationId,
  organizationName,
  onUpdated,
}: OrgSubscriptionTabProps) {
  const [renewModalOpen, setRenewModalOpen] = useState(false)
  const [renewPeriod, setRenewPeriod] = useState<"MONTHLY" | "YEARLY">("MONTHLY")
  const [renewSuccess, setRenewSuccess] = useState("")
  const { mutate, loading: renewLoading } = useSuperadminMutation()

  const handleRenewSubscription = async () => {
    setRenewSuccess("")
    const result = await mutate("/api/superadmin/subscriptions/renew", {
      method: "POST",
      body: {
        organizationId,
        billingPeriod: renewPeriod,
      },
      errorMessage: "Error al renovar suscripción",
      onSuccess: (data: any) => {
        setRenewSuccess(data.message || "Suscripción renovada exitosamente")
        onUpdated()
        setTimeout(() => {
          setRenewModalOpen(false)
          setRenewSuccess("")
        }, 2000)
      },
    })
  }

  const isActive = subscription?.status === "ACTIVE"

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Suscripción
            </CardTitle>
            <Button onClick={() => setRenewModalOpen(true)}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {isActive ? "Extender suscripción" : "Activar Premium"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {subscription ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                <Badge className="text-lg px-4 py-1">
                  {subscription.plans?.nombre || "Plan"}
                </Badge>
                <Badge
                  variant={isActive ? "default" : "secondary"}
                >
                  {subscription.status}
                </Badge>
                {subscription.billing_period && (
                  <Badge variant="outline">{subscription.billing_period}</Badge>
                )}
                {/* Indicador de días restantes */}
                {(() => {
                  if (!subscription.current_period_end) return null
                  const daysLeft = Math.ceil(
                    (new Date(subscription.current_period_end).getTime() - Date.now()) /
                      (1000 * 60 * 60 * 24)
                  )
                  if (daysLeft < 0) {
                    return (
                      <Badge variant="destructive" className="flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Vencida
                      </Badge>
                    )
                  }
                  if (daysLeft < 15) {
                    return (
                      <Badge variant="destructive" className="flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Vence en {daysLeft} días
                      </Badge>
                    )
                  }
                  if (daysLeft <= 60) {
                    return (
                      <Badge className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600">
                        <Clock className="h-3 w-3" />
                        Por vencer — {daysLeft} días restantes
                      </Badge>
                    )
                  }
                  return (
                    <Badge className="flex items-center gap-1 bg-green-600 hover:bg-green-700">
                      <CheckCircle className="h-3 w-3" />
                      Vigente — {daysLeft} días restantes
                    </Badge>
                  )
                })()}
              </div>

              <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
                <div>
                  <div className="text-sm text-muted-foreground">
                    Período actual termina
                  </div>
                  <div className="font-medium">
                    {subscription.current_period_end
                      ? formatDate(subscription.current_period_end)
                      : "-"}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">
                    Cancelación pendiente
                  </div>
                  <div className="font-medium">
                    {subscription.cancel_at_period_end ? "Sí" : "No"}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">
                    Proveedor de pago
                  </div>
                  <div className="font-medium">
                    {subscription.payment_provider || "Manual"}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Creada</div>
                  <div className="font-medium">
                    {formatDate(subscription.created_at)}
                  </div>
                </div>
              </div>

              {subscription.plans && (
                <div className="p-4 border rounded-lg">
                  <h4 className="font-medium mb-2">Límites del plan</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                    <div>
                      Órdenes:{" "}
                      {subscription.plans.limite_ordenes || "Ilimitado"}
                    </div>
                    <div>
                      Técnicos:{" "}
                      {subscription.plans.limite_tecnicos || "Ilimitado"}
                    </div>
                    <div>
                      Clientes:{" "}
                      {subscription.plans.limite_clientes || "Ilimitado"}
                    </div>
                    <div>
                      Storage:{" "}
                      {subscription.plans.limite_storage_mb
                        ? `${subscription.plans.limite_storage_mb} MB`
                        : "Ilimitado"}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-6 space-y-3">
              <p className="text-muted-foreground">
                Esta organización no tiene una suscripción activa (Plan Free)
              </p>
              <Button onClick={() => setRenewModalOpen(true)}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Activar Premium
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Renewal Modal */}
      <Dialog open={renewModalOpen} onOpenChange={setRenewModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {isActive
                ? "Extender suscripción Premium"
                : "Activar suscripción Premium"}
            </DialogTitle>
            <DialogDescription>
              {isActive
                ? `La suscripción actual vence el ${subscription?.current_period_end ? formatDate(subscription.current_period_end) : "-"}. El nuevo período se sumará al existente.`
                : `Activar manualmente el plan Premium para ${organizationName}.`}
            </DialogDescription>
          </DialogHeader>

          {renewSuccess ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <CheckCircle className="h-12 w-12 text-green-500" />
              <p className="text-center font-medium">{renewSuccess}</p>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Período de facturación</label>
                <Select
                  value={renewPeriod}
                  onValueChange={(v) => setRenewPeriod(v as "MONTHLY" | "YEARLY")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MONTHLY">Mensual (1 mes)</SelectItem>
                    <SelectItem value="YEARLY">Anual (12 meses)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="p-3 rounded-lg bg-muted text-sm">
                <p className="text-muted-foreground">
                  Esto activará el plan Premium sin proceso de pago. Se registrará en el log de auditoría.
                </p>
              </div>

              <div className="flex gap-3 justify-end">
                <Button
                  variant="outline"
                  onClick={() => setRenewModalOpen(false)}
                  disabled={renewLoading}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleRenewSubscription}
                  disabled={renewLoading}
                >
                  {renewLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Procesando...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      {isActive ? "Extender" : "Activar"}
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
