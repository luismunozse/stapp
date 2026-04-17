import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, Calendar, Clock, ArrowRight } from "lucide-react"
import { BreadcrumbJsonLd } from "@/components/seo/json-ld"
import { blogPosts, blogCategories } from "@/lib/blog-data"

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
      <div className="min-h-screen bg-gradient-to-b from-muted/50 to-background">
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

        {/* Categories Filter */}
        <section className="pb-8">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-wrap gap-3 justify-center">
              {blogCategories.map((category) => (
                <Button
                  key={category}
                  variant={category === "Todos" ? "default" : "outline"}
                  size="sm"
                >
                  {category}
                </Button>
              ))}
            </div>
          </div>
        </section>

        {/* Blog Posts Grid */}
        <section className="pb-20">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-7xl mx-auto">
              {blogPosts.map((post) => (
                <Link key={post.id} href={`/empresa/blog/${post.slug}`}>
                  <Card className="overflow-hidden hover:shadow-lg transition-shadow h-full">
                    <div className="aspect-video bg-muted relative overflow-hidden">
                      <Image
                        src={post.image}
                        alt={`${post.title} - Artículo sobre ${post.category.toLowerCase()} para talleres de reparación de celulares`}
                        fill
                        sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        className="object-cover"
                        loading="lazy"
                      />
                      <div className="absolute top-4 left-4">
                        <span className="bg-primary text-white text-xs font-semibold px-3 py-1 rounded-full">
                          {post.category}
                        </span>
                      </div>
                    </div>
                    <CardHeader>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          <time dateTime={post.date}>
                            {new Date(post.date).toLocaleDateString("es-AR", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                          </time>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          <span>{post.readTime}</span>
                        </div>
                      </div>
                      <CardTitle className="text-xl leading-tight hover:text-primary transition-colors">
                        {post.title}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-muted-foreground mb-4">{post.excerpt}</p>
                      <span className="inline-flex items-center gap-2 font-semibold text-primary">
                        Leer más
                        <ArrowRight className="h-4 w-4" />
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </section>

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
              <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
                <input
                  type="email"
                  placeholder="Tu correo electrónico"
                  className="flex-1 px-4 py-3 rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  aria-label="Email para newsletter"
                />
                <Button size="lg">Suscribirme</Button>
              </div>
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
