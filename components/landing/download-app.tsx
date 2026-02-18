"use client"

import { useState, useEffect, useCallback } from "react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Download,
  Smartphone,
  Shield,
  Zap,
  RefreshCw,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"

interface ApkInfo {
  available: boolean
  version?: string
  buildDate?: string
  fileSizeMB?: string
}

/**
 * Screenshots de la app real.
 * Para actualizar, reemplazá las imágenes en public/screenshots/
 * Tamaño recomendado: 1080x1920 (o cualquier ratio 9:16)
 */
const screenshots = [
  { src: "/screenshots/dashboard.png", label: "Dashboard" },
  { src: "/screenshots/ordenes.png", label: "Órdenes" },
  { src: "/screenshots/clientes.png", label: "Clientes" },
  { src: "/screenshots/inventario.png", label: "Inventario" },
]

const features = [
  {
    icon: Zap,
    title: "Acceso rápido",
    description: "Abrí la app directo desde tu celular sin usar el navegador",
  },
  {
    icon: Shield,
    title: "Segura",
    description: "Misma seguridad que la versión web con conexión encriptada",
  },
  {
    icon: RefreshCw,
    title: "Siempre actualizada",
    description: "Se actualiza automáticamente sin necesidad de descargar nuevamente",
  },
]

function PhoneCarousel() {
  const [current, setCurrent] = useState(0)
  const [direction, setDirection] = useState(1)
  const [hasImages, setHasImages] = useState(true)

  // Precargar todas las imágenes al montar
  useEffect(() => {
    screenshots.forEach((s) => {
      const img = new window.Image()
      img.src = s.src
    })
  }, [])

  const next = useCallback(() => {
    setDirection(1)
    setCurrent((prev) => (prev + 1) % screenshots.length)
  }, [])

  const prev = useCallback(() => {
    setDirection(-1)
    setCurrent((prev) => (prev - 1 + screenshots.length) % screenshots.length)
  }, [])

  // Auto-rotate cada 4 segundos
  useEffect(() => {
    const interval = setInterval(next, 4000)
    return () => clearInterval(interval)
  }, [next])

  const variants = {
    enter: { opacity: 0 },
    center: { opacity: 1 },
    exit: { opacity: 0 },
  }

  return (
    <div className="relative">
      {/* Phone frame */}
      <div className="relative mx-auto w-[240px] sm:w-[280px]">
        <div className="bg-gray-900 dark:bg-gray-800 rounded-[2.5rem] p-[4px] shadow-2xl">
          <div className="bg-black rounded-[2.25rem] overflow-hidden">
            {/* Status bar */}
            <div className="bg-black px-4 py-1.5 flex items-center justify-between relative z-10">
              <span className="text-[10px] text-white/70 font-medium">9:41</span>
              <div className="w-20 h-5 bg-gray-900 rounded-full absolute left-1/2 -translate-x-1/2" />
              <div className="flex items-center gap-1">
                <div className="w-3.5 h-2 border border-white/70 rounded-[2px] relative">
                  <div className="absolute inset-[1px] right-[2px] bg-white/70 rounded-[1px]" />
                </div>
              </div>
            </div>

            {/* Screenshot area */}
            <div className="relative aspect-[9/17] bg-muted/30 overflow-hidden">
              <AnimatePresence>
                <motion.div
                  key={current}
                  variants={variants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.4, ease: "easeInOut" }}
                  className="absolute inset-0"
                >
                  {hasImages ? (
                    <Image
                      src={screenshots[current].src}
                      alt={screenshots[current].label}
                      fill
                      className="object-cover object-top"
                      sizes="280px"
                      priority={current === 0}
                      onError={() => setHasImages(false)}
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-muted/50 p-4">
                      <Smartphone className="w-12 h-12 text-muted-foreground/30" />
                      <p className="text-[10px] text-muted-foreground text-center">
                        {screenshots[current].label}
                      </p>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Home indicator */}
            <div className="py-1.5 flex justify-center bg-black">
              <div className="w-24 h-1 bg-white/30 rounded-full" />
            </div>
          </div>
        </div>
      </div>

      {/* Navigation arrows */}
      <button
        onClick={prev}
        className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-3 w-8 h-8 rounded-full bg-card border shadow-md flex items-center justify-center hover:bg-accent transition-colors"
        aria-label="Anterior"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <button
        onClick={next}
        className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-3 w-8 h-8 rounded-full bg-card border shadow-md flex items-center justify-center hover:bg-accent transition-colors"
        aria-label="Siguiente"
      >
        <ChevronRight className="w-4 h-4" />
      </button>

      {/* Dots + labels */}
      <div className="flex justify-center gap-3 mt-4">
        {screenshots.map((s, i) => (
          <button
            key={s.label}
            onClick={() => {
              setDirection(i > current ? 1 : -1)
              setCurrent(i)
            }}
            className={cn(
              "flex flex-col items-center gap-1 transition-all",
              current === i ? "opacity-100" : "opacity-50 hover:opacity-75"
            )}
          >
            <div
              className={cn(
                "w-2 h-2 rounded-full transition-all",
                current === i ? "bg-primary scale-110" : "bg-muted-foreground/40"
              )}
            />
            <span className="text-[10px] font-medium text-muted-foreground">
              {s.label}
            </span>
          </button>
        ))}
      </div>

      {/* Decorative glow */}
      <div className="absolute -inset-8 bg-primary/5 rounded-full blur-3xl -z-10" />
    </div>
  )
}

export function DownloadApp() {
  const [apkInfo, setApkInfo] = useState<ApkInfo>({ available: false })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/download/apk-info")
      .then((res) => res.json())
      .then((data) => {
        setApkInfo(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("es-AR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    })
  }

  return (
    <section id="download" className="py-16 sm:py-20 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-muted/30 to-background" />

      <div className="container relative mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          {/* Left: Phone with real screenshots */}
          <motion.div
            className="flex justify-center lg:justify-end order-2 lg:order-1"
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <PhoneCarousel />
          </motion.div>

          {/* Right: Content */}
          <motion.div
            className="text-center lg:text-left order-1 lg:order-2"
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <Badge variant="secondary" className="mb-4 px-3 py-1 text-sm">
              <Smartphone className="w-3.5 h-3.5 mr-1.5" />
              App Android
            </Badge>

            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-foreground tracking-tight mb-4">
              Descargá la app en tu{" "}
              <span className="text-primary">celular</span>
            </h2>

            <p className="text-base sm:text-lg text-muted-foreground mb-6 max-w-lg mx-auto lg:mx-0">
              Accedé a STApp directamente desde tu dispositivo Android. Gestioná tu
              taller desde cualquier lugar con la experiencia nativa.
            </p>

            {/* Feature list */}
            <div className="space-y-3 mb-8">
              {features.map((feature) => (
                <div key={feature.title} className="flex items-start gap-3 text-left">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <feature.icon className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{feature.title}</p>
                    <p className="text-sm text-muted-foreground">{feature.description}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Download button */}
            {loading ? (
              <div className="flex items-center justify-center lg:justify-start gap-2">
                <div className="animate-pulse bg-muted rounded-lg h-12 w-48" />
              </div>
            ) : apkInfo.available ? (
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row items-center gap-3 justify-center lg:justify-start">
                  <a href="/api/download/apk">
                    <Button size="lg" className="text-base px-6 py-5 shadow-lg hover:shadow-xl transition-all group">
                      <Download className="mr-2 w-5 h-5 group-hover:animate-bounce" />
                      Descargar APK
                    </Button>
                  </a>
                  {apkInfo.fileSizeMB && (
                    <span className="text-sm text-muted-foreground">
                      {apkInfo.fileSizeMB}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 justify-center lg:justify-start text-xs text-muted-foreground">
                  <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                  {apkInfo.version && <span>v{apkInfo.version}</span>}
                  {apkInfo.buildDate && (
                    <span>
                      {apkInfo.version && " \u00B7 "}
                      Actualizado el {formatDate(apkInfo.buildDate)}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <Card className="p-4 bg-muted/50 max-w-sm mx-auto lg:mx-0">
                <p className="text-sm text-muted-foreground text-center lg:text-left">
                  La app para Android estará disponible pronto. Mientras tanto, podés usar
                  STApp desde el navegador de tu celular.
                </p>
              </Card>
            )}
          </motion.div>
        </div>
      </div>
    </section>
  )
}
