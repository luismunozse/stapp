"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  ArrowLeft,
  Search,
  BookOpen,
  Smartphone,
  CreditCard,
  Shield,
  ClipboardList,
  Package,
  FileText,
  Users,
  ChevronDown,
  MessageCircle,
  Mail,
  Headset,
} from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"

const categories = [
  {
    icon: BookOpen,
    title: "Primeros pasos",
    description: "Cómo registrarte, configurar tu cuenta y empezar a usar STApp",
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-950/50",
  },
  {
    icon: ClipboardList,
    title: "Órdenes de servicio",
    description: "Crear, gestionar y dar seguimiento a las reparaciones",
    color: "text-purple-600 dark:text-purple-400",
    bgColor: "bg-purple-50 dark:bg-purple-950/50",
  },
  {
    icon: Users,
    title: "Clientes y técnicos",
    description: "Administrar clientes, técnicos y vendedores",
    color: "text-green-600 dark:text-green-400",
    bgColor: "bg-green-50 dark:bg-green-950/50",
  },
  {
    icon: Package,
    title: "Inventario",
    description: "Control de stock, repuestos y proveedores",
    color: "text-orange-600 dark:text-orange-400",
    bgColor: "bg-orange-50 dark:bg-orange-950/50",
  },
  {
    icon: FileText,
    title: "Facturación y ventas",
    description: "Presupuestos, facturas y registro de ventas",
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-50 dark:bg-red-950/50",
  },
  {
    icon: CreditCard,
    title: "Suscripción y pagos",
    description: "Planes, métodos de pago y facturación de tu suscripción",
    color: "text-emerald-600 dark:text-emerald-400",
    bgColor: "bg-emerald-50 dark:bg-emerald-950/50",
  },
  {
    icon: Smartphone,
    title: "App móvil",
    description: "Instalación de la app Android, PWA y acceso desde celular",
    color: "text-cyan-600 dark:text-cyan-400",
    bgColor: "bg-cyan-50 dark:bg-cyan-950/50",
  },
  {
    icon: Shield,
    title: "Seguridad y privacidad",
    description: "Protección de datos, permisos y configuración de seguridad",
    color: "text-slate-600 dark:text-slate-400",
    bgColor: "bg-slate-50 dark:bg-slate-950/50",
  },
]

const faqs = [
  {
    category: "Primeros pasos",
    items: [
      {
        question: "¿Cómo creo mi cuenta en STApp?",
        answer:
          "Ingresá a stapp.com.ar y hacé clic en \"Comenzar Gratis\". Completá el formulario con tu nombre, email y contraseña. Verificá tu email y ya podés empezar a usar todas las funciones durante 30 días gratis sin necesidad de tarjeta de crédito.",
      },
      {
        question: "¿Necesito instalar algo en mi computadora?",
        answer:
          "No, STApp es una aplicación web que funciona directamente en tu navegador desde cualquier dispositivo. Solo necesitas conexión a internet. Además, podés descargar la app nativa para Android (APK), instalarla como PWA en cualquier dispositivo, y próximamente estará disponible también en iOS.",
      },
      {
        question: "¿Cómo configuro mi taller por primera vez?",
        answer:
          "Al ingresar por primera vez, te recomendamos: 1) Completar los datos de tu empresa en Configuración, 2) Agregar tus técnicos y vendedores, 3) Cargar tu inventario de repuestos, 4) Crear tu primera orden de servicio. Podés usar el tour guiado disponible en el menú para conocer todas las funciones.",
      },
    ],
  },
  {
    category: "Órdenes de servicio",
    items: [
      {
        question: "¿Cómo creo una nueva orden de reparación?",
        answer:
          "Desde el panel principal, andá a \"Órdenes\" y hacé clic en \"Nueva Orden\". Completá los datos del cliente (o seleccioná uno existente), cargá la información del equipo, describí el problema y asigná un técnico. La orden se crea con estado \"Pendiente\" y podés actualizarla a medida que avance la reparación.",
      },
      {
        question: "¿Cómo le aviso a mi cliente que su equipo está listo?",
        answer:
          "Cuando cambies el estado de la orden a \"Completada\" o \"Lista para retirar\", podés enviar una notificación automática al cliente por WhatsApp con un solo clic. STApp incluye plantillas predeterminadas que podés personalizar con los datos de la reparación.",
      },
      {
        question: "¿El cliente puede ver el estado de su reparación?",
        answer:
          "Sí, cada orden genera un enlace de seguimiento único que podés compartir con el cliente. Desde ahí puede ver el estado actual, los detalles del equipo y el historial de actualizaciones sin necesitar una cuenta en STApp.",
      },
    ],
  },
  {
    category: "Suscripción y pagos",
    items: [
      {
        question: "¿Puedo probar antes de pagar?",
        answer:
          "¡Por supuesto! Tenés 30 días gratis con acceso completo a todas las funciones, sin necesidad de tarjeta de crédito. Si no te convence, simplemente no hacés nada y la prueba finaliza sin ningún cargo.",
      },
      {
        question: "¿Qué métodos de pago aceptan?",
        answer:
          "Aceptamos tarjetas de crédito, débito, efectivo y otros medios de pago a través de MercadoPago. Podés elegir entre plan mensual o anual (con descuento). Los pagos se procesan de forma segura.",
      },
      {
        question: "¿Puedo cancelar mi suscripción en cualquier momento?",
        answer:
          "Sí, podés cancelar cuando quieras sin penalidades ni cargos ocultos. Mantendrás el acceso a todas las funciones hasta el final del período ya facturado.",
      },
    ],
  },
  {
    category: "Datos y seguridad",
    items: [
      {
        question: "¿Mis datos están seguros?",
        answer:
          "Absolutamente. Usamos encriptación HTTPS/TLS, controles de acceso estrictos, monitoreo continuo y copias de seguridad periódicas. Tu información y la de tus clientes está protegida en todo momento.",
      },
      {
        question: "¿Puedo importar y exportar mis datos?",
        answer:
          "Sí, podés importar clientes e inventario desde archivos Excel o CSV con plantillas descargables y validación automática. También podés exportar tus datos en cualquier momento. Tus datos son tuyos siempre.",
      },
    ],
  },
  {
    category: "Funciones",
    items: [
      {
        question: "¿Cómo funcionan las notificaciones por WhatsApp?",
        answer:
          "STApp incluye plantillas listas para enviar actualizaciones a tus clientes por WhatsApp: aviso de equipo listo, presupuestos, seguimiento de reparación y más. Todo con un solo clic desde la orden de servicio.",
      },
      {
        question: "¿Puedo gestionar varios técnicos y vendedores?",
        answer:
          "Sí, podés agregar técnicos y vendedores ilimitados. Asigná reparaciones, visualizá la carga de trabajo de cada uno y seguí el rendimiento del equipo con métricas en tiempo real.",
      },
      {
        question: "¿Pueden agregar funciones que necesito?",
        answer:
          "¡Claro! Estamos en constante mejora basándonos en el feedback de nuestros usuarios. Podés enviar sugerencias desde el sistema de soporte dentro de la app y muchas funciones nuevas nacen de las ideas de nuestros clientes.",
      },
    ],
  },
]

export default function AyudaPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [openFaq, setOpenFaq] = useState<string | null>(null)

  const filteredFaqs = faqs
    .map((category) => ({
      ...category,
      items: category.items.filter(
        (item) =>
          item.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.answer.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    }))
    .filter((category) => category.items.length > 0)

  const totalResults = filteredFaqs.reduce(
    (acc, cat) => acc + cat.items.length,
    0
  )

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
      <section className="py-16 sm:py-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4">
              Centro de Ayuda
            </h1>
            <p className="text-xl text-muted-foreground mb-8">
              Encontrá respuestas a tus preguntas y aprendé a sacar el máximo
              provecho de STApp.
            </p>

            {/* Search */}
            <div className="relative max-w-xl mx-auto">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Buscar en el centro de ayuda..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-12 h-12 text-base rounded-full border-2 focus-visible:ring-primary"
              />
              {searchQuery && (
                <p className="text-sm text-muted-foreground mt-2">
                  {totalResults} {totalResults === 1 ? "resultado" : "resultados"} encontrados
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Categories Grid */}
      {!searchQuery && (
        <section className="pb-16">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-5xl mx-auto">
              <h2 className="text-2xl font-bold text-foreground mb-6 text-center">
                Categorías de ayuda
              </h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {categories.map((category) => (
                  <button
                    key={category.title}
                    type="button"
                    onClick={() => {
                      setSearchQuery(category.title.split(" ")[0])
                    }}
                    className="text-left"
                  >
                    <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer hover:border-primary/30">
                      <CardContent className="pt-6">
                        <div
                          className={`w-12 h-12 ${category.bgColor} rounded-lg flex items-center justify-center mb-3`}
                        >
                          <category.icon
                            className={`h-6 w-6 ${category.color}`}
                          />
                        </div>
                        <h3 className="font-semibold text-foreground mb-1 text-sm">
                          {category.title}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {category.description}
                        </p>
                      </CardContent>
                    </Card>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* FAQ Section */}
      <section className="pb-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl font-bold text-foreground mb-8 text-center">
              Preguntas frecuentes
            </h2>

            {filteredFaqs.length === 0 ? (
              <div className="text-center py-12">
                <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  No encontramos resultados
                </h3>
                <p className="text-muted-foreground mb-6">
                  Probá con otros términos o contactanos directamente.
                </p>
                <Button asChild>
                  <Link href="/empresa/contacto">Contactar soporte</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-8">
                {filteredFaqs.map((category) => (
                  <div key={category.category}>
                    <h3 className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">
                      {category.category}
                    </h3>
                    <div className="border rounded-lg overflow-hidden">
                      {category.items.map((item, index) => {
                        const faqKey = `${category.category}-${index}`
                        const isOpen = openFaq === faqKey
                        return (
                          <div
                            key={faqKey}
                            className={
                              index > 0 ? "border-t" : ""
                            }
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setOpenFaq(isOpen ? null : faqKey)
                              }
                              className="flex items-center justify-between w-full px-5 py-4 text-left hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                              aria-expanded={isOpen}
                            >
                              <span className="font-medium text-foreground pr-4">
                                {item.question}
                              </span>
                              <ChevronDown
                                className={`h-5 w-5 text-muted-foreground flex-shrink-0 transition-transform duration-200 ${
                                  isOpen ? "rotate-180" : ""
                                }`}
                              />
                            </button>
                            {isOpen && (
                              <div className="px-5 pb-4">
                                <p className="text-muted-foreground leading-relaxed">
                                  {item.answer}
                                </p>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Contact CTA Section */}
      <section className="pb-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto">
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="pt-8 pb-8">
                <div className="text-center mb-6">
                  <h2 className="text-2xl font-bold text-foreground mb-2">
                    ¿No encontraste lo que buscabas?
                  </h2>
                  <p className="text-muted-foreground">
                    Nuestro equipo está listo para ayudarte. Elegí el canal que
                    prefieras.
                  </p>
                </div>
                <div className="grid sm:grid-cols-3 gap-4">
                  <Link href="/empresa/contacto">
                    <Card className="h-full hover:shadow-md transition-shadow cursor-pointer">
                      <CardContent className="pt-6 text-center">
                        <Mail className="h-8 w-8 text-blue-600 dark:text-blue-400 mx-auto mb-3" />
                        <h3 className="font-semibold text-foreground text-sm mb-1">
                          Email
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          Envianos tu consulta
                        </p>
                      </CardContent>
                    </Card>
                  </Link>
                  <a
                    href="https://wa.me/541112345678"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Card className="h-full hover:shadow-md transition-shadow cursor-pointer">
                      <CardContent className="pt-6 text-center">
                        <WhatsAppIcon className="h-8 w-8 text-emerald-600 dark:text-emerald-400 mx-auto mb-3" />
                        <h3 className="font-semibold text-foreground text-sm mb-1">
                          WhatsApp
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          Respuesta rápida
                        </p>
                      </CardContent>
                    </Card>
                  </a>
                  <Link href="/login">
                    <Card className="h-full hover:shadow-md transition-shadow cursor-pointer">
                      <CardContent className="pt-6 text-center">
                        <Headset className="h-8 w-8 text-purple-600 dark:text-purple-400 mx-auto mb-3" />
                        <h3 className="font-semibold text-foreground text-sm mb-1">
                          Soporte
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          Tickets desde tu panel
                        </p>
                      </CardContent>
                    </Card>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-card py-8">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 text-sm text-muted-foreground">
            <p>
              &copy; {new Date().getFullYear()} STApp. Todos los derechos
              reservados.
            </p>
            <div className="flex gap-4">
              <Link
                href="/legal/terminos"
                className="hover:text-foreground transition-colors"
              >
                Términos
              </Link>
              <Link
                href="/legal/privacidad"
                className="hover:text-foreground transition-colors"
              >
                Privacidad
              </Link>
              <Link
                href="/empresa/contacto"
                className="hover:text-foreground transition-colors"
              >
                Contacto
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
