"use client"

import {
  ClipboardList,
  Package,
  Receipt,
  Users,
  Calculator,
  Camera,
  PenLine,
  ShieldCheck,
  Bell,
  Wrench,
  BarChart3,
  Smartphone,
  Settings,
  Zap,
  ShoppingCart,
  Link2,
  Monitor,
  Truck,
  UserCheck,
  Wallet,
  Banknote,
  PiggyBank,
  ClipboardCheck,
  LayoutDashboard,
  Megaphone,
  Bot,
  Mail,
} from "lucide-react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { m, LazyMotion, domAnimation } from "@/components/animations/motion"

const categories = [
  {
    id: "servicio",
    name: "Servicio Técnico",
    icon: Wrench,
    description: "Gestiona el flujo completo de reparaciones",
    features: [
      {
        name: "Órdenes de Servicio",
        description:
          "El corazón de tu taller. Creá una orden en menos de 1 minuto con estados en tiempo real, checklists personalizados y seguimiento completo.",
        icon: ClipboardList,
        color: "bg-blue-500",
      },
      {
        name: "Cotizaciones y Presupuestos",
        description:
          "Creá presupuestos profesionales con descuentos, impuestos y condiciones. Tu cliente los aprueba online con firma digital desde un link, sin necesidad de cuenta.",
        icon: Calculator,
        color: "bg-indigo-500",
      },
      {
        name: "Fotos por Etapa",
        description:
          "Documenta cada paso: ingreso, durante la reparación y entrega. Protegé tu taller ante cualquier reclamo con evidencia visual.",
        icon: Camera,
        color: "bg-amber-500",
      },
      {
        name: "Portal de Seguimiento",
        description:
          "Tu cliente sigue su reparación en tiempo real desde un link, sin crear cuenta. Ve el estado, fotos, garantía y descarga el comprobante en PDF.",
        icon: Link2,
        color: "bg-emerald-500",
      },
    ],
  },
  {
    id: "administracion",
    name: "Administración",
    icon: Settings,
    description: "Control total de clientes, stock y finanzas",
    features: [
      {
        name: "Gestión de Clientes",
        description:
          "Historial completo y automático: reparaciones, pagos y cuenta corriente. Cuando un cliente vuelve, en 2 clicks ya sabés todo.",
        icon: Users,
        color: "bg-orange-500",
      },
      {
        name: "Control de Inventario",
        description:
          "Alertas de stock bajo, historial de precios, costos y márgenes en tiempo real. Importá tu inventario desde Excel o CSV en minutos.",
        icon: Package,
        color: "bg-green-500",
      },
      {
        name: "Cobros y Facturación",
        description:
          "De la orden al cobro en un click. Pagos parciales, cuotas con recargo, comprobantes automáticos y un panel claro de quién te debe y cuánto.",
        icon: Receipt,
        color: "bg-purple-500",
      },
      {
        name: "Sistema de Garantías",
        description:
          "Garantías vigentes, vencimientos, reclamos pendientes y reingresos vinculados a la orden original. Todo trazable, sin perder nada.",
        icon: ShieldCheck,
        color: "bg-red-500",
      },
    ],
  },
  {
    id: "ventas",
    name: "Ventas",
    icon: ShoppingCart,
    description: "Vendé productos y gestioná tu equipo comercial",
    features: [
      {
        name: "Punto de Venta",
        description:
          "Registrá ventas de accesorios y repuestos con garantía por producto, múltiples medios de pago y gestión de devoluciones incluida.",
        icon: ShoppingCart,
        color: "bg-teal-500",
      },
      {
        name: "Proveedores",
        description:
          "Gestioná tus proveedores con datos de contacto, WhatsApp y notas. Sabé a quién pedirle cada repuesto sin buscar en la agenda.",
        icon: Truck,
        color: "bg-lime-600",
      },
      {
        name: "Equipo Comercial",
        description:
          "Técnicos, vendedores y administradores con roles diferenciados. Medí el rendimiento de cada uno con métricas individuales.",
        icon: UserCheck,
        color: "bg-violet-500",
      },
      {
        name: "Modo Kiosco",
        description:
          "Mostrá el estado de las reparaciones en una pantalla en tu local. Tu cliente ve el avance sin preguntar. Personalizable y sin login.",
        icon: Monitor,
        color: "bg-sky-500",
      },
    ],
  },
  {
    id: "finanzas",
    name: "Finanzas",
    icon: Banknote,
    description: "Control total del dinero que entra y sale de tu taller",
    features: [
      {
        name: "Caja Diaria",
        description:
          "Apertura y cierre de caja con control de efectivo, movimientos del día, ingresos y egresos. Sabé exactamente cuánta plata hay en tu local en todo momento.",
        icon: Banknote,
        color: "bg-emerald-600",
      },
      {
        name: "Gestión de Gastos",
        description:
          "Registrá gastos por categoría, programá gastos recurrentes (alquiler, servicios, sueldos) y controlá los egresos de tu taller mes a mes.",
        icon: PiggyBank,
        color: "bg-orange-600",
      },
      {
        name: "Órdenes de Compra",
        description:
          "Creá pedidos a proveedores, hacé seguimiento de entregas y mantené el historial de compras. Todo vinculado a tu inventario automáticamente.",
        icon: ClipboardCheck,
        color: "bg-blue-600",
      },
      {
        name: "Dashboard Analítico",
        description:
          "Panel centralizado con KPIs en tiempo real: ingresos, reparaciones, rendimiento del equipo y tendencias. Todo de un vistazo para tomar mejores decisiones.",
        icon: LayoutDashboard,
        color: "bg-violet-600",
      },
    ],
  },
  {
    id: "productividad",
    name: "Productividad",
    icon: Zap,
    description: "Herramientas inteligentes para trabajar mejor, no más",
    features: [
      {
        name: "15+ Reportes Avanzados",
        description:
          "Rentabilidad, predicción de repuestos, fallas comunes, tiempos de reparación, tasa de retorno, rendimiento por técnico y mucho más.",
        icon: BarChart3,
        color: "bg-cyan-500",
      },
      {
        name: "Notificaciones WhatsApp y Email",
        description:
          "Avisale al cliente con un click cuando su equipo está listo. Plantillas listas para WhatsApp y correo: presupuestos, seguimiento y entrega.",
        icon: Bell,
        color: "bg-yellow-500",
      },
      {
        name: "Captación de Leads",
        description:
          "Registrá consultas y potenciales clientes que llegan a tu taller. Hacé seguimiento hasta convertirlos en órdenes de trabajo reales.",
        icon: Megaphone,
        color: "bg-rose-500",
      },
      {
        name: "App Móvil + Offline",
        description:
          "App nativa para Android, PWA para cualquier dispositivo y modo offline que sincroniza cuando volvés a tener conexión.",
        icon: Smartphone,
        color: "bg-pink-500",
      },
    ],
  },
  {
    id: "soporte",
    name: "Soporte",
    icon: Bot,
    description: "Ayuda inteligente y herramientas que te ahorran tiempo",
    features: [
      {
        name: "Asistente IA: Santi",
        description:
          "Tu asistente virtual dentro de la app. Preguntale sobre funciones, pedile ayuda para resolver problemas o que te guíe paso a paso. Disponible 24/7.",
        icon: Bot,
        color: "bg-indigo-600",
      },
      {
        name: "Firma Digital",
        description:
          "Capturá la firma del cliente en la entrega y en la aprobación de presupuestos. Ante cualquier reclamo, tenés el respaldo legal.",
        icon: PenLine,
        color: "bg-amber-600",
      },
      {
        name: "Importación de Datos",
        description:
          "Importá clientes, inventario y datos desde Excel o CSV con plantillas descargables y validación automática. Migrá tu taller en minutos.",
        icon: Mail,
        color: "bg-teal-600",
      },
      {
        name: "Seguridad Avanzada",
        description:
          "Autenticación de dos factores (2FA) con códigos de respaldo, encriptación HTTPS/TLS, controles de acceso por rol y copias de seguridad automáticas.",
        icon: ShieldCheck,
        color: "bg-red-600",
      },
    ],
  },
]

export function Features() {
  return (
    <LazyMotion features={domAnimation}>
      <section id="features" className="pt-8 pb-12 sm:pt-10 sm:pb-16 bg-muted/30">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <m.div
            className="text-center max-w-3xl mx-auto mb-10"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "0px" }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-balance text-foreground mb-4">
              Todo tu taller en una sola plataforma
            </h2>
            <p className="text-lg text-muted-foreground">
              Reparaciones, ventas, caja, finanzas, cotizaciones, seguimiento online,
              leads, reportes avanzados, soporte con IA y más.
              Pensado para talleres de reparación, no adaptado de otro rubro.
            </p>
          </m.div>

          {/* Tabs */}
          <Tabs defaultValue="servicio" className="w-full">
            <div className="flex justify-center mb-10 px-2 overflow-x-auto scrollbar-hide">
              <TabsList className="inline-flex h-auto p-1 sm:p-1.5 bg-muted/80 backdrop-blur-sm rounded-xl sm:rounded-2xl border shadow-sm gap-1 sm:gap-1.5">
                {categories.map((category) => (
                  <TabsTrigger
                    key={category.id}
                    value={category.id}
                    className="inline-flex items-center gap-1 sm:gap-2 py-2 px-2.5 sm:py-3 sm:px-4 text-[11px] sm:text-sm font-medium rounded-lg sm:rounded-xl transition-[color,background-color,box-shadow] duration-200 whitespace-nowrap data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground data-[state=inactive]:hover:bg-background/50 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md"
                  >
                    <category.icon className="w-4 h-4 sm:w-4 sm:h-4" />
                    {/* Mobile: solo ícono (label truncado a 4 chars era ilegible).
                        Desktop: primera palabra del nombre. */}
                    <span className="hidden sm:inline">{category.name.split(" ")[0]}</span>
                    <span className="sr-only sm:hidden">{category.name}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            {categories.map((category) => {
              const [featured, ...rest] = category.features
              return (
              <TabsContent key={category.id} value={category.id}>
                {/* Category description */}
                <p className="text-center text-muted-foreground mb-8">
                  {category.description}
                </p>

                {/* Featured feature: el corazón de la categoría, panel ancho */}
                <div className="grid gap-4 sm:gap-6">
                  <m.div
                    className="bg-card rounded-2xl p-6 sm:p-8 shadow-sm border hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 group transition-colors flex flex-col sm:flex-row sm:items-center gap-5"
                    initial={{ opacity: 0, y: 24 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "0px" }}
                    transition={{ duration: 0.5 }}
                  >
                    <m.div
                      className="bg-primary text-primary-foreground w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
                      whileHover={{ scale: 1.1 }}
                      transition={{ type: "spring", stiffness: 400, damping: 17 }}
                    >
                      <featured.icon className="w-7 h-7" />
                    </m.div>
                    <div className="min-w-0">
                      <h3 className="text-xl font-semibold text-foreground mb-1.5">
                        {featured.name}
                      </h3>
                      <p className="text-muted-foreground leading-relaxed">
                        {featured.description}
                      </p>
                    </div>
                  </m.div>

                  {/* Resto: grid compacto, icon-tiles tintados en brand */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                    {rest.map((feature, index) => (
                      <m.div
                        key={feature.name}
                        className="bg-card rounded-xl p-5 shadow-sm border hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 group h-full transition-colors"
                        initial={{ opacity: 0, y: 24 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, margin: "0px" }}
                        transition={{ duration: 0.45, delay: index * 0.08 }}
                        whileHover={{ y: -6 }}
                      >
                        <div className="bg-primary/10 text-primary w-11 h-11 rounded-xl flex items-center justify-center mb-3.5 group-hover:bg-primary/15 transition-colors">
                          <feature.icon className="w-5 h-5" />
                        </div>
                        <h3 className="text-base font-semibold text-foreground mb-1.5">
                          {feature.name}
                        </h3>
                        <p className="text-muted-foreground text-sm leading-relaxed">
                          {feature.description}
                        </p>
                      </m.div>
                    ))}
                  </div>
                </div>
              </TabsContent>
              )
            })}
          </Tabs>
        </div>
      </section>
    </LazyMotion>
  )
}
