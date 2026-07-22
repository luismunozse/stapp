"use client"

import Link from "next/link"
import { ArrowRight, Check, X } from "lucide-react"
import { track } from "@/lib/analytics/track"
import { LazyMotion, domAnimation, m } from "@/components/animations/motion"
import { revealHeader, revealStagger, revealRow } from "./reveal"

// Antes/después: el visitante se reconoce en el dolor y ve el resultado.
// Vende transformación, no funcionalidades.
const PARES = [
  {
    dolor: "¿Dónde quedó el equipo de Juan? ¿Dejó seña?",
    resultado: "Cada reparación con su estado, fotos y seña. Nada se pierde.",
  },
  {
    dolor: "Todo el día contestando “¿está listo mi equipo?”",
    resultado: "El cliente recibe el aviso solo por WhatsApp y ve el estado online.",
  },
  {
    dolor: "¿Cuánto gané este mes? Ni idea.",
    resultado: "Caja diaria y números claros: cuánto entró, cuánto salió, cuánto queda.",
  },
]

export function Transformation() {
  return (
    <LazyMotion features={domAnimation}>
      <section className="py-20 sm:py-24">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <m.div
            className="mx-auto max-w-2xl text-center"
            variants={revealHeader}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "0px" }}
          >
            <h2 className="text-3xl font-bold tracking-tight text-balance text-foreground sm:text-4xl lg:text-5xl">
              Del cuaderno al control total
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Si alguna vez pensaste esto, STApp es para vos.
            </p>
          </m.div>

          <m.div
            className="mx-auto mt-12 max-w-4xl overflow-hidden rounded-2xl border bg-card"
            variants={revealStagger}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "0px" }}
          >
            {PARES.map((par, i) => (
              <m.div
                key={par.dolor}
                variants={revealRow}
                className={
                  "grid gap-4 p-6 sm:grid-cols-2 sm:gap-8 sm:p-8" +
                  (i > 0 ? " border-t" : "")
                }
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                    <X className="h-3.5 w-3.5 text-destructive" />
                  </span>
                  <p className="text-base text-muted-foreground sm:text-lg">
                    {par.dolor}
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success-50 dark:bg-success/15">
                    <Check className="h-3.5 w-3.5 text-success-600" />
                  </span>
                  <p className="text-base font-medium text-foreground sm:text-lg">
                    {par.resultado}
                  </p>
                </div>
              </m.div>
            ))}
          </m.div>

          {/* CTA distribuido: momento de identificación con el dolor */}
          <m.div
            className="mt-10 text-center"
            variants={revealHeader}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "0px" }}
          >
            <Link
              href="/registro?plan=profesional"
              onClick={() => track("landing_cta_click", { cta: "transformation", label: "Probar gratis" })}
              className="group inline-flex items-center gap-2 text-lg font-semibold text-primary hover:underline"
            >
              Probar gratis
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
            </Link>
          </m.div>
        </div>
      </section>
    </LazyMotion>
  )
}
