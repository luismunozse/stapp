"use client"

import { useState, useEffect } from "react"
import { signOut } from "next-auth/react"

import { Clock, AlertTriangle, CreditCard, LogOut, Sparkles, Check, CheckCircle2, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { BusinessLogo } from "@/components/shared/business-logo"
import { UpgradeModal } from "@/components/billing/upgrade-modal"

interface SubscriptionRequiredViewProps {
  reason?: "trial_expired" | "canceled" | "past_due"
  planNombre?: string
  hasAccess?: boolean
  daysRemaining?: number
}

const reasonMessages = {
  trial_expired: {
    icon: Clock,
    title: "Tu período de prueba ha terminado",
    description: "Han pasado 30 días desde que comenzaste a usar STApp. Para continuar accediendo a todas las funcionalidades, necesitas activar tu suscripción.",
    color: "text-yellow-500",
  },
  canceled: {
    icon: AlertTriangle,
    title: "Tu suscripción fue cancelada",
    description: "Tu suscripción ha sido cancelada. Para volver a acceder a STApp, necesitas reactivar tu plan.",
    color: "text-red-500",
  },
  past_due: {
    icon: CreditCard,
    title: "Pago pendiente",
    description: "No pudimos procesar tu último pago. Por favor, actualiza tu método de pago para continuar usando STApp.",
    color: "text-orange-500",
  },
}

const premiumFeatures = [
  "Órdenes ilimitadas",
  "Técnicos y vendedores ilimitados",
  "Clientes ilimitados",
  "Reportes avanzados",
  "Exportación de datos",
  "Notificaciones WhatsApp",
  "Logo personalizado",
  "5GB de almacenamiento",
  "Soporte prioritario",
]

export function SubscriptionRequiredView({
  reason = "trial_expired",
  planNombre,
  hasAccess = false,
  daysRemaining = 0,
}: SubscriptionRequiredViewProps) {
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false)
  const [pricesArs, setPricesArs] = useState({ monthly: 19999, yearly: 191990 })
  const [pricesUsd, setPricesUsd] = useState({ monthly: 14, yearly: 134 })
  const message = hasAccess ? null : reasonMessages[reason]
  const Icon = message?.icon || CheckCircle2

  useEffect(() => {
    fetch("/api/subscriptions")
      .then((res) => res.json())
      .then((data) => {
        const plan = data.plans?.find((p: any) => p.tipo === "PREMIUM")
        if (plan) {
          setPricesArs({ monthly: Number(plan.precio_mensual), yearly: Number(plan.precio_anual) })
          if (plan.precio_mensual_usd) {
            setPricesUsd({ monthly: Number(plan.precio_mensual_usd), yearly: Number(plan.precio_anual_usd) })
          }
        }
      })
      .catch(() => {})
  }, [])

  const formatArs = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  const savingsPercent = Math.round(((pricesArs.monthly * 12 - pricesArs.yearly) / (pricesArs.monthly * 12)) * 100)

  const handleLogout = async () => {
    await signOut({ redirect: false })
    window.location.href = "/login"
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/30 flex flex-col">
      {/* Header */}
      <header className="p-4 border-b">
        <div className="container max-w-6xl mx-auto flex items-center justify-between">
          <BusinessLogo size="sm" showText />
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" />
            Cerrar sesión
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container max-w-4xl mx-auto py-12 px-4">
        {hasAccess ? (
          <div className="text-center mb-8">
            <div className="inline-flex p-4 rounded-full bg-green-100 dark:bg-green-950 mb-4 text-green-600">
              <CheckCircle2 className="h-12 w-12" />
            </div>
            <h1 className="text-3xl font-bold mb-2">¡Tu cuenta está activa!</h1>
            <p className="text-muted-foreground max-w-xl mx-auto mb-2">
              Tenés {daysRemaining} día{daysRemaining !== 1 ? "s" : ""} de prueba restantes. Aprovechá para conocer todas las funcionalidades.
            </p>
            <Button size="lg" className="mt-4" onClick={() => window.location.href = "/dashboard"}>
              Ir a mi taller
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
            <p className="text-sm text-muted-foreground mt-6">
              ¿Querés acceso permanente? Suscribite al plan Premium:
            </p>
          </div>
        ) : (
          <div className="text-center mb-8">
            <div className={`inline-flex p-4 rounded-full bg-muted mb-4 ${message!.color}`}>
              <Icon className="h-12 w-12" />
            </div>
            <h1 className="text-3xl font-bold mb-2">{message!.title}</h1>
            <p className="text-muted-foreground max-w-xl mx-auto">{message!.description}</p>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          {/* Plan Card */}
          <Card className="border-2 border-primary">
            <CardHeader className="text-center pb-2">
              <div className="inline-flex items-center justify-center gap-2 text-primary mb-2">
                <Sparkles className="h-5 w-5" />
                <span className="text-sm font-medium">RECOMENDADO</span>
              </div>
              <CardTitle className="text-2xl">Plan Premium</CardTitle>
              <CardDescription>Todo lo que necesitas para tu negocio</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="text-center">
                <div className="text-4xl font-bold">${formatArs(pricesArs.monthly)}</div>
                <div className="text-sm text-muted-foreground">ARS / mes</div>
                <div className="text-xs text-muted-foreground mt-0.5">🇦🇷 Argentina</div>
                <div className="text-sm text-green-600 mt-1">
                  o ${formatArs(pricesArs.yearly)}/año (ahorra {savingsPercent}%)
                </div>
                <div className="mt-3 pt-3 border-t border-dashed">
                  <p className="text-xs text-muted-foreground mb-1">Latinoamérica y el mundo</p>
                  <div className="text-2xl font-bold">USD ${pricesUsd.monthly}</div>
                  <div className="text-sm text-muted-foreground">/mes</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Tarjeta internacional</div>
                </div>
              </div>

              <ul className="space-y-2">
                {premiumFeatures.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm">
                    <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>

              <Button className="w-full" size="lg" onClick={() => setUpgradeModalOpen(true)}>
                <CreditCard className="h-4 w-4 mr-2" />
                Activar suscripción
              </Button>
            </CardContent>
          </Card>

          {/* Info Card */}
          <Card>
            <CardHeader>
              <CardTitle>Preguntas frecuentes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-medium mb-1">¿Qué pasa con mis datos?</h4>
                <p className="text-sm text-muted-foreground">
                  Tus datos están seguros. Una vez que actives tu suscripción, podrás acceder a toda tu información sin perder nada.
                </p>
              </div>
              <div>
                <h4 className="font-medium mb-1">¿Puedo pagar con tarjeta?</h4>
                <p className="text-sm text-muted-foreground">
                  Sí, aceptamos tarjetas de crédito y débito. En Argentina a través de MercadoPago, y para otros países con tarjeta internacional.
                </p>
              </div>
              <div>
                <h4 className="font-medium mb-1">¿Puedo cancelar en cualquier momento?</h4>
                <p className="text-sm text-muted-foreground">
                  Sí, puedes cancelar tu suscripción cuando quieras. Seguirás teniendo acceso hasta el final del período pagado.
                </p>
              </div>
              <div>
                <h4 className="font-medium mb-1">¿Necesito ayuda?</h4>
                <p className="text-sm text-muted-foreground">
                  Contáctanos por WhatsApp y te ayudaremos con cualquier duda sobre tu suscripción.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Footer */}
      <footer className="p-4 border-t text-center text-sm text-muted-foreground">
        <p>¿Tienes preguntas? Contáctanos y te ayudamos.</p>
      </footer>

      {/* Modal de pago */}
      <UpgradeModal
        open={upgradeModalOpen}
        onClose={() => setUpgradeModalOpen(false)}
      />
    </div>
  )
}
