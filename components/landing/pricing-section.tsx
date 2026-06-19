"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Check, X, Globe, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import { m, LazyMotion, domAnimation } from "@/components/animations/motion"
import { revealHeader, revealStagger, revealFocal } from "./reveal"
import type { PlanPrices, AllPlansPrices } from "@/lib/pricing"

interface PlanFeature {
  text: string
  included: boolean
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

const plans: Plan[] = [
  {
    name: "Free",
    slug: "free",
    description: "Para arrancar y conocer STApp",
    priceMultiplier: 0,
    features: [
      { text: "Hasta 15 órdenes/mes", included: true },
      { text: "1 técnico", included: true },
      { text: "Hasta 30 clientes", included: true },
      { text: "1 sucursal", included: true },
      { text: "Inventario básico", included: true },
      { text: "100MB almacenamiento", included: true },
      { text: "Soporte por email", included: true },
      { text: "Punto de venta", included: false },
      { text: "Portal de seguimiento", included: false },
      { text: "Reportes avanzados", included: false },
      { text: "Notificaciones WhatsApp", included: false },
      { text: "Logo personalizado", included: false },
      { text: "Cotizaciones online", included: false },
    ],
    cta: "Comenzar Gratis",
    ctaHref: "/registro",
    ctaVariant: "outline",
  },
  {
    name: "Profesional",
    slug: "profesional",
    description: "Todo lo que tu taller necesita",
    priceMultiplier: 1,
    badge: "Más popular",
    recommended: true,
    features: [
      { text: "Órdenes ilimitadas", included: true },
      { text: "Técnicos ilimitados", included: true },
      { text: "Clientes ilimitados", included: true },
      { text: "Punto de venta con garantías", included: true },
      { text: "Cotizaciones con aprobación online", included: true },
      { text: "Portal de seguimiento para clientes", included: true, highlight: "Diferencial" },
      { text: "Modo kiosco para tu local", included: true },
      { text: "Multi-sucursal (hasta 3)", included: true },
      { text: "Catálogo online + cupones", included: true },
      { text: "Reportes avanzados", included: true },
      { text: "5GB almacenamiento", included: true },
      { text: "Notificaciones WhatsApp", included: true },
      { text: "Cuenta corriente de clientes", included: true },
      { text: "Import/export datos", included: true },
      { text: "Tu logo en presupuestos", included: true, highlight: "Tu marca" },
      { text: "Soporte prioritario", included: true },
    ],
    cta: "Probar gratis 30 días",
    ctaHref: "/registro?plan=profesional",
    ctaVariant: "default",
  },
]

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
}

export function PricingSection({ prices, allPlans }: PricingSectionProps) {
  const [annual, setAnnual] = useState(false)

  // Base: precios del plan Profesional (el del medio)
  const basePriceArs = annual ? Math.round(prices.ars.yearly / 12) : prices.ars.monthly
  const basePriceUsd = annual ? parseFloat((prices.usd.yearly / 12).toFixed(1)) : prices.usd.monthly
  const savingsPercent = Math.round(
    ((prices.ars.monthly * 12 - prices.ars.yearly) / (prices.ars.monthly * 12)) * 100
  )

  // Helper: obtener precio de un plan.
  // Si hay allPlans en la DB, usa el precio real. Si no, fallback a multiplier.
  const getPlanPrice = (plan: Plan): { ars: number; usd: number } => {
    // Plan gratuito siempre $0
    if (plan.priceMultiplier === 0) return { ars: 0, usd: 0 }

    if (allPlans && allPlans[plan.slug]) {
      const dbPlan = allPlans[plan.slug]
      const ars = annual
        ? Math.round(dbPlan.ars.yearly / 12)
        : dbPlan.ars.monthly
      const usd = annual
        ? parseFloat((dbPlan.usd.yearly / 12).toFixed(1))
        : dbPlan.usd.monthly
      return { ars, usd }
    }
    // Fallback: derivar del precio base con multiplier
    const ars = plan.priceMultiplier === 1
      ? basePriceArs
      : roundToNice(basePriceArs * plan.priceMultiplier)
    const usd = plan.priceMultiplier === 1
      ? basePriceUsd
      : Math.round(basePriceUsd * plan.priceMultiplier)
    return { ars, usd }
  }

  return (
    <LazyMotion features={domAnimation}>
      <section id="pricing" className="py-12 sm:py-16 overflow-hidden">
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
              Elegí el plan que mejor se adapte a tu taller
            </h2>
            <p className="text-lg text-muted-foreground">
              30 días gratis con acceso total al plan Profesional. Sin tarjeta de crédito.
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
              const { ars: priceArs, usd: priceUsd } = getPlanPrice(plan)

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
                  <div className="text-center mb-2">
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

                  {/* Price USD */}
                  <div className="text-center mb-6">
                    <m.div
                      key={`usd-${plan.slug}-${priceUsd}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex items-center justify-center gap-1.5 text-muted-foreground"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      <span className="text-sm">USD ${priceUsd}/mes</span>
                    </m.div>
                  </div>

                  {/* CTA */}
                  <Link href={plan.ctaHref} className="block mb-6">
                    <m.div
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      transition={{ type: "spring", stiffness: 400, damping: 17 }}
                    >
                      <Button
                        className={cn("w-full", plan.recommended && "shadow-lg")}
                        size="lg"
                        variant={plan.ctaVariant}
                      >
                        {plan.cta}
                      </Button>
                    </m.div>
                  </Link>

                  {/* Features */}
                  <div className="border-t pt-5 flex-1">
                    <ul className="space-y-2.5">
                      {plan.features.map((feature) => (
                        <li
                          key={feature.text}
                          className={cn(
                            "flex items-start gap-2 text-sm",
                            !feature.included && "text-muted-foreground/70"
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
                          {feature.highlight && (
                            <span className="text-[10px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full ml-auto flex-shrink-0">
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
