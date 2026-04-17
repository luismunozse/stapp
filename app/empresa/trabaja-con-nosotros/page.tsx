import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ArrowLeft,
  Briefcase,
  MapPin,
  Clock,
  Rocket,
  Users,
  Heart,
  Zap,
  Coffee,
  GraduationCap,
} from "lucide-react"

export const metadata = {
  title: "Trabaja con Nosotros - STApp",
  description: "Únete a nuestro equipo y ayúdanos a transformar la gestión de talleres de reparación.",
  alternates: {
    canonical: "https://stapp.com.ar/empresa/trabaja-con-nosotros",
  },
}

const openPositions = [
  {
    id: 1,
    title: "Desarrollador Full Stack Senior",
    department: "Ingeniería",
    location: "Remoto (Latinoamérica)",
    type: "Tiempo completo",
    description: "Buscamos un desarrollador full stack con experiencia en Next.js, React y Node.js para unirse a nuestro equipo de producto.",
  },
  {
    id: 2,
    title: "Diseñador UI/UX",
    department: "Diseño",
    location: "Remoto (Latinoamérica)",
    type: "Tiempo completo",
    description: "Únete a nuestro equipo de diseño para crear experiencias de usuario excepcionales que deleiten a nuestros clientes.",
  },
  {
    id: 3,
    title: "Especialista en Soporte al Cliente",
    department: "Soporte",
    location: "Remoto (Argentina)",
    type: "Tiempo completo",
    description: "Ayuda a nuestros clientes a tener éxito con STApp brindando soporte técnico y orientación de primera clase.",
  },
]

const benefits = [
  {
    icon: Rocket,
    title: "Crecimiento Profesional",
    description: "Oportunidades de desarrollo y capacitación continua",
  },
  {
    icon: Users,
    title: "Equipo Increíble",
    description: "Trabaja con personas talentosas y apasionadas",
  },
  {
    icon: Heart,
    title: "Equilibrio Vida-Trabajo",
    description: "Horarios flexibles y trabajo 100% remoto",
  },
  {
    icon: Zap,
    title: "Impacto Real",
    description: "Tu trabajo ayuda a negocios reales a crecer",
  },
  {
    icon: Coffee,
    title: "Ambiente Relajado",
    description: "Cultura empresarial positiva y colaborativa",
  },
  {
    icon: GraduationCap,
    title: "Aprendizaje Continuo",
    description: "Presupuesto para cursos y conferencias",
  },
]

export default function TrabajaConNosotrosPage() {
  return (
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
      <section className="py-16 sm:py-24 bg-gradient-to-r from-primary/10 to-primary/5">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-6">
              Únete a Nuestro Equipo
            </h1>
            <p className="text-xl text-muted-foreground mb-8">
              Estamos construyendo el futuro de la gestión de talleres de reparación.
              ¿Quieres ser parte de esta misión?
            </p>
            <Button size="lg" className="gap-2">
              <Briefcase className="h-5 w-5" />
              Ver posiciones abiertas
            </Button>
          </div>
        </div>
      </section>

      {/* Why Join Us */}
      <section className="py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl font-bold text-foreground mb-4 text-center">
              ¿Por qué trabajar en STApp?
            </h2>
            <p className="text-lg text-muted-foreground mb-12 text-center max-w-2xl mx-auto">
              Ofrecemos un ambiente de trabajo único donde puedes crecer profesionalmente
              mientras impactas positivamente en negocios reales.
            </p>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {benefits.map((benefit) => (
                <Card key={benefit.title} className="text-center">
                  <CardHeader>
                    <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                      <benefit.icon className="h-7 w-7 text-primary" />
                    </div>
                    <CardTitle className="text-lg">{benefit.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground">{benefit.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Open Positions */}
      <section className="py-16 bg-muted/50">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl font-bold text-foreground mb-12 text-center">
              Posiciones Abiertas
            </h2>

            <div className="space-y-6">
              {openPositions.map((position) => (
                <Card key={position.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                      <div>
                        <CardTitle className="text-xl mb-2">{position.title}</CardTitle>
                        <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Briefcase className="h-4 w-4" />
                            <span>{position.department}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <MapPin className="h-4 w-4" />
                            <span>{position.location}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="h-4 w-4" />
                            <span>{position.type}</span>
                          </div>
                        </div>
                      </div>
                      <Button className="whitespace-nowrap">Aplicar</Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground">{position.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {openPositions.length === 0 && (
              <div className="text-center py-12">
                <p className="text-muted-foreground text-lg mb-4">
                  No hay posiciones abiertas en este momento
                </p>
                <p className="text-muted-foreground">
                  ¡Pero siempre estamos buscando talento excepcional! Envíanos tu CV a{" "}
                  <a href="mailto:jobs@stapp.com" className="text-primary hover:underline">
                    jobs@stapp.com
                  </a>
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Culture */}
      <section className="py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl font-bold text-foreground mb-8 text-center">
              Nuestra Cultura
            </h2>
            <div className="prose prose-lg dark:prose-invert max-w-none">
              <p className="text-muted-foreground mb-6 text-center">
                En STApp valoramos la innovación, la colaboración y el crecimiento personal.
                Creemos que los mejores resultados provienen de equipos diversos y
                apasionados que trabajan juntos hacia un objetivo común.
              </p>
              <div className="grid md:grid-cols-3 gap-6 mt-8 text-center">
                <div>
                  <h3 className="font-semibold text-foreground mb-2">🚀 Innovación</h3>
                  <p className="text-muted-foreground text-sm">
                    Experimentamos, aprendemos y mejoramos constantemente
                  </p>
                </div>
                <div>
                  <h3 className="font-semibold text-foreground mb-2">🤝 Colaboración</h3>
                  <p className="text-muted-foreground text-sm">
                    Trabajamos juntos, compartimos conocimientos y nos apoyamos
                  </p>
                </div>
                <div>
                  <h3 className="font-semibold text-foreground mb-2">💪 Ownership</h3>
                  <p className="text-muted-foreground text-sm">
                    Tomamos responsabilidad y lideramos nuestros proyectos
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-primary/5">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl font-bold text-foreground mb-4">
              ¿No ves la posición perfecta para ti?
            </h2>
            <p className="text-muted-foreground mb-8">
              Envíanos tu CV de todas formas. Siempre estamos buscando personas
              talentosas y apasionadas.
            </p>
            <Button size="lg" variant="outline" asChild>
              <a href="mailto:jobs@stapp.com">Enviar CV</a>
            </Button>
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
  )
}
