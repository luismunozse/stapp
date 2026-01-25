import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  ArrowRight,
  CheckCircle,
  Smartphone,
  Laptop,
  Tablet,
  Gamepad2,
} from "lucide-react"

export function Hero() {
  const benefits = [
    "Gestión completa de órdenes",
    "Control de inventario",
    "Registra pagos fácilmente",
    "Sin tarjeta de crédito",
  ]

  return (
    <section className="relative pt-20 pb-6 sm:pt-24 sm:pb-8 overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-background dark:via-background dark:to-background" />

      {/* Floating devices decoration - hidden on mobile */}
      <div className="hidden md:block absolute top-20 right-10 opacity-10">
        <Smartphone className="w-32 h-32 text-primary rotate-12" />
      </div>
      <div className="hidden md:block absolute bottom-20 left-10 opacity-10">
        <Laptop className="w-40 h-40 text-primary -rotate-12" />
      </div>

      <div className="container relative mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground tracking-tight mb-6">
            Gestiona tu taller de reparaciones{" "}
            <span className="text-primary">como un profesional</span>
          </h1>

          {/* Subheadline */}
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Sistema completo para talleres de reparación de celulares,
            computadoras y dispositivos electrónicos. Organiza tus órdenes,
            controla tu inventario y registra pagos en segundos.
          </p>

          {/* Benefits list */}
          <div className="flex flex-wrap justify-center gap-4 mb-10">
            {benefits.map((benefit) => (
              <div
                key={benefit}
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <CheckCircle className="w-5 h-5 text-green-500" />
                {benefit}
              </div>
            ))}
          </div>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/registro">
              <Button size="lg" className="text-lg px-8 py-6">
                Comenzar Gratis
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>
            <a href="#features">
              <Button size="lg" variant="outline" className="text-lg px-8 py-6">
                Ver Características
              </Button>
            </a>
          </div>

          {/* Trust indicators */}
          <p className="text-sm text-muted-foreground mt-6">
            Prueba gratis • Sin compromiso • Configuración en 2 minutos
          </p>
        </div>

        {/* Device types */}
        <div className="grid grid-cols-4 gap-4 sm:gap-8 mt-12 sm:mt-16 opacity-60 max-w-md mx-auto">
          <div className="flex flex-col items-center gap-1 sm:gap-2">
            <Smartphone className="w-6 h-6 sm:w-8 sm:h-8" />
            <span className="text-[10px] sm:text-xs">Celulares</span>
          </div>
          <div className="flex flex-col items-center gap-1 sm:gap-2">
            <Laptop className="w-6 h-6 sm:w-8 sm:h-8" />
            <span className="text-[10px] sm:text-xs">PCs</span>
          </div>
          <div className="flex flex-col items-center gap-1 sm:gap-2">
            <Tablet className="w-6 h-6 sm:w-8 sm:h-8" />
            <span className="text-[10px] sm:text-xs">Tablets</span>
          </div>
          <div className="flex flex-col items-center gap-1 sm:gap-2">
            <Gamepad2 className="w-6 h-6 sm:w-8 sm:h-8" />
            <span className="text-[10px] sm:text-xs">Consolas</span>
          </div>
        </div>
      </div>
    </section>
  )
}
