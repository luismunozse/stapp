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
import { m, LazyMotion, domAnimation } from "@/components/animations/motion"
import { revealHeader, revealStagger, revealCard } from "./reveal"
import { SectionEyebrow } from "@/components/landing/section-eyebrow"

const categories = [
  {
    id: "servicio",
    name: "Servicio Técnico",
    icon: Wrench,
    description: "Gestioná el flujo completo de reparaciones",
    features: [
      {
        name: "Órdenes de Servicio",
        description:
          "El corazón de tu taller. Creá una orden en menos de 1 minuto con estados claros, checklists personalizados y seguimiento completo.",
        icon: ClipboardList,
        color: "bg-blue-500",
      },
      {
        name: "Cotizaciones y Presupuestos",
        description:
          "Creá presupuestos profesionales con descuentos, impuestos y condiciones. Tu cliente los aprueba o rechaza online desde un link, sin necesidad de cuenta.",
        icon: Calculator,
        color: "bg-indigo-500",
      },
      {
        name: "Fotos por Etapa",
        description:
          "Documentá cada paso: ingreso, durante la reparación y entrega. Protegé tu taller ante cualquier reclamo con evidencia visual.",
        icon: Camera,
        color: "bg-amber-500",
      },
      {
        name: "Portal de Seguimiento",
        description:
          "Tu cliente sigue su reparación desde un link, sin crear cuenta. Ve el estado actualizado, fotos, garantía y descarga el comprobante en PDF.",
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
          "Multi-depósito, variantes, series/IMEI, lotes con vencimiento y análisis ABC. Alertas de stock bajo, historial de precios y reposición sugerida. Importá tu inventario desde Excel o CSV en minutos.",
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
      {
        name: "Multi-sucursal y Multi-moneda",
        description:
          "Gestioná varias sucursales con órdenes, ventas, caja y stock por local. Trabajá en cualquiera de las 11 monedas soportadas (ARS, USD y más).",
        icon: Settings,
        color: "bg-cyan-600",
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
      {
        name: "Catálogo Online",
        description:
          "Publicá tu catálogo con link propio, cupones de descuento y checkout con MercadoPago. Recuperá carritos abandonados automáticamente.",
        icon: Link2,
        color: "bg-fuchsia-500",
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
          "Panel centralizado con KPIs actualizados: ingresos, reparaciones, rendimiento del equipo y tendencias. Todo de un vistazo para tomar mejores decisiones.",
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
        name: "Reportes Avanzados",
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
      {
        name: "Integraciones y API",
        description:
          "Webhooks salientes, API REST v1 y API keys para conectar STApp con tus otras herramientas.",
        icon: Zap,
        color: "bg-slate-500",
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
          "Capturá la firma del cliente en la recepción y en la entrega del equipo. Ante cualquier reclamo, tenés el respaldo legal.",
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
            variants={revealHeader}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "0px" }}
          >
            <SectionEyebrow>Plataforma todo-en-uno</SectionEyebrow>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-balance text-foreground mb-4">
              Todo tu taller en una sola plataforma
            </h2>
            <p className="text-lg text-muted-foreground">
              Reparaciones, ventas, caja, finanzas, cotizaciones, seguimiento online,
              leads, reportes avanzados, soporte con IA y más.
              Pensado para talleres de reparación, no adaptado de otro rubro.
            </p>
          </m.div>

          {/* Una sola placa con todos los módulos a la vista (sin tabs) */}
          <div className="mx-auto max-w-6xl rounded-2xl sm:rounded-3xl border bg-card p-6 sm:p-8 lg:p-10 shadow-sm">
            <m.div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-8 lg:gap-y-10"
              variants={revealStagger}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "0px" }}
            >
              {categories.map((category) => (
                <m.div key={category.id} variants={revealCard}>
                  {/* Category header */}
                  <div className="flex items-center gap-2.5 mb-4 pb-3 border-b">
                    <div className="bg-primary/10 text-primary w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0">
                      <category.icon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-foreground leading-tight">{category.name}</h3>
                      <p className="text-xs text-muted-foreground leading-tight">{category.description}</p>
                    </div>
                  </div>

                  {/* Feature list */}
                  <ul className="space-y-2.5">
                    {category.features.map((feature) => (
                      <li
                        key={feature.name}
                        className="flex items-start gap-2 text-sm text-muted-foreground"
                      >
                        <feature.icon className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                        <span className="leading-snug">{feature.name}</span>
                      </li>
                    ))}
                  </ul>
                </m.div>
              ))}
            </m.div>
          </div>
        </div>
      </section>
    </LazyMotion>
  )
}
