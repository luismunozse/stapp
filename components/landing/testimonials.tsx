"use client"

import { LazyMotion, domAnimation, m } from "framer-motion"
import { Star } from "lucide-react"
import { Card } from "@/components/ui/card"

export interface Testimonio {
  /** Nombre real del dueño/a del taller. Requiere permiso de uso. */
  nombre: string
  /** Nombre del taller/negocio. */
  taller: string
  /** Ciudad/provincia (suma credibilidad local). */
  ciudad: string
  /** Cita textual. Concreta > genérica: que mencione un resultado real. */
  quote: string
  /** 1-5. Omitir si no aplica. */
  estrellas?: number
}

// ⚠️ SOLO TESTIMONIOS REALES, con permiso para usar el nombre.
// Mientras esté vacío, esta sección NO se renderiza (return null abajo).
// No inventar: una prueba social falsa destruye más confianza de la que crea.
//
// Ejemplo de forma (borrar, no usar como dato):
//   { nombre: "Nombre Real", taller: "Celulares X", ciudad: "Córdoba",
//     quote: "Dejé de perder reparaciones; cargo la orden en 1 min.", estrellas: 5 }
export const TESTIMONIOS: Testimonio[] = []

function iniciales(nombre: string): string {
  return nombre
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase()
}

export function Testimonials() {
  // Sin testimonios reales → no mostramos sección (evita placeholders falsos).
  if (TESTIMONIOS.length === 0) return null

  return (
    <LazyMotion features={domAnimation}>
      <section className="py-16 sm:py-20" aria-labelledby="testimonios-heading">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <m.div
            className="text-center max-w-2xl mx-auto mb-10 sm:mb-12"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "0px" }}
            transition={{ duration: 0.5 }}
          >
            <h2
              id="testimonios-heading"
              className="text-2xl sm:text-3xl lg:text-4xl font-bold text-foreground tracking-tight text-balance"
            >
              Talleres que ya dejaron los papeles
            </h2>
          </m.div>

          <div className="grid gap-4 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3 max-w-5xl mx-auto">
            {TESTIMONIOS.map((t, i) => (
              <m.div
                key={`${t.nombre}-${t.taller}`}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "0px" }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
              >
                <Card className="p-6 h-full flex flex-col">
                  {t.estrellas ? (
                    <div className="flex gap-0.5 mb-3" aria-label={`${t.estrellas} de 5`}>
                      {Array.from({ length: t.estrellas }).map((_, s) => (
                        <Star key={s} className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                      ))}
                    </div>
                  ) : null}
                  <p className="text-sm text-foreground/90 flex-1">“{t.quote}”</p>
                  <div className="flex items-center gap-3 mt-4 pt-4 border-t">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                      {iniciales(t.nombre)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{t.nombre}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {t.taller} · {t.ciudad}
                      </p>
                    </div>
                  </div>
                </Card>
              </m.div>
            ))}
          </div>
        </div>
      </section>
    </LazyMotion>
  )
}
