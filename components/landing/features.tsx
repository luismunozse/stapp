"use client"

import {
  ClipboardList,
  Package,
  Receipt,
  Users,
  Wrench,
  BarChart3,
  Bell,
  Smartphone,
} from "lucide-react"

const features = [
  {
    name: "Órdenes de Servicio",
    description:
      "Crea y gestiona órdenes con seguimiento de estado, fotos del dispositivo, checklist de recepción y más.",
    icon: ClipboardList,
    color: "bg-blue-500",
  },
  {
    name: "Control de Inventario",
    description:
      "Administra tus repuestos con alertas de stock bajo, precios de compra/venta y proveedores.",
    icon: Package,
    color: "bg-green-500",
  },
  {
    name: "Facturación Integrada",
    description:
      "Genera facturas automáticas, registra pagos parciales y lleva el control de cuentas por cobrar.",
    icon: Receipt,
    color: "bg-purple-500",
  },
  {
    name: "Gestión de Clientes",
    description:
      "Base de datos de clientes con historial de reparaciones, contacto y preferencias.",
    icon: Users,
    color: "bg-orange-500",
  },
  {
    name: "Asignación de Técnicos",
    description:
      "Asigna trabajos a tu equipo, visualiza carga de trabajo y rendimiento de cada técnico.",
    icon: Wrench,
    color: "bg-red-500",
  },
  {
    name: "Reportes y Estadísticas",
    description:
      "Dashboard con métricas clave: ingresos, órdenes, tiempos de reparación y más.",
    icon: BarChart3,
    color: "bg-cyan-500",
  },
  {
    name: "Notificaciones Automáticas",
    description:
      "Envía actualizaciones por WhatsApp o email cuando cambia el estado de una reparación.",
    icon: Bell,
    color: "bg-yellow-500",
  },
  {
    name: "App Móvil (PWA)",
    description:
      "Accede desde cualquier dispositivo. Funciona como app instalable en tu celular.",
    icon: Smartphone,
    color: "bg-pink-500",
  },
]

export function Features() {
  return (
    <section id="features" className="py-6 sm:py-8 bg-gray-50">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-6">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
            Todo lo que necesitas para tu taller
          </h2>
          <p className="text-lg text-gray-600">
            Herramientas diseñadas específicamente para talleres de reparación
            de dispositivos electrónicos.
          </p>
        </div>

        {/* Features grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {features.map((feature) => (
            <div
              key={feature.name}
              className="bg-white rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow"
            >
              <div
                className={`${feature.color} w-12 h-12 rounded-lg flex items-center justify-center mb-4`}
              >
                <feature.icon className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {feature.name}
              </h3>
              <p className="text-gray-600 text-sm">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
