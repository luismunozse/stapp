import { notFound } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  AlertTriangle,
} from "lucide-react"
import { BreadcrumbJsonLd } from "@/components/seo/json-ld"
import { useCases, getUseCase } from "@/lib/use-cases-data"
import type { Metadata } from "next"

interface PageProps {
  params: Promise<{ slug: string }>
}

export async function generateStaticParams() {
  return useCases.map((uc) => ({ slug: uc.slug }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const useCase = getUseCase(slug)
  if (!useCase) return {}

  return {
    title: useCase.metaTitle,
    description: useCase.metaDescription,
    keywords: useCase.keywords,
    alternates: {
      canonical: `https://stapp.com.ar/casos-de-uso/${useCase.slug}`,
    },
    openGraph: {
      title: useCase.metaTitle,
      description: useCase.metaDescription,
      url: `https://stapp.com.ar/casos-de-uso/${useCase.slug}`,
    },
  }
}

export default async function UseCasePage({ params }: PageProps) {
  const { slug } = await params
  const useCase = getUseCase(slug)

  if (!useCase) notFound()

  const Icon = useCase.icon

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Inicio", url: "https://stapp.com.ar" },
          { name: "Casos de Uso", url: "https://stapp.com.ar/casos-de-uso" },
          {
            name: useCase.title,
            url: `https://stapp.com.ar/casos-de-uso/${useCase.slug}`,
          },
        ]}
      />
      <div className="min-h-screen bg-gradient-to-b from-muted/50 to-background">
        {/* Nav */}
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          <Link
            href="/#features"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver al inicio
          </Link>
        </div>

        {/* Hero */}
        <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 text-center">
          <div className="max-w-3xl mx-auto">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
              <Icon className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground tracking-tight mb-4">
              {useCase.heroTitle}{" "}
              <span className="text-primary">{useCase.heroHighlight}</span>
              {" "}necesita
            </h1>
            <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
              {useCase.heroDescription}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/registro">
                <Button size="lg" className="w-full sm:w-auto">
                  Probar 30 días gratis
                  <ArrowRight className="ml-2 w-4 h-4" />
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Problems */}
        <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-8 text-center">
              ¿Te pasa esto en tu taller?
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {useCase.problems.map((problem) => (
                <Card
                  key={problem}
                  className="p-4 border-yellow-500/20 bg-yellow-50/50 dark:bg-yellow-950/10"
                >
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-foreground">{problem}</p>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Solutions */}
        <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-8 text-center">
              Cómo STApp lo resuelve
            </h2>
            <div className="space-y-6">
              {useCase.solutions.map((solution) => (
                <Card key={solution.title} className="p-6">
                  <div className="flex items-start gap-4">
                    <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-semibold text-foreground mb-1">
                        {solution.title}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {solution.description}
                      </p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
          <Card className="max-w-2xl mx-auto p-8 text-center border-primary/20">
            <h2 className="text-2xl font-bold text-foreground mb-3">
              Probá STApp gratis en tu taller
            </h2>
            <p className="text-muted-foreground mb-6">
              30 días con acceso completo. Sin tarjeta de crédito.
            </p>
            <Link href="/registro">
              <Button size="lg">
                Comenzar Gratis
                <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </Link>
          </Card>
        </section>
      </div>
    </>
  )
}
