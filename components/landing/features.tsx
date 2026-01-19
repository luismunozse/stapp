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
} from "lucide-react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

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
          "El corazón de tu taller. Gestiona cada reparación de principio a fin con estados en tiempo real, checklists personalizados y seguimiento completo.",
        icon: ClipboardList,
        color: "bg-blue-500",
      },
      {
        name: "Presupuestos",
        description:
          "Genera presupuestos profesionales en segundos. Enviá el PDF por WhatsApp y registrá la aprobación con firma digital.",
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
    ],
  },
  {
    id: "productividad",
    name: "Productividad",
    icon: Zap,
    description: "Optimiza tu equipo y toma mejores decisiones",
    features: [
      {
        name: "Gestión de Equipo",
        description:
          "Administrá técnicos y vendedores. Asigná reparaciones, visualizá la carga de trabajo y medí el rendimiento de cada uno.",
        icon: Wrench,
        color: "bg-rose-500",
      },
      {
        name: "Notificaciones por WhatsApp",
        description:
          "Mantené a tus clientes informados con plantillas de WhatsApp listas para enviar con un click. Mensajes profesionales en segundos.",
        icon: Bell,
        color: "bg-yellow-500",
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
    ],
  },
]

export function Features() {
  return (
    <section id="features" className="py-12 sm:py-16 bg-muted/30">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-10">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            Todo lo que necesitas en un solo lugar
          </h2>
          <p className="text-lg text-muted-foreground">
            12 herramientas poderosas diseñadas para que tu taller funcione como reloj.
          </p>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="servicio" className="w-full">
          <div className="flex justify-center mb-10 px-2">
            <TabsList className="inline-flex h-auto p-1 sm:p-1.5 bg-muted/80 backdrop-blur-sm rounded-xl sm:rounded-2xl border shadow-sm gap-1 sm:gap-2">
              {categories.map((category) => (
                <TabsTrigger
                  key={category.id}
                  value={category.id}
                  className="inline-flex items-center gap-1.5 sm:gap-2 py-2 px-3 sm:py-3 sm:px-5 text-xs sm:text-sm font-medium rounded-lg sm:rounded-xl transition-all duration-200 data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground data-[state=inactive]:hover:bg-background/50 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md"
                >
                  <category.icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span>{category.name.split(" ")[0]}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {categories.map((category) => (
            <TabsContent key={category.id} value={category.id}>
              {/* Category description */}
              <p className="text-center text-muted-foreground mb-8">
                {category.description}
              </p>

              {/* Features grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {category.features.map((feature) => (
                  <div
                    key={feature.name}
                    className="bg-card rounded-xl p-6 shadow-sm hover:shadow-md transition-all duration-300 border hover:border-primary/20 group"
                  >
                    <div
                      className={`${feature.color} w-12 h-12 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}
                    >
                      <feature.icon className="w-6 h-6 text-white" />
                    </div>
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      {feature.name}
                    </h3>
                    <p className="text-muted-foreground text-sm leading-relaxed">
                      {feature.description}
                    </p>
                  </div>
                ))}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  )
}
