"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Check, X } from "lucide-react"
import { cn } from "@/lib/utils"

const plans = [
  {
    name: "Trial 30 días",
    description: "Prueba todas las funciones sin compromiso",
    priceMonthly: 0,
    priceYearly: 0,
    isTrial: true,
    features: [
      { name: "Todas las funciones Premium", included: true },
      { name: "Órdenes ilimitadas", included: true },
      { name: "Técnicos ilimitados", included: true },
      { name: "Vendedores ilimitados", included: true },
      { name: "Clientes ilimitados", included: true },
      { name: "Reportes avanzados", included: true },
      { name: "Notificaciones WhatsApp", included: true },
      { name: "Sin tarjeta de crédito", included: true },
    ],
    cta: "Comenzar prueba gratis",
    popular: false,
  },
  {
    name: "Premium",
    description: "Para talleres en crecimiento",
    priceMonthly: 14999,
    priceYearly: 143990,
    isTrial: false,
    features: [
      { name: "Órdenes ilimitadas", included: true },
      { name: "Técnicos ilimitados", included: true },
      { name: "Vendedores ilimitados", included: true },
      { name: "Clientes ilimitados", included: true },
      { name: "Reportes avanzados", included: true },
      { name: "5GB almacenamiento", included: true },
      { name: "Soporte prioritario", included: true },
      { name: "Notificaciones WhatsApp", included: true },
      { name: "Logo personalizado", included: true },
      { name: "Exportación de datos", included: true },
    ],
    cta: "Suscribirse ahora",
    popular: true,
  },
]

// Formatear precio en pesos argentinos (formato fijo para evitar hydration mismatch)
function formatPrice(price: number): string {
  if (price === 0) return "0"
  // Usar formato fijo con separador de miles para consistencia servidor/cliente
  return price.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")
}

export function PricingSection() {
  const [annual, setAnnual] = useState(false)

  return (
    <section id="pricing" className="py-6 sm:py-8">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-6">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            Precios simples y transparentes
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Prueba gratis por 30 días. Sin tarjeta de crédito requerida.
          </p>

          {/* Billing toggle */}
          <div className="flex items-center justify-center gap-4">
            <span
              className={cn(
                "text-sm font-medium",
                !annual ? "text-foreground" : "text-muted-foreground"
              )}
            >
              Mensual
            </span>
            <button
              type="button"
              onClick={() => setAnnual(!annual)}
              className={cn(
                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                annual ? "bg-primary" : "bg-muted"
              )}
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 transform rounded-full bg-background transition-transform",
                  annual ? "translate-x-6" : "translate-x-1"
                )}
              />
            </button>
            <span
              className={cn(
                "text-sm font-medium",
                annual ? "text-foreground" : "text-muted-foreground"
              )}
            >
              Anual{" "}
              <span className="text-green-600 dark:text-green-400 font-semibold">
                (Ahorra 20%)
              </span>
            </span>
          </div>
        </div>

        {/* Pricing cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={cn(
                "relative rounded-2xl p-8",
                plan.popular
                  ? "bg-primary text-white shadow-xl scale-105"
                  : "bg-card border shadow-sm"
              )}
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <span className="bg-yellow-400 text-yellow-900 text-xs font-bold px-3 py-1 rounded-full">
                    MÁS POPULAR
                  </span>
                </div>
              )}

              <div className="mb-6">
                <h3
                  className={cn(
                    "text-2xl font-bold mb-2",
                    plan.popular ? "text-white" : "text-foreground"
                  )}
                >
                  {plan.name}
                </h3>
                <p
                  className={cn(
                    "text-sm",
                    plan.popular ? "text-white/80" : "text-muted-foreground"
                  )}
                >
                  {plan.description}
                </p>
              </div>

              <div className="mb-6">
                {plan.isTrial ? (
                  <>
                    <span
                      className={cn(
                        "text-4xl font-bold",
                        plan.popular ? "text-white" : "text-foreground"
                      )}
                    >
                      Gratis
                    </span>
                    <p
                      className={cn(
                        "text-sm mt-1",
                        plan.popular ? "text-white/80" : "text-muted-foreground"
                      )}
                    >
                      por 30 días
                    </p>
                  </>
                ) : (
                  <>
                    <span
                      className={cn(
                        "text-4xl font-bold",
                        plan.popular ? "text-white" : "text-foreground"
                      )}
                    >
                      $
                      {formatPrice(
                        annual
                          ? Math.round(plan.priceYearly / 12)
                          : plan.priceMonthly
                      )}
                    </span>
                    <span
                      className={cn(
                        "text-sm",
                        plan.popular ? "text-white/80" : "text-muted-foreground"
                      )}
                    >
                      /mes
                    </span>
                    {annual && plan.priceYearly > 0 && (
                      <p
                        className={cn(
                          "text-xs mt-1",
                          plan.popular ? "text-white/60" : "text-muted-foreground"
                        )}
                      >
                        Facturado anualmente (${formatPrice(plan.priceYearly)})
                      </p>
                    )}
                  </>
                )}
              </div>

              <Link href="/registro">
                <Button
                  className={cn(
                    "w-full mb-6",
                    plan.popular
                      ? "bg-white text-primary hover:bg-white/90"
                      : ""
                  )}
                  variant={plan.popular ? "secondary" : "default"}
                >
                  {plan.cta}
                </Button>
              </Link>

              <ul className="space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature.name} className="flex items-center gap-3">
                    {feature.included ? (
                      <Check
                        className={cn(
                          "w-5 h-5 flex-shrink-0",
                          plan.popular ? "text-green-300" : "text-green-500"
                        )}
                      />
                    ) : (
                      <X
                        className={cn(
                          "w-5 h-5 flex-shrink-0",
                          plan.popular ? "text-white/40" : "text-muted-foreground/50"
                        )}
                      />
                    )}
                    <span
                      className={cn(
                        "text-sm",
                        !feature.included &&
                          (plan.popular ? "text-white/40" : "text-muted-foreground/50")
                      )}
                    >
                      {feature.name}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Money back guarantee + MercadoPago */}
        <div className="text-center mt-12 space-y-4">
          <p className="text-sm text-muted-foreground">
            Garantía de devolución de 30 días. Cancela cuando quieras.
          </p>
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <span>Pagos seguros con</span>
            <Image
              src="/Mercado_Pago.svg.png"
              alt="MercadoPago"
              width={100}
              height={28}
              className="inline-block"
            />
          </div>
        </div>
      </div>
    </section>
  )
}
