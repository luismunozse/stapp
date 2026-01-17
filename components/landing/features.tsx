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
} from "lucide-react"

const features = [
  {
    name: "Órdenes de Servicio",
    description:
      "El corazón de tu taller. Gestiona cada reparación de principio a fin con estados en tiempo real, checklists personalizados y seguimiento completo.",
    icon: ClipboardList,
    color: "bg-blue-500",
  },
  {
    name: "Presupuestos",
    description:
      "Genera presupuestos profesionales en segundos. Tu cliente aprueba online y se convierte automáticamente en orden de trabajo.",
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
    name: "Firma Digital",
    description:
      "Capturá la firma del cliente en la entrega desde cualquier dispositivo. Conformidad digital que respalda cada trabajo completado.",
    icon: PenLine,
    color: "bg-emerald-500",
  },
  {
    name: "Gestión de Clientes",
    description:
      "Toda la información de tus clientes en un solo lugar. Historial completo de reparaciones, contactos y notas importantes.",
    icon: Users,
    color: "bg-orange-500",
  },
  {
    name: "Control de Inventario",
    description:
      "Nunca te quedes sin stock. Alertas automáticas cuando un repuesto está por agotarse, control de costos y gestión de proveedores.",
    icon: Package,
    color: "bg-green-500",
  },
  {
    name: "Facturación Integrada",
    description:
      "De la orden a la factura en un click. Genera comprobantes, registra pagos parciales y controlá tus cuentas por cobrar.",
    icon: Receipt,
    color: "bg-purple-500",
  },
  {
    name: "Sistema de Garantías",
    description:
      "Gestioná garantías sin dolores de cabeza. Alertas de vencimiento, registro de reclamos y trazabilidad completa de cada caso.",
    icon: ShieldCheck,
    color: "bg-red-500",
  },
  {
    name: "Notificaciones Automáticas",
    description:
      "Mantené a tus clientes informados sin esfuerzo. Avisos por WhatsApp y email en cada cambio de estado de su reparación.",
    icon: Bell,
    color: "bg-yellow-500",
  },
  {
    name: "Asignación de Técnicos",
    description:
      "Distribuí el trabajo inteligentemente. Visualizá la carga de cada técnico y asigná las reparaciones de forma equilibrada.",
    icon: Wrench,
    color: "bg-rose-500",
  },
  {
    name: "Reportes y Métricas",
    description:
      "Tomá decisiones basadas en datos. Dashboard con ingresos, tiempos de reparación, rendimiento del equipo y tendencias.",
    icon: BarChart3,
    color: "bg-cyan-500",
  },
  {
    name: "App Móvil (PWA)",
    description:
      "Tu taller en el bolsillo. Instalá la app en tu celular y gestioná todo desde cualquier lugar, incluso sin conexión.",
    icon: Smartphone,
    color: "bg-pink-500",
  },
]

export function Features() {
  return (
    <section id="features" className="py-6 sm:py-8 bg-muted/50">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-8">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            Todo lo que necesitas en un solo lugar
          </h2>
          <p className="text-lg text-muted-foreground">
            12 herramientas poderosas diseñadas para que tu taller funcione como reloj.
            Desde el presupuesto hasta la garantía, tenés todo cubierto.
          </p>
        </div>

        {/* Features grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {features.map((feature) => (
            <div
              key={feature.name}
              className="bg-card rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow border"
            >
              <div
                className={`${feature.color} w-12 h-12 rounded-lg flex items-center justify-center mb-4`}
              >
                <feature.icon className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                {feature.name}
              </h3>
              <p className="text-muted-foreground text-sm">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
