"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

const features = [
  "Órdenes ilimitadas",
  "Técnicos ilimitados",
  "Vendedores ilimitados",
  "Clientes ilimitados",
  "Reportes avanzados",
  "5GB almacenamiento",
  "Soporte prioritario",
  "Notificaciones WhatsApp",
  "Logo personalizado",
  "Exportación de datos",
]

const prices = {
  monthly: 14999,
  yearly: 143990,
}

// Formatear precio en pesos argentinos (formato fijo para evitar hydration mismatch)
function formatPrice(price: number): string {
  if (price === 0) return "0"
  return price.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")
}

export function PricingSection() {
  const [annual, setAnnual] = useState(false)

  const currentPrice = annual ? Math.round(prices.yearly / 12) : prices.monthly
  const savingsPercent = Math.round(
    ((prices.monthly * 12 - prices.yearly) / (prices.monthly * 12)) * 100
  )

  return (
    <section id="pricing" className="py-12 sm:py-16">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-10">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            Un solo plan, todo incluido
          </h2>
          <p className="text-lg text-muted-foreground">
            Comienza gratis por 30 días. Sin tarjeta de crédito.
          </p>
        </div>

        {/* Single pricing card */}
        <div className="max-w-lg mx-auto">
          <div className="relative rounded-2xl bg-card border shadow-lg p-8">
            {/* Badge */}
            <div className="absolute -top-4 left-1/2 -translate-x-1/2">
              <span className="bg-green-500 text-white text-xs font-bold px-4 py-1.5 rounded-full">
                30 DÍAS GRATIS
              </span>
            </div>

            {/* Plan name */}
            <div className="text-center mb-6 pt-2">
              <h3 className="text-2xl font-bold text-foreground">Plan Premium</h3>
              <p className="text-muted-foreground">
                Todo lo que necesitas para tu taller
              </p>
            </div>

            {/* Billing toggle */}
            <div className="flex items-center justify-center gap-4 mb-6">
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
                  (-{savingsPercent}%)
                </span>
              </span>
            </div>

            {/* Price */}
            <div className="text-center mb-6">
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-5xl font-bold text-foreground">
                  ${formatPrice(currentPrice)}
                </span>
                <span className="text-muted-foreground">/mes</span>
              </div>
              {annual && (
                <p className="text-sm text-muted-foreground mt-1">
                  Facturado anualmente (${formatPrice(prices.yearly)})
                </p>
              )}
              <p className="text-sm text-green-600 dark:text-green-400 mt-2 font-medium">
                Primeros 30 días gratis
              </p>
            </div>

            {/* CTA */}
            <Link href="/registro">
              <Button className="w-full mb-6" size="lg">
                Comenzar 30 días gratis
              </Button>
            </Link>

            <p className="text-xs text-center text-muted-foreground mb-6">
              Sin tarjeta de crédito requerida
            </p>

            {/* Features */}
            <div className="border-t pt-6">
              <p className="text-sm font-medium text-center mb-4">Todo incluido:</p>
              <ul className="grid grid-cols-2 gap-3">
                {features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm">
                    <Check className="w-4 h-4 flex-shrink-0 text-green-500" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Money back guarantee + MercadoPago */}
        <div className="text-center mt-10 space-y-4">
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
