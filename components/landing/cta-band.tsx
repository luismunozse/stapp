"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { track } from "@/lib/analytics/track"
import { Button } from "@/components/ui/button"

export function CtaBand() {
  return (
    <section className="py-16 sm:py-20">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-2xl bg-primary px-6 py-12 text-center sm:px-12 sm:py-16">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-balance text-primary-foreground">
            Empezá a ordenar tu taller hoy
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm sm:text-base text-primary-foreground/80">
            Probá STApp 30 días gratis, sin tarjeta de crédito. Configuración en minutos.
          </p>
          <div className="mt-6 flex justify-center">
            <Link
              href="/registro?plan=profesional"
              onClick={() =>
                track("landing_cta_click", { cta: "midpage_band", label: "Comenzar Gratis" })
              }
            >
              <Button
                size="lg"
                variant="secondary"
                className="text-sm sm:text-base px-6 py-5 shadow-lg group"
              >
                Probar gratis 30 días
                <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
