"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Check, X } from "lucide-react"
import { cn } from "@/lib/utils"

const plans = [
  {
    name: "Free",
    description: "Para empezar a organizar tu taller",
    priceMonthly: 0,
    priceYearly: 0,
    features: [
      { name: "Hasta 50 órdenes/mes", included: true },
      { name: "2 técnicos", included: true },
      { name: "100 clientes", included: true },
      { name: "Reportes básicos", included: true },
      { name: "100MB almacenamiento", included: true },
      { name: "Soporte por email", included: true },
      { name: "Órdenes ilimitadas", included: false },
      { name: "Notificaciones WhatsApp", included: false },
      { name: "Logo personalizado", included: false },
      { name: "Soporte prioritario", included: false },
    ],
    cta: "Comenzar Gratis",
    popular: false,
  },
  {
    name: "Premium",
    description: "Para talleres en crecimiento",
    priceMonthly: 14999,
    priceYearly: 143990,
    features: [
      { name: "Órdenes ilimitadas", included: true },
      { name: "Técnicos ilimitados", included: true },
      { name: "Clientes ilimitados", included: true },
      { name: "Reportes avanzados", included: true },
      { name: "5GB almacenamiento", included: true },
      { name: "Soporte prioritario", included: true },
      { name: "Notificaciones WhatsApp", included: true },
      { name: "Logo personalizado", included: true },
      { name: "Exportación de datos", included: true },
      { name: "API acceso", included: true },
    ],
    cta: "Actualizar a Premium",
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
    <section id="pricing" className="py-20">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
            Precios simples y transparentes
          </h2>
          <p className="text-lg text-gray-600 mb-8">
            Comienza gratis y actualiza cuando lo necesites. Sin costos ocultos.
          </p>

          {/* Billing toggle */}
          <div className="flex items-center justify-center gap-4">
            <span
              className={cn(
                "text-sm font-medium",
                !annual ? "text-gray-900" : "text-gray-500"
              )}
            >
              Mensual
            </span>
            <button
              type="button"
              onClick={() => setAnnual(!annual)}
              className={cn(
                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                annual ? "bg-primary" : "bg-gray-200"
              )}
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                  annual ? "translate-x-6" : "translate-x-1"
                )}
              />
            </button>
            <span
              className={cn(
                "text-sm font-medium",
                annual ? "text-gray-900" : "text-gray-500"
              )}
            >
              Anual{" "}
              <span className="text-green-600 font-semibold">
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
                  : "bg-white border shadow-sm"
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
                    plan.popular ? "text-white" : "text-gray-900"
                  )}
                >
                  {plan.name}
                </h3>
                <p
                  className={cn(
                    "text-sm",
                    plan.popular ? "text-white/80" : "text-gray-500"
                  )}
                >
                  {plan.description}
                </p>
              </div>

              <div className="mb-6">
                <span
                  className={cn(
                    "text-4xl font-bold",
                    plan.popular ? "text-white" : "text-gray-900"
                  )}
                >
                  {plan.priceMonthly === 0 ? (
                    "$0"
                  ) : (
                    <>
                      $
                      {formatPrice(
                        annual
                          ? Math.round(plan.priceYearly / 12)
                          : plan.priceMonthly
                      )}
                    </>
                  )}
                </span>
                <span
                  className={cn(
                    "text-sm",
                    plan.popular ? "text-white/80" : "text-gray-500"
                  )}
                >
                  /mes
                </span>
                {annual && plan.priceYearly > 0 && (
                  <p
                    className={cn(
                      "text-xs mt-1",
                      plan.popular ? "text-white/60" : "text-gray-400"
                    )}
                  >
                    Facturado anualmente (${formatPrice(plan.priceYearly)})
                  </p>
                )}
              </div>

              <Link href={plan.name === "Free" ? "/registro" : "/registro"}>
                <Button
                  className={cn(
                    "w-full mb-6",
                    plan.popular
                      ? "bg-white text-primary hover:bg-gray-100"
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
                          plan.popular ? "text-white/40" : "text-gray-300"
                        )}
                      />
                    )}
                    <span
                      className={cn(
                        "text-sm",
                        !feature.included &&
                          (plan.popular ? "text-white/40" : "text-gray-400")
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

        {/* Money back guarantee */}
        <p className="text-center text-sm text-gray-500 mt-12">
          Garantía de devolución de 30 días. Cancela cuando quieras.
        </p>
      </div>
    </section>
  )
}
