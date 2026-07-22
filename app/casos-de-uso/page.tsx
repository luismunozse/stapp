import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowRight } from "lucide-react"
import { BreadcrumbJsonLd } from "@/components/seo/json-ld"
import { NavbarLanding } from "@/components/landing/navbar-landing"
import { Footer } from "@/components/landing/footer"
import { CtaBand } from "@/components/landing/cta-band"
import { WhatsAppFloat } from "@/components/marketing/whatsapp-float"
import { useCases } from "@/lib/use-cases-data"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Casos de Uso - Software para Talleres de Reparación | STApp",
  description:
    "Descubrí cómo STApp se adapta a tu tipo de taller: reparación de celulares, computadoras, tablets, consolas y dispositivos electrónicos.",
  keywords: [
    "software taller reparación",
    "casos de uso servicio técnico",
    "sistema gestión reparaciones",
    "software por tipo de taller",
  ],
  alternates: {
    canonical: "https://stapp.com.ar/casos-de-uso",
  },
}

export default function CasosDeUsoPage() {
  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Inicio", url: "https://stapp.com.ar" },
          { name: "Casos de Uso", url: "https://stapp.com.ar/casos-de-uso" },
        ]}
      />
      <NavbarLanding />
      <main id="main-content" className="min-h-dvh">
        {/* Hero */}
        <section className="relative overflow-hidden pt-28 pb-12 sm:pt-32 sm:pb-16">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-b from-primary/[0.05] via-background to-background"
          />
          <div className="container relative mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-3xl text-center">
              <h1 className="text-3xl font-bold tracking-tight text-balance text-foreground sm:text-4xl lg:text-5xl">
                Repares lo que repares, tu taller trabaja ordenado
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
                STApp se adapta al tipo de equipos que arreglás. Elegí el tuyo y
                mirá cómo ordena tus reparaciones, cobros y clientes.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link href="/registro?plan=profesional">
                  <Button
                    size="lg"
                    className="group h-14 rounded-full px-8 text-base"
                  >
                    Probar gratis
                    <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                  </Button>
                </Link>
                <Link href="/precios">
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-14 rounded-full px-6 text-base"
                  >
                    Ver precios
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Grid de casos de uso */}
        <section className="container mx-auto px-4 pb-16 sm:px-6 sm:pb-20 lg:px-8">
          <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {useCases.map((useCase) => {
              const Icon = useCase.icon
              return (
                <Link key={useCase.slug} href={`/casos-de-uso/${useCase.slug}`}>
                  <Card className="group h-full p-6 transition-all hover:border-primary/30 hover:shadow-lg">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 transition-colors group-hover:bg-primary/20">
                      <Icon className="h-6 w-6 text-primary" />
                    </div>
                    <h2 className="mb-2 text-lg font-semibold text-foreground">
                      {useCase.title}
                    </h2>
                    <p className="mb-4 text-sm text-muted-foreground">
                      {useCase.cardDescription}
                    </p>
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-all group-hover:gap-2">
                      Ver más <ArrowRight className="h-4 w-4" />
                    </span>
                  </Card>
                </Link>
              )
            })}
          </div>
        </section>

        <CtaBand />
        <Footer />
      </main>
      <WhatsAppFloat message="Hola, vengo de STApp y quiero saber qué caso de uso me sirve" />
    </>
  )
}
