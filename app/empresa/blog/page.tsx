import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, Calendar, Clock, ArrowRight } from "lucide-react"

export const metadata = {
  title: "Blog - STApp",
  description: "Consejos, novedades y mejores prácticas para talleres de reparación de dispositivos electrónicos.",
}

const blogPosts = [
  {
    id: 1,
    title: "Cómo mejorar la experiencia del cliente en tu taller de reparación",
    excerpt: "Descubre las mejores prácticas para brindar un servicio excepcional y fidelizar a tus clientes.",
    category: "Gestión",
    date: "2024-01-15",
    readTime: "5 min",
    image: "https://images.unsplash.com/photo-1556742031-c6961e8560b0?w=800",
  },
  {
    id: 2,
    title: "5 estrategias para optimizar el inventario de repuestos",
    excerpt: "Mantén un control eficiente de tu stock y reduce costos innecesarios con estas técnicas probadas.",
    category: "Inventario",
    date: "2024-01-10",
    readTime: "7 min",
    image: "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=800",
  },
  {
    id: 3,
    title: "La importancia de la digitalización en talleres de reparación",
    excerpt: "Por qué abandonar las planillas de Excel y adoptar un sistema de gestión puede transformar tu negocio.",
    category: "Tecnología",
    date: "2024-01-05",
    readTime: "6 min",
    image: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800",
  },
  {
    id: 4,
    title: "Cómo gestionar las garantías de reparación de manera efectiva",
    excerpt: "Aprende a establecer políticas claras de garantía que protejan tu negocio y generen confianza.",
    category: "Gestión",
    date: "2023-12-28",
    readTime: "4 min",
    image: "https://images.unsplash.com/photo-1450101499163-c8848c66ca85?w=800",
  },
  {
    id: 5,
    title: "Estrategias de marketing digital para talleres de reparación",
    excerpt: "Aumenta tu visibilidad online y atrae más clientes con estas tácticas de marketing digital.",
    category: "Marketing",
    date: "2023-12-20",
    readTime: "8 min",
    image: "https://images.unsplash.com/photo-1432888622747-4eb9a8f2c293?w=800",
  },
  {
    id: 6,
    title: "Tendencias en reparación de dispositivos para 2024",
    excerpt: "Mantente al día con las últimas tendencias y tecnologías en la industria de reparación electrónica.",
    category: "Industria",
    date: "2023-12-15",
    readTime: "6 min",
    image: "https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=800",
  },
]

const categories = ["Todos", "Gestión", "Inventario", "Tecnología", "Marketing", "Industria"]

export default function BlogPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* Header */}
      <header className="border-b bg-white">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Link href="/landing">
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
            <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-6">
              Blog de STApp
            </h1>
            <p className="text-xl text-gray-600">
              Consejos, novedades y mejores prácticas para hacer crecer tu taller
              de reparación
            </p>
          </div>
        </div>
      </section>

      {/* Categories Filter */}
      <section className="pb-8">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap gap-3 justify-center">
            {categories.map((category) => (
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
              <Card key={post.id} className="overflow-hidden hover:shadow-lg transition-shadow">
                <div className="aspect-video bg-gray-200 relative overflow-hidden">
                  <img
                    src={post.image}
                    alt={post.title}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-4 left-4">
                    <span className="bg-primary text-white text-xs font-semibold px-3 py-1 rounded-full">
                      {post.category}
                    </span>
                  </div>
                </div>
                <CardHeader>
                  <div className="flex items-center gap-4 text-sm text-gray-500 mb-3">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      <span>
                        {new Date(post.date).toLocaleDateString("es-AR", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
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
                  <p className="text-gray-600 mb-4">{post.excerpt}</p>
                  <Button variant="ghost" className="gap-2 p-0 h-auto font-semibold text-primary">
                    Leer más
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Load More */}
          <div className="text-center mt-12">
            <Button variant="outline" size="lg">
              Cargar más artículos
            </Button>
          </div>
        </div>
      </section>

      {/* Newsletter CTA */}
      <section className="py-16 bg-primary/5">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">
              Suscríbete a nuestro newsletter
            </h2>
            <p className="text-gray-600 mb-8">
              Recibe los últimos artículos, consejos y novedades directamente en tu correo
            </p>
            <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
              <input
                type="email"
                placeholder="Tu correo electrónico"
                className="flex-1 px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <Button size="lg">Suscribirme</Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-white py-8">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-gray-600">
            © {new Date().getFullYear()} STApp. Todos los derechos reservados.
          </p>
        </div>
      </footer>
    </div>
  )
}
