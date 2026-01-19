import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Users, Target, Award, Heart } from "lucide-react"

export const metadata = {
  title: "Sobre Nosotros - STApp",
  description: "Conoce más sobre STApp y nuestro equipo dedicado a transformar la gestión de talleres de reparación.",
}

export default function SobreNosotrosPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/50 to-background">
      {/* Header */}
      <header className="border-b bg-card">
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
      <section className="py-16 sm:py-24">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-6">
              Sobre Nosotros
            </h1>
            <p className="text-xl text-muted-foreground">
              Somos un equipo apasionado por facilitar la gestión de talleres de
              reparación de dispositivos electrónicos en toda Latinoamérica.
            </p>
          </div>
        </div>
      </section>

      {/* Nuestra Historia */}
      <section className="py-16 bg-card">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl font-bold text-foreground mb-8">Nuestra Historia</h2>
            <div className="prose prose-lg dark:prose-invert max-w-none">
              <p className="text-muted-foreground mb-6">
                STApp nació de la experiencia directa en la industria de reparación de
                dispositivos electrónicos. Observamos que muchos talleres de reparación
                enfrentaban desafíos similares: gestión de órdenes desorganizada, control
                de inventario deficiente, y falta de herramientas para comunicarse
                efectivamente con sus clientes.
              </p>
              <p className="text-muted-foreground mb-6">
                En 2023, decidimos crear una solución integral que abordara estos problemas
                de manera simple y efectiva. Desde entonces, hemos trabajado incansablemente
                para desarrollar un sistema que no solo resuelva estos desafíos, sino que
                también impulse el crecimiento de los negocios de nuestros clientes.
              </p>
              <p className="text-muted-foreground">
                Hoy, STApp es utilizado por talleres de reparación en toda Latinoamérica,
                ayudándoles a gestionar miles de órdenes de servicio, optimizar su inventario
                y brindar un mejor servicio a sus clientes.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Valores */}
      <section className="py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl font-bold text-foreground mb-12 text-center">
              Nuestros Valores
            </h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
              <div className="text-center">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Users className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-3">
                  Orientados al Cliente
                </h3>
                <p className="text-muted-foreground">
                  Escuchamos las necesidades de nuestros usuarios y desarrollamos
                  soluciones que realmente les ayuden.
                </p>
              </div>

              <div className="text-center">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Target className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-3">
                  Innovación Constante
                </h3>
                <p className="text-muted-foreground">
                  Mejoramos continuamente nuestra plataforma con nuevas funcionalidades
                  y tecnologías.
                </p>
              </div>

              <div className="text-center">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Award className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-3">
                  Excelencia
                </h3>
                <p className="text-muted-foreground">
                  Nos esforzamos por ofrecer la mejor calidad en cada aspecto de
                  nuestro servicio.
                </p>
              </div>

              <div className="text-center">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Heart className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-3">
                  Compromiso
                </h3>
                <p className="text-muted-foreground">
                  Estamos comprometidos con el éxito de cada taller que confía en
                  nosotros.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Nuestra Misión */}
      <section className="py-16 bg-primary/5">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl font-bold text-foreground mb-6">Nuestra Misión</h2>
            <p className="text-xl text-muted-foreground mb-8">
              Empoderar a los talleres de reparación de dispositivos electrónicos con
              herramientas tecnológicas que simplifiquen su operación, mejoren la
              experiencia de sus clientes y les permitan crecer de manera sostenible.
            </p>
            <Link href="/registro">
              <Button size="lg" className="gap-2">
                Únete a STApp
              </Button>
            </Link>
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
