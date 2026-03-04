import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { BreadcrumbJsonLd } from "@/components/seo/json-ld"
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
      <div className="min-h-screen bg-gradient-to-b from-muted/50 to-background">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver al inicio
          </Link>
        </div>

        <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              Un sistema, todos los talleres
            </h1>
            <p className="text-lg text-muted-foreground">
              STApp se adapta al tipo de dispositivos que reparás. Elegí tu caso
              de uso y descubrí cómo podemos ayudarte.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {useCases.map((useCase) => {
              const Icon = useCase.icon
              return (
                <Link key={useCase.slug} href={`/casos-de-uso/${useCase.slug}`}>
                  <Card className="p-6 h-full hover:border-primary/30 hover:shadow-lg transition-all group">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                      <Icon className="w-6 h-6 text-primary" />
                    </div>
                    <h2 className="text-lg font-semibold text-foreground mb-2">
                      {useCase.title}
                    </h2>
                    <p className="text-sm text-muted-foreground mb-4">
                      {useCase.heroDescription.slice(0, 120)}...
                    </p>
                    <span className="inline-flex items-center gap-1 text-sm text-primary font-medium group-hover:gap-2 transition-all">
                      Ver más <ArrowRight className="w-4 h-4" />
                    </span>
                  </Card>
                </Link>
              )
            })}
          </div>
        </section>
      </div>
    </>
  )
}
