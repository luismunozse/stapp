"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { captureUtmParams } from "@/lib/utm"
import { track } from "@/lib/analytics/track"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import {
  ArrowRight,
  CheckCircle,
  ChevronDown,
  ClipboardList,
  LayoutDashboard,
  Package,
  Users,
  TrendingUp,
  Clock,
  AlertCircle,
  DollarSign,
  Star,
  Wifi,
  Battery,
  Signal,
  // Floating icons for background
  Smartphone,
  Wrench,
  Monitor,
  Laptop,
  Cpu,
  Settings,
  Tablet,
  HardDrive,
  type LucideIcon,
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

// Floating icons configuration for animated background
const floatingIcons: {
  Icon: LucideIcon
  position: string
  size: string
  animation: { y?: number[]; x?: number[]; rotate?: number[]; scale?: number[] }
  duration: number
  delay?: number
  opacity: string
}[] = [
  {
    Icon: Smartphone,
    position: "top-24 left-[8%]",
    size: "w-8 h-8",
    animation: { y: [-15, 15, -15], rotate: [-5, 5, -5] },
    duration: 6,
    opacity: "opacity-[0.15]",
  },
  {
    Icon: Wrench,
    position: "top-40 left-[18%]",
    size: "w-6 h-6",
    animation: { y: [10, -10, 10], rotate: [0, 15, 0] },
    duration: 5,
    delay: 0.5,
    opacity: "opacity-[0.12]",
  },
  {
    Icon: Laptop,
    position: "bottom-32 left-[5%]",
    size: "w-10 h-10",
    animation: { y: [-20, 20, -20], x: [-5, 5, -5] },
    duration: 8,
    delay: 1,
    opacity: "opacity-[0.1]",
  },
  {
    Icon: Cpu,
    position: "top-32 right-[12%]",
    size: "w-6 h-6",
    animation: { y: [-12, 12, -12], rotate: [-10, 10, -10] },
    duration: 6,
    delay: 0.8,
    opacity: "opacity-[0.15]",
  },
  {
    Icon: Tablet,
    position: "top-52 right-[25%]",
    size: "w-8 h-8",
    animation: { y: [20, -20, 20], x: [5, -5, 5] },
    duration: 9,
    delay: 1.5,
    opacity: "opacity-[0.1]",
  },
  {
    Icon: HardDrive,
    position: "bottom-40 right-[8%]",
    size: "w-7 h-7",
    animation: { y: [-18, 18, -18] },
    duration: 7,
    delay: 0.3,
    opacity: "opacity-[0.12]",
  },
]

// Floating Icons Background Component
function FloatingIconsBackground() {
  const reduceMotion = useReducedMotion()
  if (reduceMotion) return null
  return (
    <>
      {floatingIcons.map((item) => (
        <m.div
          key={item.position}
          className={cn(
            "hidden md:block absolute text-primary",
            item.position,
            item.size,
            item.opacity
          )}
          animate={item.animation}
          transition={{
            duration: item.duration,
            repeat: Infinity,
            ease: "easeInOut",
            delay: item.delay || 0,
          }}
        >
          <item.Icon className="w-full h-full" />
        </m.div>
      ))}
    </>
  )
}

// ========================================
// PHONE MOCKUPS (for mobile view)
// ========================================

function PhoneFrame({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="relative mx-auto w-[160px] sm:w-[180px]">
      {/* Phone outer bezel */}
      <div className="bg-gray-900 dark:bg-gray-800 rounded-[1.75rem] p-[3px] shadow-2xl">
        {/* Phone inner frame */}
        <div className="bg-card rounded-[1.5rem] overflow-hidden">
          {/* Dynamic Island / Notch */}
          <div className="bg-muted/80 px-3 py-1 flex items-center justify-center relative">
            <div className="absolute left-3 text-[8px] text-muted-foreground font-medium">9:41</div>
            <div className="w-16 h-4 bg-gray-900 dark:bg-gray-800 rounded-full" />
            <div className="absolute right-3 flex items-center gap-0.5">
              <Signal className="w-2 h-2 text-muted-foreground" />
              <Wifi className="w-2 h-2 text-muted-foreground" />
              <Battery className="w-2.5 h-2.5 text-muted-foreground" />
            </div>
          </div>
          {/* App header */}
          <div className="bg-primary px-2 py-1">
            <p className="text-primary-foreground text-[9px] font-semibold">{title}</p>
          </div>
          {/* Content area - taller for phone proportions */}
          <div className="p-1.5 min-h-[260px] bg-muted/30">
            {children}
          </div>
          {/* Home indicator */}
          <div className="py-1 flex justify-center bg-card">
            <div className="w-10 h-1 bg-muted-foreground/40 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  )
}

// ========================================
// BROWSER MOCKUPS (for desktop view)
// ========================================

function BrowserFrame({ children, url }: { children: React.ReactNode; url: string }) {
  return (
    <div className="relative max-w-[480px] mx-auto">
      <div className="bg-card border rounded-t-xl p-2.5 flex items-center gap-2">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
        </div>
        <div className="flex-1 bg-muted rounded px-2 py-0.5 text-[10px] text-muted-foreground text-center">
          {url}
        </div>
      </div>
      <Card className="rounded-t-none border-t-0 p-4 min-h-[340px] bg-muted/30">
        {children}
      </Card>
    </div>
  )
}

// ========================================
// MOCKUP CONTENT COMPONENTS
// ========================================

function OrdenesMockup({ isDesktop }: { isDesktop: boolean }) {
  const ordenes = [
    { id: "1234", cliente: "Juan Pérez", device: "iPhone 14 Pro", estado: "En reparación", color: "bg-blue-500" },
    { id: "1235", cliente: "María García", device: "MacBook Air", estado: "Pendiente", color: "bg-yellow-500" },
    { id: "1236", cliente: "Carlos López", device: "Samsung S23", estado: "Listo", color: "bg-green-500" },
  ]

  if (!isDesktop) {
    return (
      <div className="space-y-1">
        {ordenes.map((orden) => (
          <div key={orden.id} className="bg-card rounded p-1 shadow-sm border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-0.5">
                <div className={cn("w-1 h-1 rounded-full", orden.color)} />
                <span className="text-[10px] font-mono">#{orden.id}</span>
              </div>
              <span className="text-[9px] text-muted-foreground truncate max-w-[50px]">{orden.estado}</span>
            </div>
            <p className="text-[8px] font-medium mt-0.5 truncate">{orden.device}</p>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-xs">Órdenes de Servicio</h4>
        <Badge variant="secondary" className="text-[10px] py-0">15 activas</Badge>
      </div>
      {ordenes.map((orden) => (
        <Card key={orden.id} className="p-2">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[10px] font-mono text-muted-foreground">ORD-{orden.id}</span>
                <div className={cn("w-1.5 h-1.5 rounded-full", orden.color)} />
              </div>
              <p className="text-xs font-medium">{orden.cliente}</p>
              <p className="text-[10px] text-muted-foreground">{orden.device}</p>
            </div>
            <Badge variant="outline" className="text-[9px] py-0">{orden.estado}</Badge>
          </div>
        </Card>
      ))}
    </div>
  )
}

function DashboardMockup({ isDesktop }: { isDesktop: boolean }) {
  const stats = [
    { label: "Hoy", value: "$4.3k", icon: DollarSign, color: "text-green-500" },
    { label: "Activas", value: "15", icon: Clock, color: "text-blue-500" },
    { label: "Listas", value: "8", icon: CheckCircle, color: "text-emerald-500" },
    { label: "Pendientes", value: "7", icon: AlertCircle, color: "text-yellow-500" },
  ]

  if (!isDesktop) {
    return (
      <div className="space-y-1">
        <div className="grid grid-cols-2 gap-1">
          {stats.slice(0, 2).map((stat) => (
            <div key={stat.label} className="bg-card rounded p-1 shadow-sm border text-center">
              <p className="text-[9px] text-muted-foreground">{stat.label}</p>
              <p className={cn("text-xs font-bold", stat.color)}>{stat.value}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1">
          {stats.slice(2, 4).map((stat) => (
            <div key={stat.label} className="bg-card rounded p-1 shadow-sm border text-center">
              <p className="text-[9px] text-muted-foreground">{stat.label}</p>
              <p className={cn("text-xs font-bold", stat.color)}>{stat.value}</p>
            </div>
          ))}
        </div>
        <div className="bg-card rounded p-1 shadow-sm border">
          <p className="text-[9px] text-muted-foreground mb-0.5">Ingresos</p>
          <div className="flex items-end gap-[2px] h-14">
            {[40, 65, 45, 80, 55, 75, 90].map((h) => (
              <div key={h} className="flex-1 bg-primary/70 rounded-t" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 mb-3">
        {stats.map((stat) => (
          <Card key={stat.label} className="p-2">
            <div className="flex items-center gap-1.5 mb-0.5">
              <stat.icon className={cn("w-3 h-3", stat.color)} />
              <span className="text-[10px] text-muted-foreground">{stat.label}</span>
            </div>
            <p className="text-base font-bold">{stat.value}</p>
          </Card>
        ))}
      </div>
      <Card className="p-2">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[10px] font-semibold">Ingresos del Mes</h4>
          <TrendingUp className="w-3 h-3 text-green-500" />
        </div>
        <div className="h-16 flex items-end gap-1">
          {[40, 65, 45, 80, 55, 75, 90].map((height) => (
            <div
              key={height}
              className="flex-1 bg-gradient-to-t from-primary to-primary/50 rounded-t"
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
      </Card>
    </div>
  )
}

function InventarioMockup({ isDesktop }: { isDesktop: boolean }) {
  const items = [
    { nombre: "Pantalla iPhone 12", stock: 5, alerta: false },
    { nombre: "Batería Samsung", stock: 2, alerta: true },
    { nombre: "Cargador USB-C", stock: 15, alerta: false },
    { nombre: "Flex de carga", stock: 1, alerta: true },
  ]

  if (!isDesktop) {
    return (
      <div className="space-y-1">
        {items.slice(0, 4).map((item) => (
          <div
            key={item.nombre}
            className={cn("bg-card rounded p-1 shadow-sm border", item.alerta && "border-yellow-500/50")}
          >
            <div className="flex items-center justify-between gap-1">
              <p className="text-[10px] font-medium truncate flex-1">{item.nombre}</p>
              <div className="flex items-center gap-0.5 flex-shrink-0">
                {item.alerta && <AlertCircle className="w-2 h-2 text-yellow-500" />}
                <span className={cn("text-[10px] font-semibold", item.alerta ? "text-yellow-500" : "text-muted-foreground")}>
                  {item.stock}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-xs">Control de Inventario</h4>
        <Badge variant="secondary" className="text-[10px] py-0">124 productos</Badge>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {items.map((item) => (
          <Card key={item.nombre} className={cn("p-2", item.alerta && "border-yellow-500/50 bg-yellow-50/50 dark:bg-yellow-950/20")}>
            <div className="flex items-start gap-1.5">
              <Package className={cn("w-3 h-3 mt-0.5", item.alerta ? "text-yellow-500" : "text-green-500")} />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-medium truncate">{item.nombre}</p>
                <p className="text-[9px] text-muted-foreground">
                  Stock: <span className={cn("font-semibold", item.alerta && "text-yellow-600")}>{item.stock}</span>
                </p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

function ClientesMockup({ isDesktop }: { isDesktop: boolean }) {
  const clientes = [
    { nombre: "Juan Pérez", iniciales: "JP", reparaciones: 5 },
    { nombre: "María García", iniciales: "MG", reparaciones: 3 },
    { nombre: "Carlos López", iniciales: "CL", reparaciones: 8 },
  ]

  if (!isDesktop) {
    return (
      <div className="space-y-1">
        {clientes.map((cliente) => (
          <div key={cliente.nombre} className="bg-card rounded p-1 shadow-sm border flex items-center gap-1">
            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center text-white text-[9px] font-semibold flex-shrink-0">
              {cliente.iniciales}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-medium truncate">{cliente.nombre}</p>
              <p className="text-[9px] text-muted-foreground">{cliente.reparaciones} reparaciones</p>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-xs">Base de Clientes</h4>
        <Badge variant="secondary" className="text-[10px] py-0">234 clientes</Badge>
      </div>
      {clientes.map((cliente) => (
        <Card key={cliente.nombre} className="p-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center text-white font-semibold text-[10px]">
              {cliente.iniciales}
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium">{cliente.nombre}</p>
              <p className="text-[10px] text-muted-foreground">{cliente.reparaciones} reparaciones</p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}

// ========================================
// INTERACTIVE MOCKUP SLIDER
// ========================================

function MockupSlider() {
  const [activeModule, setActiveModule] = useState("ordenes")
  const [isDesktop, setIsDesktop] = useState(true)
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

  // Detect screen size
  useEffect(() => {
    const checkSize = () => setIsDesktop(window.innerWidth >= 640)
    checkSize()
    window.addEventListener("resize", checkSize)
    return () => window.removeEventListener("resize", checkSize)
  }, [])

  const renderMockupContent = () => {
    switch (activeModule) {
      case "ordenes":
        return <OrdenesMockup isDesktop={isDesktop} />
      case "dashboard":
        return <DashboardMockup isDesktop={isDesktop} />
      case "inventario":
        return <InventarioMockup isDesktop={isDesktop} />
      case "clientes":
        return <ClientesMockup isDesktop={isDesktop} />
      default:
        return <OrdenesMockup isDesktop={isDesktop} />
    }
  }

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

      {/* Mockup container */}
      <AnimatePresence mode="wait">
        <m.div
          key={activeModule}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3 }}
        >
          {/* Mobile: Phone frame */}
          <div className="sm:hidden">
            <PhoneFrame title={activeModuleData?.name || "STApp"}>
              {renderMockupContent()}
            </PhoneFrame>
          </div>

          {/* Desktop: Browser frame */}
          <div className="hidden sm:block">
            <BrowserFrame url={`stapp.com/${activeModule}`}>
              {renderMockupContent()}
            </BrowserFrame>
          </div>
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

  const benefits = [
    "Órdenes ilimitadas",
    "Caja y finanzas",
    "Punto de venta incluido",
    "Seguimiento online",
    "Asistente IA 24/7",
  ]

  return (
    <LazyMotion features={domAnimation}>
      <section className="relative pt-24 pb-4 sm:pt-28 sm:pb-6 lg:pt-32 lg:pb-8 overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.06] via-white to-primary/[0.03] dark:from-background dark:via-background dark:to-background" />

        {/* Grid pattern overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:24px_24px]" />

        {/* Floating tech icons background */}
        <FloatingIconsBackground />

        <div className="container relative mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
            {/* Left column - Text content */}
            <div className="text-center lg:text-left">
              {/* Badge */}
              <m.div
                className="inline-block mb-4"
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
                className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground tracking-tight text-balance mb-4"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
              >
                Nunca más pierdas una{" "}
                <span className="text-primary">reparación entre papeles</span>
              </m.h1>

              {/* Subheadline */}
              <m.p
                className="text-base sm:text-lg text-muted-foreground mb-6 max-w-lg mx-auto lg:mx-0"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
              >
                Dejá de anotar en papeles, de olvidarte qué equipo era de quién,
                y de perseguir cobros. Órdenes, caja, inventario, ventas, finanzas
                y más: organizá todo tu taller desde el celular.
              </m.p>

              {/* Benefits */}
              <m.div
                className="flex flex-wrap justify-center lg:justify-start gap-x-4 gap-y-2 mb-6"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.3 }}
              >
                {benefits.map((benefit) => (
                  <div key={benefit} className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    {benefit}
                  </div>
                ))}
              </m.div>

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
                    <Button size="lg" className="text-sm sm:text-base px-4 sm:px-6 py-4 sm:py-5 shadow-lg hover:shadow-xl transition-shadow group">
                      Probar gratis 30 días
                      <ArrowRight className="ml-1.5 sm:ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </Button>
                  </m.div>
                </Link>
                <a
                  href="#demo"
                  onClick={() => track("landing_cta_click", { cta: "hero_secondary", label: "Ver cómo funciona" })}
                >
                  <m.div
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.98 }}
                    transition={{ type: "spring", stiffness: 400, damping: 17 }}
                  >
                    <Button size="lg" variant="outline" className="text-sm sm:text-base px-4 sm:px-6 py-4 sm:py-5">
                      Ver cómo funciona
                    </Button>
                  </m.div>
                </a>
              </m.div>

              {/* Trust indicators */}
              <m.p
                className="text-xs text-muted-foreground mt-4"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.5 }}
              >
                Desde <span className="font-semibold text-foreground">${anchorArs}/mes</span> • Configuración en minutos • Cancelás cuando quieras
              </m.p>
            </div>

            {/* Right column - Interactive Mockup Slider */}
            <m.div
              id="demo"
              className="relative scroll-mt-24"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
            >
              <MockupSlider />
            </m.div>
          </div>

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
