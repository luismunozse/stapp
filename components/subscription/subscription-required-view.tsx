"use client"

import { useState, useEffect } from "react"
import { signOut } from "next-auth/react"

import { Clock, AlertTriangle, CreditCard, LogOut, Check, X, CheckCircle2, ArrowRight, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { BusinessLogo } from "@/components/shared/business-logo"
import { UpgradeModal } from "@/components/billing/upgrade-modal"
import { cn } from "@/lib/utils"

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
    description: "Han pasado 30 días desde que comenzaste a usar STApp. Elegí un plan para continuar.",
    color: "text-yellow-500",
  },
  canceled: {
    icon: AlertTriangle,
    title: "Tu suscripción fue cancelada",
    description: "Tu suscripción ha sido cancelada. Para volver a acceder a STApp, elegí un plan.",
    color: "text-red-500",
  },
  past_due: {
    icon: CreditCard,
    title: "Pago pendiente",
    description: "No pudimos procesar tu último pago. Elegí un plan para continuar.",
    color: "text-orange-500",
  },
}

interface PlanCardData {
  slug: string
  name: string
  description: string
  recommended?: boolean
  features: { text: string; included: boolean }[]
  ctaVariant: "outline" | "default"
  priceMultiplier: number // fallback si no hay precios reales
}

const planCards: PlanCardData[] = [
  {
    slug: "emprendedor",
    name: "Emprendedor",
    description: "Para talleres que recién arrancan",
    priceMultiplier: 0.55,
    features: [
      { text: "30 órdenes/mes", included: true },
      { text: "1 técnico", included: true },
      { text: "Clientes ilimitados", included: true },
      { text: "1GB almacenamiento", included: true },
      { text: "Punto de venta", included: true },
      { text: "Reportes avanzados", included: false },
      { text: "Notificaciones WhatsApp", included: false },
      { text: "Portal de seguimiento", included: false },
    ],
    ctaVariant: "outline",
  },
  {
    slug: "profesional",
    name: "Profesional",
    description: "Todo lo que tu taller necesita",
    priceMultiplier: 1,
    recommended: true,
    features: [
      { text: "Órdenes ilimitadas", included: true },
      { text: "Técnicos ilimitados", included: true },
      { text: "Clientes ilimitados", included: true },
      { text: "5GB almacenamiento", included: true },
      { text: "Punto de venta completo", included: true },
      { text: "15+ reportes avanzados", included: true },
      { text: "Notificaciones WhatsApp", included: true },
      { text: "Portal de seguimiento", included: true },
    ],
    ctaVariant: "default",
  },
  {
    slug: "taller-plus",
    name: "Taller+",
    description: "Para talleres con alto volumen",
    priceMultiplier: 1.8,
    features: [
      { text: "Todo de Profesional", included: true },
      { text: "20GB almacenamiento", included: true },
      { text: "Soporte dedicado", included: true },
      { text: "Onboarding personalizado", included: true },
      { text: "Backup descargable", included: true },
    ],
    ctaVariant: "outline",
  },
]

function formatArs(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")
}

function roundToNice(n: number): number {
  if (n < 1000) return Math.round(n / 100) * 100
  return Math.round(n / 500) * 500
}

export function SubscriptionRequiredView({
  reason = "trial_expired",
  hasAccess = false,
  daysRemaining = 0,
}: SubscriptionRequiredViewProps) {
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false)
  const [selectedPlanSlug, setSelectedPlanSlug] = useState<string>("profesional")
  // Map de slug → { monthly, yearly } en ARS. Se llena desde la API.
  const [allPrices, setAllPrices] = useState<Record<string, { monthly: number; yearly: number }>>({})
  // Base: precio Profesional (para fallback con multiplier)
  const [baseProfesionalPrice, setBaseProfesionalPrice] = useState({ monthly: 19999, yearly: 191990 })

  const message = hasAccess ? null : reasonMessages[reason]
  const Icon = message?.icon || CheckCircle2

  useEffect(() => {
    fetch("/api/subscriptions")
      .then((res) => res.json())
      .then((data) => {
        const plansList: any[] = data.plans || []
        const prices: Record<string, { monthly: number; yearly: number }> = {}
        for (const p of plansList) {
          if (!p.slug) continue
          prices[p.slug] = {
            monthly: Number(p.precio_mensual),
            yearly: Number(p.precio_anual),
          }
        }
        setAllPrices(prices)
        // Capturar precio base del plan profesional
        const profesional = plansList.find((p) => p.slug === "profesional") ||
                            plansList.find((p) => p.tipo === "PREMIUM")
        if (profesional) {
          setBaseProfesionalPrice({
            monthly: Number(profesional.precio_mensual),
            yearly: Number(profesional.precio_anual),
          })
        }
      })
      .catch(() => {})
  }, [])

  const getPlanPrice = (card: PlanCardData): number => {
    if (allPrices[card.slug]) {
      return allPrices[card.slug].monthly
    }
    // Fallback: derivar del precio base con multiplier
    if (card.priceMultiplier === 1) return baseProfesionalPrice.monthly
    return roundToNice(baseProfesionalPrice.monthly * card.priceMultiplier)
  }

  const handleSelectPlan = (slug: string) => {
    if (slug === "taller-plus") {
      window.open(
        "https://wa.me/5491112345678?text=Hola,%20quiero%20activar%20el%20plan%20Taller%2B",
        "_blank"
      )
      return
    }
    setSelectedPlanSlug(slug)
    setUpgradeModalOpen(true)
  }

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
      <main className="flex-1 container max-w-6xl mx-auto py-8 px-4">
        {hasAccess ? (
          <div className="text-center mb-8">
            <div className="inline-flex p-4 rounded-full bg-green-100 dark:bg-green-950 mb-4 text-green-600">
              <CheckCircle2 className="h-12 w-12" />
            </div>
            <h1 className="text-3xl font-bold mb-2">¡Tu cuenta está activa!</h1>
            <p className="text-muted-foreground max-w-xl mx-auto mb-2">
              Tenés {daysRemaining} día{daysRemaining !== 1 ? "s" : ""} de prueba restantes. Aprovechá para conocer todas las funcionalidades.
            </p>
            <Button size="lg" className="mt-4" onClick={() => (window.location.href = "/dashboard")}>
              Ir a mi taller
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
            <p className="text-sm text-muted-foreground mt-6">
              ¿Querés acceso permanente? Elegí un plan:
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

        {/* 3-tier plan grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto items-start">
          {planCards.map((card) => {
            const priceArs = getPlanPrice(card)
            return (
              <Card
                key={card.slug}
                className={cn(
                  "relative border-2 transition-colors flex flex-col",
                  card.recommended
                    ? "border-primary shadow-xl md:-mt-4 md:pb-6"
                    : "border-border/50 shadow-sm hover:border-border"
                )}
              >
                {card.recommended && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <span className="bg-primary text-primary-foreground text-xs font-bold px-4 py-1.5 rounded-full inline-flex items-center gap-1.5 whitespace-nowrap">
                      <Zap className="w-3 h-3" />
                      Más popular
                    </span>
                  </div>
                )}
                <CardContent className="p-6 flex flex-col flex-1">
                  <div className="text-center mb-5 pt-1">
                    <h3 className="text-xl font-bold text-foreground">{card.name}</h3>
                    <p className="text-sm text-muted-foreground">{card.description}</p>
                  </div>

                  <div className="text-center mb-6">
                    <div className="flex items-baseline justify-center gap-1">
                      <span
                        className={cn(
                          "font-bold text-foreground",
                          card.recommended ? "text-4xl" : "text-3xl"
                        )}
                      >
                        ${formatArs(priceArs)}
                      </span>
                      <span className="text-muted-foreground text-sm">/mes</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">ARS</p>
                  </div>

                  <Button
                    className={cn("w-full mb-5", card.recommended && "shadow-lg")}
                    size="lg"
                    variant={card.ctaVariant}
                    onClick={() => handleSelectPlan(card.slug)}
                  >
                    {card.slug === "taller-plus" ? (
                      "Contactar Ventas"
                    ) : (
                      <>
                        <CreditCard className="h-4 w-4 mr-2" />
                        Activar {card.name}
                      </>
                    )}
                  </Button>

                  <ul className="space-y-2 border-t pt-4 flex-1">
                    {card.features.map((feature) => (
                      <li
                        key={feature.text}
                        className={cn(
                          "flex items-start gap-2 text-sm",
                          !feature.included && "text-muted-foreground/50"
                        )}
                      >
                        {feature.included ? (
                          <Check className="w-4 h-4 flex-shrink-0 text-green-500 mt-0.5" />
                        ) : (
                          <X className="w-4 h-4 flex-shrink-0 text-muted-foreground/40 mt-0.5" />
                        )}
                        <span className={cn(!feature.included && "line-through")}>
                          {feature.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )
          })}
        </div>

        <div className="text-center text-sm text-muted-foreground mt-8 space-y-1">
          <p>Tus datos están seguros — no los perdés al cambiar de plan.</p>
          <p>Podés cancelar en cualquier momento. Sin cargos ocultos.</p>
        </div>
      </main>

      {/* Footer */}
      <footer className="p-4 border-t text-center text-sm text-muted-foreground">
        <p>¿Tenés preguntas? Contactanos y te ayudamos.</p>
      </footer>

      {/* Modal de pago */}
      <UpgradeModal
        open={upgradeModalOpen}
        onClose={() => setUpgradeModalOpen(false)}
        planSlug={selectedPlanSlug}
      />
    </div>
  )
}
