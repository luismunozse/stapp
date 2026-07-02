"use client"

import Link from "next/link"
import { Card } from "@/components/ui/card"
import { ArrowRight } from "lucide-react"
import { useCases } from "@/lib/use-cases-data"
import { m, LazyMotion, domAnimation } from "@/components/animations/motion"
import { revealHeader, revealStagger, revealCard } from "./reveal"
import { SectionEyebrow } from "@/components/landing/section-eyebrow"

export function UseCasesGrid() {
  return (
    <LazyMotion features={domAnimation}>
    <section
      id="casos-de-uso"
      className="py-16 sm:py-20 bg-muted/30"
      aria-labelledby="casos-heading"
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <m.div
          className="text-center max-w-3xl mx-auto mb-12"
          variants={revealHeader}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "0px" }}
        >
          <SectionEyebrow>Casos de uso</SectionEyebrow>
          <h2
            id="casos-heading"
            className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-balance text-foreground mb-4"
          >
            Hecho para tu tipo de taller
          </h2>
          <p className="text-lg text-muted-foreground">
            STApp se adapta a lo que reparás. Mirá cómo resuelve los problemas
            puntuales de cada rubro.
          </p>
        </m.div>

        {/* Grid de casos: cards que suben, escalonadas en orden de lectura */}
        <m.div
          className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto"
          variants={revealStagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "0px" }}
        >
          {useCases.map((useCase) => {
            const Icon = useCase.icon
            return (
              <m.div key={useCase.slug} variants={revealCard} className="h-full">
              <Link
                href={`/casos-de-uso/${useCase.slug}`}
                className="group"
              >
                <Card className="p-6 h-full hover:border-primary/30 hover:shadow-lg transition-[border-color,box-shadow]">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                    <Icon className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">
                    {useCase.title}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4 line-clamp-3">
                    {useCase.heroDescription}
                  </p>
                  <span className="inline-flex items-center gap-1 text-sm text-primary font-medium group-hover:gap-2 transition-[gap]">
                    Ver caso de uso <ArrowRight className="w-4 h-4" />
                  </span>
                </Card>
              </Link>
              </m.div>
            )
          })}

          <m.div variants={revealCard} className="h-full">
          <Link href="/casos-de-uso" className="group">
            <Card className="p-6 h-full flex flex-col justify-center items-center text-center border-dashed hover:border-primary/50 hover:bg-primary/5 transition-[border-color,background-color]">
              <h3 className="text-lg font-semibold text-foreground mb-2">
                Ver todos los casos
              </h3>
              <span className="inline-flex items-center gap-1 text-sm text-primary font-medium group-hover:gap-2 transition-all">
                Explorar <ArrowRight className="w-4 h-4" />
              </span>
            </Card>
          </Link>
          </m.div>
        </m.div>
      </div>
    </section>
    </LazyMotion>
  )
}
