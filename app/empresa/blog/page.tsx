import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import { BreadcrumbJsonLd } from "@/components/seo/json-ld"
import { blogPosts, blogCategories } from "@/lib/blog-data"
import { BlogList } from "@/components/blog/blog-list"
import { NewsletterForm } from "@/components/blog/newsletter-form"

export const metadata = {
  title: "Blog - Consejos para Talleres de Reparación de Celulares",
  description:
    "Consejos, novedades y mejores prácticas para talleres de reparación de celulares y dispositivos electrónicos. Aprende a gestionar mejor tu negocio de servicio técnico.",
  keywords: [
    "blog servicio técnico",
    "consejos taller reparación",
    "gestión negocio reparaciones",
    "tips reparación celulares",
    "como abrir taller reparación",
    "órdenes de trabajo servicio técnico",
  ],
  openGraph: {
    title: "Blog - STApp | Consejos para Talleres de Reparación",
    description:
      "Consejos, novedades y mejores prácticas para talleres de reparación de celulares.",
    url: "https://stapp.com.ar/empresa/blog",
  },
  alternates: {
    canonical: "https://stapp.com.ar/empresa/blog",
  },
}

export default function BlogPage() {
  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Inicio", url: "https://stapp.com.ar" },
          { name: "Blog", url: "https://stapp.com.ar/empresa/blog" },
        ]}
      />
      <div className="min-h-dvh bg-gradient-to-b from-muted/50 to-background">
        {/* Header */}
        <header className="border-b bg-card">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <Link href="/">
              <Button variant="ghost" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Volver al inicio
              </Button>
            </Link>
          </div>
        </header>

        {/* Hero Section */}
        <section className="py-16 sm:py-20">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto text-center">
              <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-6">
                Blog de STApp
              </h1>
              <p className="text-xl text-muted-foreground">
                Consejos, novedades y mejores prácticas para hacer crecer tu taller
                de reparación de celulares y dispositivos electrónicos
              </p>
            </div>
          </div>
        </section>

        <BlogList posts={blogPosts} categories={blogCategories} />

        {/* Newsletter CTA */}
        <section className="py-16 bg-primary/5">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl mx-auto text-center">
              <h2 className="text-3xl font-bold text-foreground mb-4">
                Suscríbete a nuestro newsletter
              </h2>
              <p className="text-muted-foreground mb-8">
                Recibe los últimos artículos, consejos y novedades directamente en tu correo
              </p>
              <NewsletterForm />
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t bg-card py-8">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <p className="text-center text-muted-foreground">
              © {new Date().getFullYear()} STApp. Todos los derechos reservados.
            </p>
          </div>
        </footer>
      </div>
    </>
  )
}
