"use client"

import { useState } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  ClipboardList,
  LayoutDashboard,
  Package,
  Users,
  TrendingUp,
  CheckCircle,
  Clock,
  AlertCircle,
  DollarSign,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ANIMATION } from "@/lib/animation-constants"

const modules = [
  {
    id: "ordenes",
    name: "Órdenes",
    icon: ClipboardList,
    description: "Gestiona reparaciones de principio a fin",
    color: "from-blue-500 to-indigo-600",
    accentColor: "text-blue-500",
    features: ["Estado en tiempo real", "Fotos por etapa", "Firma digital"],
  },
  {
    id: "dashboard",
    name: "Dashboard",
    icon: LayoutDashboard,
    description: "Métricas y reportes en tiempo real",
    color: "from-purple-500 to-pink-600",
    accentColor: "text-purple-500",
    features: ["Ingresos diarios", "Órdenes activas", "Tendencias"],
  },
  {
    id: "inventario",
    name: "Inventario",
    icon: Package,
    description: "Control de stock y alertas automáticas",
    color: "from-green-500 to-emerald-600",
    accentColor: "text-green-500",
    features: ["Alertas de stock", "Gestión de proveedores", "Historial"],
  },
  {
    id: "clientes",
    name: "Clientes",
    icon: Users,
    description: "Base de datos completa de clientes",
    color: "from-orange-500 to-red-600",
    accentColor: "text-orange-500",
    features: ["Historial completo", "Contactos", "Reparaciones"],
  },
]

// Mockup visual components
function OrdenesMockup() {
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-semibold text-sm">Órdenes de Servicio</h4>
        <Badge variant="secondary" className="text-xs">15 activas</Badge>
      </div>

      {/* Order cards */}
      <div className="space-y-2">
        {[
          { id: "ORD-1234", cliente: "Juan Pérez", estado: "En reparación", color: "bg-blue-500" },
          { id: "ORD-1235", cliente: "María García", estado: "Pendiente", color: "bg-yellow-500" },
          { id: "ORD-1236", cliente: "Carlos López", estado: "Completado", color: "bg-green-500" },
        ].map((orden, index) => (
          <Card
            key={orden.id}
            className="p-3 hover:shadow-md transition-all duration-200 animate-fade-in"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-muted-foreground">{orden.id}</span>
                  <div className={cn("w-2 h-2 rounded-full", orden.color)} />
                </div>
                <p className="text-sm font-medium">{orden.cliente}</p>
                <p className="text-xs text-muted-foreground">iPhone 12 Pro - Pantalla rota</p>
              </div>
              <Badge variant="outline" className="text-xs">{orden.estado}</Badge>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

function DashboardMockup() {
  return (
    <div className="space-y-3">
      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {[
          { label: "Ingresos Hoy", value: "$4,350", icon: DollarSign, color: "text-green-500" },
          { label: "Órdenes Activas", value: "15", icon: Clock, color: "text-blue-500" },
          { label: "Completadas", value: "8", icon: CheckCircle, color: "text-emerald-500" },
          { label: "Pendientes", value: "7", icon: AlertCircle, color: "text-yellow-500" },
        ].map((stat, index) => (
          <Card
            key={stat.label}
            className="p-3 animate-fade-in"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <div className="flex items-center gap-2 mb-1">
              <stat.icon className={cn("w-4 h-4", stat.color)} />
              <span className="text-xs text-muted-foreground">{stat.label}</span>
            </div>
            <p className="text-xl font-bold">{stat.value}</p>
          </Card>
        ))}
      </div>

      {/* Chart placeholder */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold">Ingresos del Mes</h4>
          <TrendingUp className="w-4 h-4 text-green-500" />
        </div>
        <div className="h-32 flex items-end gap-2">
          {[40, 65, 45, 80, 55, 75, 90].map((height, index) => (
            <div
              key={index}
              className="flex-1 bg-gradient-to-t from-primary to-primary/50 rounded-t animate-fade-in"
              style={{
                height: `${height}%`,
                animationDelay: `${index * 100}ms`,
              }}
            />
          ))}
        </div>
        <div className="flex justify-between mt-2 text-xs text-muted-foreground">
          <span>Lun</span>
          <span>Mar</span>
          <span>Mié</span>
          <span>Jue</span>
          <span>Vie</span>
          <span>Sáb</span>
          <span>Dom</span>
        </div>
      </Card>
    </div>
  )
}

function InventarioMockup() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-semibold text-sm">Control de Inventario</h4>
        <Badge variant="secondary" className="text-xs">124 productos</Badge>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {[
          { nombre: "Pantalla iPhone 12", stock: 5, alerta: false },
          { nombre: "Batería Samsung", stock: 2, alerta: true },
          { nombre: "Cargador USB-C", stock: 15, alerta: false },
          { nombre: "Flex de carga", stock: 1, alerta: true },
        ].map((item, index) => (
          <Card
            key={item.nombre}
            className={cn(
              "p-3 animate-fade-in",
              item.alerta && "border-yellow-500/50 bg-yellow-50/50 dark:bg-yellow-950/20"
            )}
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <div className="flex items-start gap-2">
              <Package className={cn("w-4 h-4 mt-0.5", item.alerta ? "text-yellow-500" : "text-green-500")} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{item.nombre}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Stock: <span className={cn("font-semibold", item.alerta && "text-yellow-600 dark:text-yellow-500")}>{item.stock}</span>
                </p>
                {item.alerta && (
                  <Badge variant="outline" className="text-[10px] mt-1 py-0">Stock bajo</Badge>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

function ClientesMockup() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-semibold text-sm">Base de Clientes</h4>
        <Badge variant="secondary" className="text-xs">234 clientes</Badge>
      </div>

      <div className="space-y-2">
        {[
          { nombre: "Juan Pérez", reparaciones: 5, ultimo: "Hace 2 días" },
          { nombre: "María García", reparaciones: 3, ultimo: "Hace 1 semana" },
          { nombre: "Carlos López", reparaciones: 8, ultimo: "Hoy" },
          { nombre: "Ana Martínez", reparaciones: 2, ultimo: "Hace 3 días" },
        ].map((cliente, index) => (
          <Card
            key={cliente.nombre}
            className="p-3 hover:shadow-md transition-all duration-200 animate-fade-in"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center text-white font-semibold text-sm">
                {cliente.nombre.split(" ").map(n => n[0]).join("")}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">{cliente.nombre}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-muted-foreground">{cliente.reparaciones} reparaciones</span>
                  <span className="text-xs text-muted-foreground">•</span>
                  <span className="text-xs text-muted-foreground">{cliente.ultimo}</span>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

export function ProductShowcase() {
  const [activeTab, setActiveTab] = useState("ordenes")

  return (
    <section className="py-12 sm:py-16 bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-10">
          <Badge variant="secondary" className="mb-4">Vista previa del sistema</Badge>
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            Ve STApp en acción
          </h2>
          <p className="text-lg text-muted-foreground">
            Explora las interfaces principales del sistema y descubre cómo simplifica la gestión de tu taller
          </p>
        </div>

        {/* Interactive showcase */}
        <div className="max-w-6xl mx-auto">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            {/* Module selector */}
            <div className="flex justify-center mb-8">
              <TabsList className="inline-flex flex-wrap h-auto p-1.5 bg-muted/80 backdrop-blur-sm rounded-2xl border shadow-sm gap-2">
                {modules.map((module) => (
                  <TabsTrigger
                    key={module.id}
                    value={module.id}
                    className="inline-flex items-center gap-2 py-3 px-4 sm:px-6 text-sm font-medium rounded-xl transition-all duration-200 data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground data-[state=inactive]:hover:bg-background/50 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md"
                    aria-label={`Ver módulo de ${module.name}`}
                  >
                    <module.icon className="w-4 h-4" />
                    <span className="hidden sm:inline">{module.name}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            {/* Module content */}
            {modules.map((module) => (
              <TabsContent
                key={module.id}
                value={module.id}
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
              >
                <div className="grid lg:grid-cols-2 gap-8 items-center">
                  {/* Description */}
                  <div className="order-2 lg:order-1">
                    <div className="flex items-center gap-3 mb-4">
                      <div className={cn("w-12 h-12 rounded-xl bg-gradient-to-br flex items-center justify-center", module.color)}>
                        <module.icon className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h3 className="text-2xl font-bold text-foreground">{module.name}</h3>
                        <p className={cn("text-sm", module.accentColor)}>{module.description}</p>
                      </div>
                    </div>

                    <p className="text-muted-foreground mb-6">
                      {module.id === "ordenes" && "Centraliza todas las reparaciones en un solo lugar. Actualiza estados, agrega fotos, genera presupuestos y captura firmas digitales sin salir de la pantalla."}
                      {module.id === "dashboard" && "Visualiza el rendimiento de tu taller en tiempo real. Métricas clave, gráficos intuitivos y reportes que te ayudan a tomar mejores decisiones de negocio."}
                      {module.id === "inventario" && "Mantén control total de tu stock. Recibe alertas cuando los productos se están agotando y gestiona proveedores desde una única interfaz."}
                      {module.id === "clientes" && "Toda la información de tus clientes al alcance de un click. Historial completo de reparaciones, datos de contacto y notas importantes."}
                    </p>

                    <div className="space-y-3">
                      <p className="text-sm font-semibold text-foreground">Características destacadas:</p>
                      <ul className="space-y-2">
                        {module.features.map((feature) => (
                          <li key={feature} className="flex items-center gap-2 text-sm text-muted-foreground">
                            <CheckCircle className={cn("w-4 h-4", module.accentColor)} />
                            {feature}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Mockup */}
                  <div className="order-1 lg:order-2">
                    <div className="relative">
                      {/* Browser chrome */}
                      <div className="bg-card border rounded-t-xl p-3 flex items-center gap-2">
                        <div className="flex gap-1.5">
                          <div className="w-3 h-3 rounded-full bg-red-500" />
                          <div className="w-3 h-3 rounded-full bg-yellow-500" />
                          <div className="w-3 h-3 rounded-full bg-green-500" />
                        </div>
                        <div className="flex-1 bg-muted rounded px-3 py-1 text-xs text-muted-foreground text-center">
                          stapp.com/{module.id}
                        </div>
                      </div>

                      {/* Mockup content */}
                      <Card className="rounded-t-none border-t-0 p-6 min-h-[400px] bg-muted/50">
                        {module.id === "ordenes" && <OrdenesMockup />}
                        {module.id === "dashboard" && <DashboardMockup />}
                        {module.id === "inventario" && <InventarioMockup />}
                        {module.id === "clientes" && <ClientesMockup />}
                      </Card>

                      {/* Gradient overlay for depth */}
                      <div className="absolute inset-0 bg-gradient-to-t from-background/20 to-transparent pointer-events-none rounded-xl" />
                    </div>
                  </div>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </div>
    </section>
  )
}
