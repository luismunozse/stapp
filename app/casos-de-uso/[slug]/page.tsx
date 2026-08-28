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
import { BreadcrumbJsonLd, FAQPageJsonLd } from "@/components/seo/json-ld"
import { NavbarLanding } from "@/components/landing/navbar-landing"
import { Footer } from "@/components/landing/footer"
import { WhatsAppFloat } from "@/components/marketing/whatsapp-float"
import { useCases, getUseCase } from "@/lib/use-cases-data"
import type { Metadata } from "next"
import { OG_IMAGES } from "@/lib/og/metadata"

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
      images: OG_IMAGES,
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
  const relatedCases = useCase.relatedSlugs
    .map((s) => getUseCase(s))
    .filter((uc): uc is NonNullable<typeof uc> => !!uc)

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
      <FAQPageJsonLd faqs={useCase.faqs} />
      <NavbarLanding />
      <div className="min-h-dvh bg-gradient-to-b from-muted/50 to-background pt-16">
        {/* Volver al índice de casos de uso */}
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          <Link
            href="/casos-de-uso"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Ver todos los casos de uso
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
              <Link href="/precios">
                <Button size="lg" variant="outline" className="w-full sm:w-auto">
                  Ver precios
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Long intro */}
        <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="max-w-3xl mx-auto space-y-5">
            {useCase.longIntro.map((paragraph, i) => (
              <p key={i} className="text-base sm:text-lg text-muted-foreground leading-relaxed">
                {paragraph}
              </p>
            ))}
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

        {/* Workflow */}
        <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-12 bg-muted/30">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-4 text-center">
              Cómo funciona paso a paso
            </h2>
            <p className="text-center text-muted-foreground mb-10 max-w-2xl mx-auto">
              Un flujo pensado para talleres reales, probado con cientos de órdenes por mes.
            </p>
            <ol className="space-y-5">
              {useCase.workflow.map((step, index) => (
                <li key={step.title} className="flex gap-4">
                  <div className="flex-shrink-0 w-9 h-9 rounded-full bg-primary text-primary-foreground font-bold flex items-center justify-center text-sm">
                    {index + 1}
                  </div>
                  <div className="pt-1">
                    <h3 className="font-semibold text-foreground mb-1">
                      {step.title}
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {step.description}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Specific features */}
        <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-4 text-center">
              Funcionalidades pensadas para este rubro
            </h2>
            <p className="text-center text-muted-foreground mb-10 max-w-2xl mx-auto">
              No es un sistema genérico con relleno: cada función resuelve un problema concreto de tu tipo de taller.
            </p>
            <div className="grid sm:grid-cols-2 gap-5">
              {useCase.specificFeatures.map((feature) => (
                <Card key={feature.title} className="p-6">
                  <h3 className="font-semibold text-foreground mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {feature.description}
                  </p>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* FAQs */}
        <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-12 bg-muted/30">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-10 text-center">
              Preguntas frecuentes
            </h2>
            <div className="space-y-4">
              {useCase.faqs.map((faq) => (
                <details
                  key={faq.question}
                  className="group rounded-lg border bg-card p-5 [&_summary::-webkit-details-marker]:hidden"
                >
                  <summary className="flex cursor-pointer items-start justify-between gap-4 font-semibold text-foreground">
                    <span>{faq.question}</span>
                    <ArrowRight className="w-5 h-5 flex-shrink-0 mt-0.5 transition-transform group-open:rotate-90" />
                  </summary>
                  <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                    {faq.answer}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Related use cases */}
        {relatedCases.length > 0 && (
          <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="max-w-4xl mx-auto">
              <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-8 text-center">
                También podría interesarte
              </h2>
              <div className="grid sm:grid-cols-2 gap-5">
                {relatedCases.map((related) => {
                  const RelatedIcon = related.icon
                  return (
                    <Link
                      key={related.slug}
                      href={`/casos-de-uso/${related.slug}`}
                      className="group"
                    >
                      <Card className="p-6 h-full hover:border-primary/30 hover:shadow-lg transition-all">
                        <div className="flex items-start gap-4">
                          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
                            <RelatedIcon className="w-5 h-5 text-primary" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-foreground mb-1">
                              {related.title}
                            </h3>
                            <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                              {related.heroDescription}
                            </p>
                            <span className="inline-flex items-center gap-1 text-sm text-primary font-medium group-hover:gap-2 transition-all">
                              Ver caso <ArrowRight className="w-4 h-4" />
                            </span>
                          </div>
                        </div>
                      </Card>
                    </Link>
                  )
                })}
              </div>
            </div>
          </section>
        )}

        {/* CTA */}
        <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
          <Card className="max-w-2xl mx-auto p-8 text-center border-primary/20">
            <h2 className="text-2xl font-bold text-foreground mb-3">
              Probá STApp gratis en tu taller
            </h2>
            <p className="text-muted-foreground mb-6">
              30 días con acceso completo. Sin tarjeta de crédito.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/registro">
                <Button size="lg">
                  Comenzar Gratis
                  <ArrowRight className="ml-2 w-4 h-4" />
                </Button>
              </Link>
              <Link href="/precios">
                <Button size="lg" variant="outline">
                  Ver planes y precios
                </Button>
              </Link>
            </div>
          </Card>
        </section>
      </div>
      <Footer />
      <WhatsAppFloat message={`Hola, me interesa STApp para ${useCase.title}`} />
    </>
  )
}
