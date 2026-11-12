"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Check, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import { m, LazyMotion, domAnimation } from "@/components/animations/motion"
import { revealHeader, revealStagger, revealFocal } from "./reveal"
import type { PlanPrices, AllPlansPrices } from "@/lib/pricing"
import {
  FALLBACK_ALL_PLANS,
  PLAN_FEATURES,
  featuresGained,
  featuresIncluded,
  freeOrdersText,
  getFreePlanInfo,
} from "@/lib/plan-copy"

interface PlanFeature {
  text: string
  highlight?: string
}

interface Plan {
  name: string
  slug: string
  description: string
  priceMultiplier: number
  badge?: string
  recommended?: boolean
  features: PlanFeature[]
  cta: string
  ctaHref: string
  ctaVariant: "outline" | "default"
}

const WHATSAPP_FEATURE = PLAN_FEATURES.find((f) => f.key === "whatsapp_notifications")?.label

// Bullets de las cards derivados de la tabla `plans` (ver lib/plan-copy.ts):
// el Free lista lo que incluye y el Profesional lo que suma, sin funciones
// tachadas. La tabla completa vive en /precios.
function buildPlans(allPlans: AllPlansPrices | undefined): Plan[] {
  const free = allPlans?.free ?? FALLBACK_ALL_PLANS.free
  const pro = allPlans?.profesional ?? FALLBACK_ALL_PLANS.profesional
  const freeInfo = getFreePlanInfo(allPlans)

  const proFeatures: PlanFeature[] = []
  const { ordenes, tecnicos, clientes, sucursales } = pro.limits
  if (ordenes == null && tecnicos == null && clientes == null) {
    proFeatures.push({ text: "Reparaciones, técnicos y clientes sin límite" })
  }
  if (sucursales != null && sucursales > 1) {
    proFeatures.push({ text: `Hasta ${sucursales} sucursales` })
  }
  for (const text of featuresGained(pro, free).slice(0, 4)) {
    proFeatures.push(text === WHATSAPP_FEATURE ? { text, highlight: "Diferencial" } : { text })
  }

  return [
    {
      name: "Free",
      slug: "free",
      description: "Para arrancar y conocer STApp",
      priceMultiplier: 0,
      features: [
        { text: freeOrdersText(freeInfo.limits) },
        ...featuresIncluded(free).map((text) => ({ text })),
        { text: "Inventario y caja diaria" },
      ],
      cta: "Comenzar gratis",
      ctaHref: "/registro",
      ctaVariant: "outline",
    },
    {
      name: "Profesional",
      slug: "profesional",
      description: "Todo lo del Free, más:",
      priceMultiplier: 1,
      badge: "Más popular",
      recommended: true,
      features: proFeatures,
      cta: "Probar gratis",
      ctaHref: "/registro?plan=profesional",
      ctaVariant: "default",
    },
  ]
}

function formatPrice(price: number): string {
  if (price === 0) return "0"
  return price.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")
}

function roundToNice(n: number): number {
  if (n < 1000) return Math.round(n / 100) * 100
  return Math.round(n / 500) * 500
}

interface PricingSectionProps {
  prices: PlanPrices
  allPlans?: AllPlansPrices
  /** En /precios la tabla está debajo: no tiene sentido linkear a sí misma. */
  showComparisonLink?: boolean
}

export function PricingSection({ prices, allPlans, showComparisonLink = true }: PricingSectionProps) {
  const [annual, setAnnual] = useState(false)

  // Base: precios del plan Profesional (el del medio)
  const basePriceArs = annual ? Math.round(prices.ars.yearly / 12) : prices.ars.monthly
  const plans = buildPlans(allPlans)
  const savingsPercent = Math.round(
    ((prices.ars.monthly * 12 - prices.ars.yearly) / (prices.ars.monthly * 12)) * 100
  )

  // Helper: obtener precio de un plan.
  // Si hay allPlans en la DB, usa el precio real. Si no, fallback a multiplier.
  // Solo ARS: el único medio de cobro es MercadoPago en pesos.
  const getPlanPrice = (plan: Plan): number => {
    // Plan gratuito siempre $0
    if (plan.priceMultiplier === 0) return 0

    if (allPlans && allPlans[plan.slug]) {
      const dbPlan = allPlans[plan.slug]
      return annual ? Math.round(dbPlan.ars.yearly / 12) : dbPlan.ars.monthly
    }
    // Fallback: derivar del precio base con multiplier
    return plan.priceMultiplier === 1
      ? basePriceArs
      : roundToNice(basePriceArs * plan.priceMultiplier)
  }

  return (
    <LazyMotion features={domAnimation}>
      <section id="pricing" className="py-10 sm:py-12 overflow-hidden">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <m.div
            className="text-center max-w-3xl mx-auto mb-10"
            variants={revealHeader}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "0px" }}
          >
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-balance text-foreground mb-4">
              Cuesta menos que una reparación al mes
            </h2>
            <p className="text-lg text-muted-foreground">
              Probá el plan Profesional 30 días gratis, sin tarjeta. Después decidís.
            </p>
          </m.div>

          {/* Billing toggle */}
          <div className="flex items-center justify-center gap-2 sm:gap-3 mb-10">
            <span
              className={cn(
                "text-sm font-medium transition-colors",
                !annual ? "text-foreground" : "text-muted-foreground"
              )}
            >
              Mensual
            </span>
            <Switch
              checked={annual}
              onCheckedChange={setAnnual}
              aria-label="Cambiar entre facturación mensual y anual"
            />
            <span
              className={cn(
                "text-sm font-medium transition-colors",
                annual ? "text-foreground" : "text-muted-foreground"
              )}
            >
              Anual{" "}
              <span className="text-green-600 dark:text-green-400 font-semibold">
                (-{savingsPercent}%)
              </span>
            </span>
          </div>

          {/* Plans grid: cards focales que se presentan con leve scale, escalonadas */}
          <m.div
            className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto items-start"
            variants={revealStagger}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "0px" }}
          >
            {plans.map((plan) => {
              const priceArs = getPlanPrice(plan)

              return (
                <m.div
                  key={plan.slug}
                  className={cn(
                    "relative rounded-2xl bg-card border-2 p-6 sm:p-8 transition-colors flex flex-col",
                    plan.recommended
                      ? "border-primary shadow-xl md:-mt-4 md:mb-0 md:pb-10"
                      : "border-border/50 shadow-sm hover:border-border"
                  )}
                  variants={revealFocal}
                >
                  {/* Badge */}
                  {plan.badge && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                      <span className="bg-primary text-primary-foreground text-xs font-bold px-4 py-1.5 rounded-full inline-flex items-center gap-1.5 whitespace-nowrap">
                        <Zap className="w-3 h-3" />
                        {plan.badge}
                      </span>
                    </div>
                  )}

                  {/* Plan name */}
                  <div className="text-center mb-5 pt-1">
                    <h3 className="text-xl font-bold text-foreground">{plan.name}</h3>
                    <p className="text-sm text-muted-foreground">{plan.description}</p>
                  </div>

                  {/* Price ARS */}
                  <div className="text-center mb-6">
                    <div className="flex items-baseline justify-center gap-1">
                      <m.span
                        key={`${plan.slug}-${priceArs}`}
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ type: "spring", stiffness: 300, damping: 20 }}
                        className={cn(
                          "font-bold text-foreground",
                          plan.recommended ? "text-5xl" : "text-4xl"
                        )}
                      >
                        ${formatPrice(priceArs)}
                      </m.span>
                      <span className="text-muted-foreground text-sm">/mes</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">ARS</p>
                  </div>

                  {/* CTA */}
                  <Button
                    asChild
                    className={cn("w-full mb-6", plan.recommended && "shadow-lg")}
                    size="lg"
                    variant={plan.ctaVariant}
                  >
                    <Link href={plan.ctaHref}>{plan.cta}</Link>
                  </Button>

                  {/* Features */}
                  <div className="border-t pt-5 flex-1">
                    <ul className="space-y-2.5">
                      {plan.features.map((feature) => (
                        <li key={feature.text} className="flex items-start gap-2 text-sm">
                          <Check className="w-4 h-4 flex-shrink-0 text-success-600 mt-0.5" aria-hidden="true" />
                          <span>{feature.text}</span>
                          {feature.highlight && (
                            <span className="text-xs font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full ml-auto flex-shrink-0">
                              {feature.highlight}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                </m.div>
              )
            })}
          </m.div>

          {/* Trust signals */}
          <div className="text-center mt-10 space-y-4">
            <p className="text-sm text-muted-foreground">
              Si no te convence en 30 días, no pagás nada. Sin preguntas, sin vueltas.
            </p>
            {showComparisonLink && (
              <p className="text-sm">
                <Link href="/precios#comparacion" className="font-medium text-primary hover:underline">
                  Ver la comparación completa de planes
                </Link>
              </p>
            )}
            <m.div
              className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
              whileHover={{ scale: 1.05 }}
              transition={{ type: "spring", stiffness: 400, damping: 17 }}
            >
              <span>Pagos seguros con</span>
              <Image
                src="/Mercado_Pago.svg.png"
                alt="MercadoPago - Pagos seguros para suscripción de software de servicio técnico"
                width={100}
                height={28}
                className="inline-block"
                loading="lazy"
              />
            </m.div>
          </div>
        </div>
      </section>
    </LazyMotion>
  )
}
