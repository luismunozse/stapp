"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { m, LazyMotion, domAnimation } from "@/components/animations/motion"

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
  ars: { monthly: 19999, yearly: 191990 },
  usd: { monthly: 12, yearly: 115 },
}

// Formatear precio (formato fijo para evitar hydration mismatch)
function formatPrice(price: number): string {
  if (price === 0) return "0"
  return price.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")
}

export function PricingSection() {
  const [annual, setAnnual] = useState(false)

  const currentPriceArs = annual ? Math.round(prices.ars.yearly / 12) : prices.ars.monthly
  const currentPriceUsd = annual ? parseFloat((prices.usd.yearly / 12).toFixed(1)) : prices.usd.monthly
  const savingsPercent = Math.round(
    ((prices.ars.monthly * 12 - prices.ars.yearly) / (prices.ars.monthly * 12)) * 100
  )

  return (
    <LazyMotion features={domAnimation}>
      <section id="pricing" className="py-12 sm:py-16 overflow-hidden">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <m.div
            className="text-center max-w-3xl mx-auto mb-10"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              Un solo plan, todo incluido
            </h2>
            <p className="text-lg text-muted-foreground">
              Comienza gratis por 30 días. Sin tarjeta de crédito.
            </p>
          </m.div>

          {/* Single pricing card */}
          <div className="max-w-lg mx-auto">
            <m.div
              className="relative rounded-2xl bg-card border-2 border-primary/20 shadow-xl p-8 hover:border-primary/40 transition-colors"
              initial={{ opacity: 0, y: 40, scale: 0.95 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.6, type: "spring", stiffness: 100 }}
              whileHover={{
                y: -8,
                boxShadow: "0 25px 50px -12px rgba(59, 130, 246, 0.25)",
              }}
            >
              {/* Badge */}
              <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                <m.span
                  className="bg-green-500 text-white text-xs font-bold px-4 py-1.5 rounded-full inline-block"
                  animate={{
                    scale: [1, 1.05, 1],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "easeInOut"
                  }}
                >
                  30 DÍAS GRATIS
                </m.span>
              </div>

              {/* Plan name */}
              <div className="text-center mb-6 pt-2">
                <h3 className="text-2xl font-bold text-foreground">Plan Premium</h3>
                <p className="text-muted-foreground">
                  Todo lo que necesitas para tu taller
                </p>
              </div>

              {/* Billing toggle */}
              <div className="flex items-center justify-center gap-2 sm:gap-3 mb-6">
                <span
                  className={cn(
                    "text-xs sm:text-sm font-medium transition-colors",
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
                    "text-xs sm:text-sm font-medium transition-colors",
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
                  <m.span
                    key={currentPriceArs}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    className="text-5xl font-bold text-foreground"
                  >
                    ${formatPrice(currentPriceArs)}
                  </m.span>
                  <span className="text-muted-foreground">/mes</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  🇦🇷 Precio en pesos argentinos (ARS)
                </p>
                <div className="mt-3 pt-3 border-t border-dashed">
                  <m.div
                    key={`usd-${currentPriceUsd}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-baseline justify-center gap-1"
                  >
                    <span className="text-2xl font-bold text-foreground">USD ${currentPriceUsd}</span>
                    <span className="text-muted-foreground text-sm">/mes</span>
                  </m.div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    🌎 Para el resto de Latinoamérica y otros países
                  </p>
                </div>
                {annual && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Facturado anualmente: ARS ${formatPrice(prices.ars.yearly)} / USD ${prices.usd.yearly}
                  </p>
                )}
                <p className="text-sm text-green-600 dark:text-green-400 mt-3 font-medium">
                  Primeros 30 días gratis
                </p>
              </div>

              {/* CTA */}
              <Link href="/registro">
                <m.div
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 400, damping: 17 }}
                >
                  <Button className="w-full mb-6" size="lg">
                    Comenzar 30 días gratis
                  </Button>
                </m.div>
              </Link>

              <p className="text-xs text-center text-muted-foreground mb-6">
                Sin tarjeta de crédito requerida
              </p>

              {/* Features */}
              <div className="border-t pt-6">
                <p className="text-sm font-medium text-center mb-4">Todo incluido:</p>
                <ul className="grid grid-cols-2 gap-3">
                  {features.map((feature) => (
                    <m.li
                      key={feature}
                      className="flex items-center gap-2 text-sm list-none"
                      whileHover={{ x: 3 }}
                      transition={{ type: "spring", stiffness: 400, damping: 17 }}
                    >
                      <Check className="w-4 h-4 flex-shrink-0 text-green-500" />
                      <span>{feature}</span>
                    </m.li>
                  ))}
                </ul>
              </div>
            </m.div>
          </div>

          {/* Money back guarantee + MercadoPago */}
          <div className="text-center mt-10 space-y-4">
            <p className="text-sm text-muted-foreground">
              Garantía de devolución de 30 días. Cancela cuando quieras.
            </p>
            <m.div
              className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
              whileHover={{ scale: 1.05 }}
              transition={{ type: "spring", stiffness: 400, damping: 17 }}
            >
              <span>Pagos seguros con</span>
              <Image
                src="/Mercado_Pago.svg.png"
                alt="MercadoPago"
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
