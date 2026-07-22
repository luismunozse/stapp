"use client"

import { useEffect } from "react"
import Image from "next/image"
import Link from "next/link"
import { captureUtmParams } from "@/lib/utm"
import { track } from "@/lib/analytics/track"
import { Button } from "@/components/ui/button"
import { ArrowRight, Check, CheckCircle2, MessageCircle } from "lucide-react"
import type { PlanPrices } from "@/lib/pricing"
import { LazyMotion, domAnimation, m, useReducedMotion } from "framer-motion"

// Formatea con separador de miles (igual que pricing-section): 12500 -> "12.500"
function formatThousands(price: number): string {
  return price.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")
}

const WHATSAPP_DEMO_URL =
  "https://wa.me/5491169625733?text=" +
  encodeURIComponent("Hola! Quiero agendar una demo de STApp para mi taller.")

// ========================================
// FLOATING UI CARDS (mini-componentes reales del producto, no mockups)
// ========================================

function FloatingWhatsAppCard({ reduceMotion }: { reduceMotion: boolean | null }) {
  return (
    <m.div
      className="absolute -right-3 top-6 z-10 w-56 rounded-xl border bg-card p-3 shadow-xl shadow-primary/10 sm:-right-6 sm:top-10 sm:w-64"
      initial={{ opacity: 0, y: 12 }}
      animate={
        reduceMotion
          ? { opacity: 1, y: 0 }
          : { opacity: 1, y: [0, -6, 0] }
      }
      transition={
        reduceMotion
          ? { duration: 0.5, delay: 0.5 }
          : { opacity: { duration: 0.5, delay: 0.5 }, y: { duration: 5, repeat: Infinity, ease: "easeInOut", delay: 0.5 } }
      }
    >
      <div className="flex items-start gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#25D366]">
          <MessageCircle className="h-4 w-4 text-white" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground">Aviso enviado a Juan</p>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
            {"“Tu equipo está listo para retirar. Te esperamos!”"}
          </p>
        </div>
      </div>
    </m.div>
  )
}

function FloatingCobroCard({ reduceMotion }: { reduceMotion: boolean | null }) {
  return (
    <m.div
      className="absolute -left-3 bottom-8 z-10 rounded-xl border bg-card p-3 shadow-xl shadow-primary/10 sm:-left-6 sm:bottom-12"
      initial={{ opacity: 0, y: 12 }}
      animate={
        reduceMotion
          ? { opacity: 1, y: 0 }
          : { opacity: 1, y: [0, 6, 0] }
      }
      transition={
        reduceMotion
          ? { duration: 0.5, delay: 0.7 }
          : { opacity: { duration: 0.5, delay: 0.7 }, y: { duration: 6, repeat: Infinity, ease: "easeInOut", delay: 0.7 } }
      }
    >
      <div className="flex items-center gap-2.5">
        <CheckCircle2 className="h-7 w-7 shrink-0 text-success-600" />
        <div>
          <p className="text-xs font-semibold text-foreground">Cobro registrado</p>
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">$45.000</span> · Orden #128
          </p>
        </div>
      </div>
    </m.div>
  )
}

// ========================================
// MAIN HERO
// ========================================

export function Hero({ prices }: { prices: PlanPrices }) {
  const reduceMotion = useReducedMotion()
  // Capturar UTM params de la URL al cargar la landing
  useEffect(() => { captureUtmParams() }, [])

  // Ancla de precio: piso real = tarifa mensual del plan anual (lo más barato
  // pagando). "Desde" es honesto porque existe Free ($0) y el mensual es mayor.
  const anchorArs = formatThousands(Math.round(prices.ars.yearly / 12))

  return (
    <LazyMotion features={domAnimation}>
      <section className="relative overflow-hidden pt-24 pb-14 sm:pt-28 lg:pt-32 lg:pb-20">
        {/* Fondo: gradiente suave de marca, estilo tech limpio */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-b from-primary/[0.05] via-background to-background"
        />

        <div className="container relative mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-10">
            {/* Columna izquierda: la transformación */}
            <div className="text-center lg:text-left">
              <m.h1
                className="text-4xl font-bold tracking-tight text-balance text-foreground sm:text-5xl lg:text-6xl"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
              >
                Menos caos en tu taller.{" "}
                <span className="text-primary">Más plata a fin de mes.</span>
              </m.h1>

              <m.p
                className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground sm:text-xl lg:mx-0"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
              >
                STApp ordena tus reparaciones, cobros y stock, y avisa solo a
                tus clientes por WhatsApp. Vos dedicate a reparar.
              </m.p>

              <m.div
                className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
              >
                <Link
                  href="/registro?plan=profesional"
                  className="w-full sm:w-auto"
                  onClick={() => track("landing_cta_click", { cta: "hero_primary", label: "Probar gratis" })}
                >
                  <Button
                    size="lg"
                    className="group h-14 w-full rounded-full px-10 text-lg shadow-lg shadow-primary/25 transition-shadow hover:shadow-xl hover:shadow-primary/30 sm:w-auto"
                  >
                    Probar gratis
                    <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                  </Button>
                </Link>
                <a
                  href={WHATSAPP_DEMO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full sm:w-auto"
                  onClick={() => track("landing_cta_click", { cta: "hero_demo", label: "Agendar una demo" })}
                >
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-14 w-full rounded-full px-8 text-lg sm:w-auto"
                  >
                    Agendar una demo
                  </Button>
                </a>
              </m.div>
            </div>

            {/* Columna derecha: producto REAL + tarjetas UI flotantes */}
            <m.div
              id="demo"
              className="relative isolate mx-auto w-full max-w-xl scroll-mt-24 px-4 sm:px-6 lg:px-0"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.25 }}
            >
              {/* Glow suave detrás */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -inset-8 -z-10 rounded-[2.5rem] bg-gradient-to-tr from-primary/25 via-primary/10 to-transparent blur-3xl"
              />

              <div className="overflow-hidden rounded-2xl border bg-card shadow-2xl shadow-primary/10">
                <Image
                  src="/screenshots/desktop/dashboard.png"
                  alt="Dashboard de STApp mostrando los ingresos del mes de un taller y sus órdenes pendientes"
                  width={1409}
                  height={912}
                  className="block h-auto w-full"
                  priority
                  sizes="(max-width: 1024px) 92vw, 620px"
                />
              </div>

              <FloatingWhatsAppCard reduceMotion={reduceMotion} />
              <FloatingCobroCard reduceMotion={reduceMotion} />
            </m.div>
          </div>
        </div>

        {/* Trust strip: solo hechos reales, debajo del hero */}
        <m.div
          className="container relative mx-auto mt-14 px-4 sm:px-6 lg:mt-16 lg:px-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.5 }}
        >
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 border-y py-5 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <Check className="h-4 w-4 text-primary" />
              30 días gratis
            </span>
            <span className="flex items-center gap-2">
              <Check className="h-4 w-4 text-primary" />
              Sin tarjeta de crédito
            </span>
            <span className="flex items-center gap-2">
              <Check className="h-4 w-4 text-primary" />
              Desde <span className="font-semibold text-foreground">${anchorArs}/mes</span>
            </span>
            <span className="hidden items-center gap-2 sm:flex">
              <Check className="h-4 w-4 text-primary" />
              Soporte directo por WhatsApp
            </span>
          </div>
        </m.div>
      </section>
    </LazyMotion>
  )
}
