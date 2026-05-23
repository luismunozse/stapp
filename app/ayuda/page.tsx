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

const SUPPORT_WHATSAPP_NUMBER = "5491169625733"
const SUPPORT_WHATSAPP_DISPLAY = "+54 9 11 6962-5733"
const SUPPORT_WHATSAPP_URL = `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(
  "Hola! Necesito ayuda con STApp."
)}`

const categories = [
  {
    icon: BookOpen,
    title: "Primeros pasos",
    description: "Registro, configuración inicial del taller y prueba gratuita de 30 días",
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-950/50",
  },
  {
    icon: ClipboardList,
    title: "Órdenes de servicio",
    description: "Recepción, diagnóstico, presupuesto, reparación y entrega de equipos",
    color: "text-purple-600 dark:text-purple-400",
    bgColor: "bg-purple-50 dark:bg-purple-950/50",
  },
  {
    icon: Users,
    title: "Equipo y roles",
    description: "Administrar técnicos, vendedores y permisos por rol",
    color: "text-green-600 dark:text-green-400",
    bgColor: "bg-green-50 dark:bg-green-950/50",
  },
  {
    icon: Package,
    title: "Inventario y proveedores",
    description: "Control de stock, repuestos, importación CSV y proveedores",
    color: "text-orange-600 dark:text-orange-400",
    bgColor: "bg-orange-50 dark:bg-orange-950/50",
  },
  {
    icon: FileText,
    title: "POS, caja y ventas",
    description: "Punto de venta, cobros, presupuestos y facturación",
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-50 dark:bg-red-950/50",
  },
  {
    icon: CreditCard,
    title: "Suscripción y pagos",
    description: "Plan Free, plan Premium y pagos con MercadoPago",
    color: "text-emerald-600 dark:text-emerald-400",
    bgColor: "bg-emerald-50 dark:bg-emerald-950/50",
  },
  {
    icon: Smartphone,
    title: "App móvil y PWA",
    description: "App Android (APK), PWA instalable y acceso desde el navegador",
    color: "text-cyan-600 dark:text-cyan-400",
    bgColor: "bg-cyan-50 dark:bg-cyan-950/50",
  },
  {
    icon: Shield,
    title: "Seguridad y datos",
    description: "Multi-tenant, roles, copias de seguridad e import/export CSV",
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
          "Ingresá a stapp.com.ar y hacé clic en \"Comenzar gratis\". Completá el formulario con el nombre de tu taller, tu email y una contraseña. Cada cuenta crea su propia organización (multi-tenant), así que tus datos quedan totalmente aislados de los de otros talleres. Empezás con 30 días de prueba del plan Premium sin tarjeta de crédito.",
      },
      {
        question: "¿Necesito instalar algo en mi computadora?",
        answer:
          "No. STApp funciona en cualquier navegador moderno desde computadora, tablet o celular. Si querés una experiencia tipo app, podés instalarla como PWA en uno o dos clics, o descargar la app nativa para Android (APK) desde la sección Descargas del menú.",
      },
      {
        question: "¿Cómo configuro mi taller por primera vez?",
        answer:
          "Te recomendamos este orden: 1) Completar los datos de tu empresa, logo y datos fiscales en Configuración, 2) Agregar tus técnicos y vendedores en la sección Equipo, 3) Cargar tu inventario de repuestos (manualmente o importando un CSV), 4) Configurar tus plantillas de WhatsApp y, 5) Crear tu primera orden de servicio. Podés importar clientes e inventario desde Configuración → Importaciones.",
      },
      {
        question: "¿Qué incluye la prueba gratuita de 30 días?",
        answer:
          "Acceso total al plan Premium: órdenes ilimitadas, técnicos y vendedores ilimitados, POS, caja, facturación, reportes avanzados, importación CSV y notificaciones por WhatsApp. No pedimos tarjeta de crédito y, al terminar el trial, tu cuenta pasa automáticamente al plan Free salvo que decidas suscribirte.",
      },
    ],
  },
  {
    category: "Órdenes de servicio",
    items: [
      {
        question: "¿Cómo creo una nueva orden de reparación?",
        answer:
          "Desde el menú lateral entrá a \"Órdenes\" y hacé clic en \"Nueva orden\". Cargá el cliente (existente o nuevo), los datos del equipo (marca, modelo, serie, accesorios), la falla reportada y asigná un técnico responsable. La orden se crea en estado RECIBIDO y avanza a medida que actualizás su estado.",
      },
      {
        question: "¿Qué estados puede tener una orden?",
        answer:
          "El flujo completo es: RECIBIDO → EN DIAGNÓSTICO → PRESUPUESTADO → APROBADO → EN REPARACIÓN → ESPERANDO REPUESTO → REPARADO → ENTREGADO. Además existen los estados CANCELADO y SIN REPARACIÓN cuando corresponde. Cada cambio de estado queda registrado en el historial de la orden.",
      },
      {
        question: "¿Cómo le aviso al cliente que su equipo está listo?",
        answer:
          "Cuando la orden pasa a REPARADO podés enviar una notificación por WhatsApp con un clic desde el detalle de la orden. STApp trae plantillas listas (aviso de presupuesto, listo para retirar, entrega completada, etc.) que podés personalizar en Configuración → Notificaciones.",
      },
      {
        question: "¿El cliente puede consultar el estado de su reparación?",
        answer:
          "Sí. Cada orden genera un enlace público de seguimiento con un token único (/seguimiento/[token]). El cliente accede sin necesidad de cuenta y ve el estado actual, los datos de su equipo, las observaciones del técnico y el historial de actualizaciones.",
      },
    ],
  },
  {
    category: "POS, caja y ventas",
    items: [
      {
        question: "¿STApp incluye punto de venta (POS)?",
        answer:
          "Sí. Tiene un POS pensado para el mostrador con búsqueda rápida de productos por código o nombre, lectura de códigos de barras, descuentos, múltiples medios de pago y emisión de tickets que se pueden imprimir o compartir por WhatsApp.",
      },
      {
        question: "¿Cómo funciona la caja?",
        answer:
          "El módulo Caja registra cada cobro, gasto y movimiento del día. Podés abrir y cerrar caja por turno, registrar ingresos por reparaciones y ventas, gastos, y obtener el arqueo automático con el desglose por medio de pago.",
      },
      {
        question: "¿Qué medios de pago puedo registrar para mis clientes?",
        answer:
          "STApp soporta efectivo, transferencia, tarjeta de débito, tarjeta de crédito, MercadoPago, cuenta corriente del cliente y otros. Todos los cobros quedan vinculados a la orden o venta correspondiente.",
      },
      {
        question: "¿Puedo emitir presupuestos y facturas?",
        answer:
          "Sí. Podés generar presupuestos (cotizaciones) desde una orden o desde cero, enviarlos al cliente por WhatsApp o email y convertirlos en orden o venta cuando sean aprobados. La sección de Facturación te permite registrar y consultar los comprobantes emitidos.",
      },
    ],
  },
  {
    category: "Equipo y roles",
    items: [
      {
        question: "¿Qué roles existen en STApp?",
        answer:
          "Tres roles principales: ADMIN (acceso completo a todos los módulos y configuración), TÉCNICO (órdenes asignadas, clientes, presupuestos y diagnósticos) y VENDEDOR (POS, ventas, clientes, proveedores y reportes de ventas). Cada usuario sólo ve las secciones que le corresponden.",
      },
      {
        question: "¿Puedo gestionar varios técnicos y vendedores?",
        answer:
          "Sí. En el plan Premium podés agregar técnicos y vendedores ilimitados, asignar reparaciones, ver la carga de trabajo de cada uno y medir el rendimiento del equipo con reportes en tiempo real. El plan Free permite hasta 2 técnicos y 2 vendedores.",
      },
    ],
  },
  {
    category: "Inventario y proveedores",
    items: [
      {
        question: "¿Cómo controlo el stock de repuestos?",
        answer:
          "Desde Inventario podés cargar productos con código, precio, stock actual, stock mínimo y proveedor. Cada vez que usás un repuesto en una orden o lo vendés en el POS, el stock se descuenta automáticamente. Recibís alertas cuando un producto baja del stock mínimo.",
      },
      {
        question: "¿Puedo importar mis productos desde Excel o CSV?",
        answer:
          "Sí. En Configuración → Importaciones encontrás plantillas descargables para clientes e inventario. Subís el archivo, el sistema valida fila por fila y te muestra los errores antes de confirmar la importación.",
      },
      {
        question: "¿Puedo gestionar proveedores y compras?",
        answer:
          "Sí. La sección Proveedores te permite registrar a tus distribuidores con datos de contacto, condiciones y deuda. Podés vincular productos a proveedores y registrar compras para mantener el stock al día.",
      },
    ],
  },
  {
    category: "Suscripción y pagos",
    items: [
      {
        question: "¿Qué incluye el plan Free?",
        answer:
          "El plan Free incluye hasta 50 órdenes por mes, 100 clientes, 2 técnicos, 2 vendedores y 100 MB de almacenamiento. Es ideal para arrancar o para talleres muy chicos. Cuando necesites más capacidad podés pasar al plan Premium en cualquier momento.",
      },
      {
        question: "¿Qué incluye el plan Premium?",
        answer:
          "Órdenes, clientes, técnicos y vendedores ilimitados, POS, caja, presupuestos, facturación, reportes avanzados, importación CSV, app móvil, notificaciones por WhatsApp, soporte prioritario y todas las funciones nuevas que vayamos liberando.",
      },
      {
        question: "¿Qué métodos de pago aceptan para la suscripción?",
        answer:
          "La suscripción se paga a través de MercadoPago, lo que te permite usar tarjeta de crédito, débito, dinero en cuenta o cualquier medio habilitado por MercadoPago. Podés elegir facturación mensual o anual (con descuento sobre el total).",
      },
      {
        question: "¿Puedo cancelar mi suscripción en cualquier momento?",
        answer:
          "Sí, podés cancelar cuando quieras desde Configuración → Suscripción, sin penalidades ni cargos ocultos. Mantenés el acceso al plan Premium hasta que termine el período ya facturado y luego tu cuenta pasa al plan Free.",
      },
    ],
  },
  {
    category: "App móvil y PWA",
    items: [
      {
        question: "¿Cómo instalo la app de Android?",
        answer:
          "Desde el menú entrá a \"Descargar app\" → Android. Vas a poder bajar el APK e instalarlo en tu celular. Como es una instalación fuera de la Play Store, Android te va a pedir habilitar \"Instalar de fuentes desconocidas\" la primera vez.",
      },
      {
        question: "¿Puedo usar STApp como PWA?",
        answer:
          "Sí. Desde el navegador (Chrome, Edge, Safari) podés instalar STApp como aplicación con un clic en \"Instalar app\". Funciona en Android, iPhone, Windows, Mac y Linux, ocupa muy poco espacio y se actualiza sola.",
      },
      {
        question: "¿Puedo trabajar desde el celular?",
        answer:
          "Sí. Toda la interfaz está optimizada para pantallas chicas: técnicos pueden actualizar órdenes desde el celular, vendedores pueden cobrar con el POS móvil y los administradores pueden consultar reportes desde cualquier lado.",
      },
    ],
  },
  {
    category: "Seguridad y datos",
    items: [
      {
        question: "¿Mis datos están seguros?",
        answer:
          "Sí. STApp usa conexión cifrada HTTPS/TLS, autenticación con tokens, control de acceso por rol y aislamiento por organización: ningún taller puede ver los datos de otro. Hacemos copias de seguridad periódicas en infraestructura administrada.",
      },
      {
        question: "¿Puedo exportar mis datos?",
        answer:
          "Sí. Podés exportar clientes, inventario, órdenes y reportes en CSV/Excel desde cada módulo. Tus datos son tuyos siempre y podés llevártelos cuando quieras.",
      },
      {
        question: "¿Cómo gestiono los permisos del equipo?",
        answer:
          "Cada usuario se crea con un rol (ADMIN, TÉCNICO o VENDEDOR) que define a qué módulos puede acceder. Como ADMIN podés crear, editar y desactivar usuarios desde la sección Equipo.",
      },
    ],
  },
  {
    category: "Soporte y mejoras",
    items: [
      {
        question: "¿Cómo abro un ticket de soporte?",
        answer:
          "Dentro de la app, en la sección Soporte, podés crear un ticket detallando tu consulta o problema. Nuestro equipo lo recibe y te responde directamente en el panel. También podés escribirnos por WhatsApp para temas urgentes.",
      },
      {
        question: "¿Cómo funcionan las notificaciones por WhatsApp a clientes?",
        answer:
          "STApp incluye plantillas listas para enviar avisos a tus clientes: presupuesto disponible, actualización de estado, equipo listo para retirar, entrega completada y más. Todo con un clic desde la orden, usando el WhatsApp instalado en tu computadora o celular.",
      },
      {
        question: "¿Pueden agregar funciones que necesito?",
        answer:
          "¡Claro! Estamos en mejora continua basándonos en el feedback de los talleres que usan STApp. Podés enviar sugerencias desde el módulo Soporte y muchas funciones nuevas nacen de las ideas de nuestros usuarios.",
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

      {/* Manual CTA */}
      {!searchQuery && (
        <section className="pb-8">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <Link href="/ayuda/manual">
                <Card className="group hover:shadow-lg transition-all cursor-pointer border-primary/20 bg-primary/5 hover:border-primary/40">
                  <CardContent className="pt-6 pb-6">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 bg-primary/10 rounded-xl flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                        <BookOpen className="h-7 w-7 text-primary" />
                      </div>
                      <div className="flex-1">
                        <h2 className="text-xl font-bold text-foreground mb-1">
                          Manual de Uso Completo
                        </h2>
                        <p className="text-sm text-muted-foreground">
                          Guía detallada de todas las funciones de STApp para Administradores, Técnicos y Vendedores.
                        </p>
                      </div>
                      <ChevronDown className="h-5 w-5 text-muted-foreground -rotate-90 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </div>
          </div>
        </section>
      )}

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
              <div className="space-y-4 md:space-y-8">
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
                    href={SUPPORT_WHATSAPP_URL}
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
                          {SUPPORT_WHATSAPP_DISPLAY}
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
