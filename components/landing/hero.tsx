"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import Link from "next/link"
import { captureUtmParams } from "@/lib/utm"
import { track } from "@/lib/analytics/track"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  ArrowRight,
  ChevronDown,
  ClipboardList,
  LayoutDashboard,
  Package,
  Users,
  Star,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { PlanPrices } from "@/lib/pricing"
import { LazyMotion, domAnimation, m, AnimatePresence, useReducedMotion } from "framer-motion"

// Formatea con separador de miles (igual que pricing-section): 12500 -> "12.500"
function formatThousands(price: number): string {
  return price.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")
}

const modules = [
  { id: "ordenes", name: "Órdenes", icon: ClipboardList },
  { id: "dashboard", name: "Dashboard", icon: LayoutDashboard },
  { id: "inventario", name: "Inventario", icon: Package },
  { id: "clientes", name: "Clientes", icon: Users },
]

// Capturas reales del producto (viewport 1409x912). Anonimizadas donde
// aparecían datos de clientes (clientes/ordenes) antes de publicarse.
const SHOT_WIDTH = 1409
const SHOT_HEIGHT = 912

// ========================================
// BROWSER FRAME (real screenshot)
// ========================================

function ScreenshotFrame({ src, alt, url }: { src: string; alt: string; url: string }) {
  return (
    <div className="relative mx-auto w-full max-w-5xl overflow-hidden rounded-xl border bg-card shadow-2xl">
      {/* Browser chrome bar */}
      <div className="flex items-center gap-2 border-b bg-card p-2.5">
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
          <div className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
          <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
        </div>
        <div className="flex-1 truncate rounded bg-muted px-2 py-0.5 text-center text-[10px] text-muted-foreground">
          {url}
        </div>
      </div>
      {/* Real screenshot */}
      <Image
        src={src}
        alt={alt}
        width={SHOT_WIDTH}
        height={SHOT_HEIGHT}
        className="block h-auto w-full"
        priority
        sizes="(max-width: 1024px) 90vw, 560px"
      />
    </div>
  )
}

// ========================================
// INTERACTIVE MOCKUP SLIDER
// ========================================

function MockupSlider() {
  const [activeModule, setActiveModule] = useState("ordenes")
  const reduceMotion = useReducedMotion()

  // Auto-rotate every 4 seconds (respeta prefers-reduced-motion)
  useEffect(() => {
    if (reduceMotion) return
    const interval = setInterval(() => {
      setActiveModule((current) => {
        const currentIndex = modules.findIndex((m) => m.id === current)
        const nextIndex = (currentIndex + 1) % modules.length
        return modules[nextIndex].id
      })
    }, 4000)
    return () => clearInterval(interval)
  }, [reduceMotion])

  const activeModuleData = modules.find((m) => m.id === activeModule)

  return (
    <div className="relative">
      {/* Module tabs */}
      <div className="flex justify-center gap-1.5 sm:gap-2 mb-4">
        {modules.map((module) => {
          const Icon = module.icon
          const isActive = activeModule === module.id
          return (
            <button
              key={module.id}
              onClick={() => setActiveModule(module.id)}
              className={cn(
                "no-touch-min flex items-center justify-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-full text-[11px] sm:text-xs font-medium transition-[color,background-color,box-shadow]",
                isActive
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "bg-muted/80 text-muted-foreground hover:bg-muted"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{module.name}</span>
            </button>
          )
        })}
      </div>

      {/* Screenshot container */}
      <AnimatePresence mode="wait">
        <m.div
          key={activeModule}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3 }}
        >
          <ScreenshotFrame
            src={`/screenshots/desktop/${activeModule}.png`}
            alt={`STApp — ${activeModuleData?.name ?? "panel"}`}
            url={`stapp.com.ar/${activeModule}`}
          />
        </m.div>
      </AnimatePresence>

      {/* Progress dots */}
      <div className="flex justify-center gap-2.5 mt-3 sm:mt-4">
        {modules.map((module) => (
          <button
            key={module.id}
            onClick={() => setActiveModule(module.id)}
            className={cn(
              "no-touch-min w-2.5 h-2.5 rounded-full transition-[transform,background-color] duration-300",
              activeModule === module.id
                ? "bg-primary scale-110"
                : "bg-muted-foreground/25 hover:bg-muted-foreground/40"
            )}
          />
        ))}
      </div>
    </div>
  )
}

// ========================================
// MAIN HERO COMPONENT
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
      <section className="relative pt-28 pb-8 sm:pt-32 sm:pb-10 lg:pt-36 lg:pb-12 overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.04] via-background to-background dark:from-background dark:via-background dark:to-background" />

        <div className="container relative mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
            {/* Left column - Text */}
            <div className="text-center lg:text-left">
              {/* Badge */}
              <m.div
                className="inline-block mb-5"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
              >
                <Badge variant="secondary" className="px-3 py-1 text-sm font-medium">
                  <Star className="w-3.5 h-3.5 mr-1.5 text-yellow-500" />
                  30 días gratis, sin tarjeta de crédito
                </Badge>
              </m.div>

              {/* Headline */}
              <m.h1
                className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-bold text-foreground tracking-tight text-balance mb-6"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
              >
                No pierdas más una{" "}
                <span className="text-primary">reparación entre papeles</span>
              </m.h1>

              {/* Subheadline */}
              <m.p
                className="text-lg sm:text-xl text-muted-foreground mb-8 max-w-xl mx-auto lg:mx-0"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
              >
                Cargá cada reparación en un minuto, avisale al cliente por WhatsApp
                cuando está lista y llevá las cuentas al día. Órdenes, caja,
                inventario y ventas: todo tu taller en un solo lugar.
              </m.p>

              {/* CTAs */}
              <m.div
                className="flex flex-row items-center gap-3 justify-center lg:justify-start"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.4 }}
              >
                <Link
                  href="/registro?plan=profesional"
                  onClick={() => track("landing_cta_click", { cta: "hero_primary", label: "Comenzar Gratis" })}
                >
                  <m.div
                    whileHover={{ scale: 1.05, y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    transition={{ type: "spring", stiffness: 400, damping: 17 }}
                  >
                    <Button size="lg" className="h-14 sm:h-16 px-10 sm:px-14 text-lg sm:text-xl rounded-full shadow-lg hover:shadow-xl transition-shadow group">
                      Prueba Gratis
                      <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </Button>
                  </m.div>
                </Link>
              </m.div>

              {/* Trust indicators */}
              <m.p
                className="text-sm text-muted-foreground mt-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.5 }}
              >
                Desde <span className="font-semibold text-foreground">${anchorArs}/mes</span> • Configuración en minutos • Cancelás cuando quieras
              </m.p>
            </div>

            {/* Right column - Hero before/after image */}
            <m.div
              className="relative mx-auto w-full max-w-md lg:max-w-none"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <Image
                src="/hero.png"
                alt="De los papeles al orden: un taller caótico con notas en papel y el mismo taller organizado con STApp"
                width={1122}
                height={1402}
                className="w-full h-auto rounded-2xl shadow-2xl"
                priority
                sizes="(max-width: 1024px) 90vw, 560px"
              />
            </m.div>
          </div>

          {/* Big product screenshot (Whaticket-style: dominant, below the copy) */}
          <m.div
            id="demo"
            className="relative mt-12 sm:mt-16 scroll-mt-24"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            <MockupSlider />
          </m.div>

          {/* Scroll indicator */}
          <m.a
            href="#features"
            className="flex flex-col items-center gap-1 mt-6 sm:mt-8 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.5 }}
            aria-label="Ver más contenido"
          >
            <span className="text-xs font-medium">Descubrí más</span>
            <m.div
              animate={reduceMotion ? undefined : { y: [0, 6, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            >
              <ChevronDown className="w-5 h-5" />
            </m.div>
          </m.a>
        </div>
      </section>
    </LazyMotion>
  )
}
