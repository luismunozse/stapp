"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { track } from "@/lib/analytics/track"
import { Button } from "@/components/ui/button"

const WHATSAPP_DEMO_URL =
  "https://wa.me/5491169625733?text=" +
  encodeURIComponent("Hola! Quiero agendar una demo de STApp para mi taller.")

// Cierre de la página: última oportunidad de conversión, con la promesa
// de transformación (no una lista de features).
export function CtaBand() {
  return (
    <section className="py-16 sm:py-20">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-2xl bg-primary px-6 py-14 text-center sm:px-12 sm:py-16">
          <h2 className="text-3xl font-bold tracking-tight text-balance text-primary-foreground sm:text-4xl">
            Mañana tu taller puede trabajar ordenado
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-primary-foreground/85 sm:text-lg">
            Empezás hoy, cargás tu primera orden en minutos y probás todo 30
            días gratis. Sin tarjeta.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/registro?plan=profesional"
              className="w-full sm:w-auto"
              onClick={() =>
                track("landing_cta_click", { cta: "final_band", label: "Probar gratis" })
              }
            >
              <Button
                size="lg"
                className="group h-14 w-full rounded-full bg-white px-10 py-6 text-lg text-primary shadow-lg hover:bg-white/90 sm:w-auto"
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
              onClick={() =>
                track("landing_cta_click", { cta: "final_band_demo", label: "Agendar una demo" })
              }
            >
              <Button
                size="lg"
                variant="outline"
                className="h-14 w-full rounded-full border-white/40 bg-transparent px-8 py-6 text-lg text-primary-foreground hover:bg-white/10 hover:text-primary-foreground sm:w-auto"
              >
                Agendar una demo
              </Button>
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
