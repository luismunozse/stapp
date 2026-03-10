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
        name: "Presupuestos",
        description:
          "Generá presupuestos profesionales en 30 segundos. Enviá el PDF por WhatsApp y registrá la aprobación con firma digital.",
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
          "Capturá la firma del cliente al momento de la entrega. Ante cualquier reclamo, tenés el respaldo.",
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
          "Cuando un cliente vuelve, en 2 clicks ya sabés todo: qué trajo, qué le hiciste y cuánto pagó. Sin buscar en papeles.",
        icon: Users,
        color: "bg-orange-500",
      },
      {
        name: "Control de Inventario",
        description:
          "Recibí alertas antes de quedarte sin stock. Controlá costos y márgenes en tiempo real con actualizaciones automáticas.",
        icon: Package,
        color: "bg-green-500",
      },
      {
        name: "Control de Cobros",
        description:
          "De la orden al cobro en un click. Pagos parciales, comprobantes automáticos y un panel claro de quién te debe y cuánto.",
        icon: Receipt,
        color: "bg-purple-500",
      },
      {
        name: "Sistema de Garantías",
        description:
          "Sabé en todo momento qué garantías están vigentes, cuáles vencen pronto y qué reclamos tenés pendientes. Sin perder nada.",
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
          "Asigná reparaciones a cada técnico, equilibrá la carga de trabajo y medí el rendimiento con métricas claras.",
        icon: Wrench,
        color: "bg-rose-500",
      },
      {
        name: "Notificaciones por WhatsApp",
        description:
          "Avisale al cliente con un click cuando su equipo está listo. Plantillas listas para presupuestos, seguimiento y entrega.",
        icon: Bell,
        color: "bg-yellow-500",
      },
      {
        name: "Reportes y Métricas",
        description:
          "¿Tu taller crece o pierde plata? Ingresos, tiempos promedio de reparación y rendimiento del equipo en un vistazo.",
        icon: BarChart3,
        color: "bg-cyan-500",
      },
      {
        name: "App Móvil (PWA)",
        description:
          "¿Usás iPhone o no querés instalar nada? Accedé igual desde cualquier dispositivo, incluso sin conexión.",
        icon: Smartphone,
        color: "bg-pink-500",
      },
    ],
  },
]

export function Features() {
  return (
    <LazyMotion features={domAnimation}>
      <section id="features" className="py-12 sm:py-16 bg-muted/30">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <m.div
            className="text-center max-w-3xl mx-auto mb-10"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              Menos caos, más reparaciones
            </h2>
            <p className="text-lg text-muted-foreground">
              Todo lo que pasa en tu taller, en una sola pantalla. Fotos por
              etapa, firma digital, WhatsApp integrado y control de garantías
              — pensado para talleres de reparación, no adaptado de otro rubro.
            </p>
          </m.div>

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
                  {category.features.map((feature, index) => (
                    <m.div
                      key={feature.name}
                      className="bg-card rounded-xl p-6 shadow-sm border hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 group h-full transition-colors"
                      initial={{ opacity: 0, y: 30 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true, margin: "-50px" }}
                      transition={{ duration: 0.5, delay: index * 0.1 }}
                      whileHover={{
                        y: -8,
                        boxShadow: "0 20px 40px -15px rgba(0,0,0,0.15)",
                      }}
                    >
                      <m.div
                        className={`${feature.color} w-12 h-12 rounded-xl flex items-center justify-center mb-4`}
                        whileHover={{
                          scale: 1.15,
                          rotate: [0, -5, 5, 0],
                        }}
                        transition={{
                          type: "spring",
                          stiffness: 400,
                          damping: 17
                        }}
                      >
                        <feature.icon className="w-6 h-6 text-white" />
                      </m.div>
                      <h3 className="text-lg font-semibold text-foreground mb-2">
                        {feature.name}
                      </h3>
                      <p className="text-muted-foreground text-sm leading-relaxed">
                        {feature.description}
                      </p>
                    </m.div>
                  ))}
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </section>
    </LazyMotion>
  )
}
