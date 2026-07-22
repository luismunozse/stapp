"use client"

import Image from "next/image"
import Link from "next/link"
import { ArrowRight, Check } from "lucide-react"
import { LazyMotion, domAnimation, m } from "@/components/animations/motion"
import { revealHeader, revealRow } from "./reveal"

// Dos momentos del producto contados como resultado, con capturas reales.
// El catálogo completo de funciones vive en /casos-de-uso y /precios.
const BLOQUES = [
  {
    titulo: "Nunca más pierdas una reparación",
    descripcion:
      "Cada equipo que entra queda registrado con estado, fotos y seña. Vos y tu cliente saben en qué está, siempre.",
    bullets: [
      "Tu cliente sigue su reparación online, sin llamarte",
      "Aviso automático por WhatsApp cuando está lista",
      "Cuando un cliente vuelve, en 2 clics ya sabés todo",
    ],
    screenshot: "/screenshots/desktop/ordenes.png",
    alt: "Listado de órdenes de reparación en STApp con estados y clientes",
    imagenDerecha: true,
  },
  {
    titulo: "Sabé qué repuestos tenés antes de comprar de más",
    descripcion:
      "Tu stock siempre al día, con alertas cuando algo se está por acabar. Plata que no queda dormida en el estante.",
    bullets: [
      "Alertas de stock bajo antes de quedarte sin nada",
      "Ventas de mostrador con garantía en el mismo lugar",
      "Importás tu inventario desde Excel en minutos",
    ],
    screenshot: "/screenshots/desktop/inventario.png",
    alt: "Control de inventario de repuestos en STApp con alertas de stock",
    imagenDerecha: false,
  },
]

export function Features() {
  return (
    <LazyMotion features={domAnimation}>
      <section id="features" className="scroll-mt-24 bg-muted/40 py-20 sm:py-24">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <m.div
            className="mx-auto max-w-2xl text-center"
            variants={revealHeader}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "0px" }}
          >
            <h2 className="text-3xl font-bold tracking-tight text-balance text-foreground sm:text-4xl lg:text-5xl">
              Tu taller, profesional de verdad
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Lo que tus clientes ven es orden. Lo que vos ves es tiempo y plata.
            </p>
          </m.div>

          <div className="mt-14 space-y-16 sm:space-y-20">
            {BLOQUES.map((bloque) => (
              <m.div
                key={bloque.titulo}
                className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14"
                variants={revealRow}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "0px" }}
              >
                <div className={bloque.imagenDerecha ? "" : "lg:order-2"}>
                  <h3 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                    {bloque.titulo}
                  </h3>
                  <p className="mt-3 text-lg text-muted-foreground">
                    {bloque.descripcion}
                  </p>
                  <ul className="mt-6 space-y-3">
                    {bloque.bullets.map((bullet) => (
                      <li key={bullet} className="flex items-start gap-3">
                        <Check className="mt-1 h-5 w-5 shrink-0 text-primary" />
                        <span className="text-base text-foreground">{bullet}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className={bloque.imagenDerecha ? "" : "lg:order-1"}>
                  <div className="overflow-hidden rounded-2xl border bg-card shadow-xl shadow-primary/5">
                    <Image
                      src={bloque.screenshot}
                      alt={bloque.alt}
                      width={1409}
                      height={912}
                      className="block h-auto w-full"
                      sizes="(max-width: 1024px) 92vw, 600px"
                    />
                  </div>
                </div>
              </m.div>
            ))}
          </div>

          <m.div
            className="mt-14 text-center"
            variants={revealHeader}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "0px" }}
          >
            <Link
              href="/casos-de-uso"
              className="group inline-flex items-center gap-2 text-base font-medium text-primary hover:underline"
            >
              Ver todo lo que incluye STApp
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </m.div>
        </div>
      </section>
    </LazyMotion>
  )
}
