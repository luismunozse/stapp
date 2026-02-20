"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TrendingUp, Users, Package, BarChart3 } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

// Loading skeleton para reportes
function ReporteSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-32 mt-2" />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-[300px] w-full" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      </CardContent>
    </Card>
  )
}

// Lazy load de componentes pesados con Recharts
const ResumenIngresos = dynamic(
  () => import("./resumen-ingresos").then(mod => ({ default: mod.ResumenIngresos })),
  { loading: () => <ReporteSkeleton />, ssr: false }
)

const PerformanceTecnicos = dynamic(
  () => import("./performance-tecnicos").then(mod => ({ default: mod.PerformanceTecnicos })),
  { loading: () => <ReporteSkeleton />, ssr: false }
)

const TopClientes = dynamic(
  () => import("./top-clientes").then(mod => ({ default: mod.TopClientes })),
  { loading: () => <ReporteSkeleton />, ssr: false }
)

const AnalisisInventario = dynamic(
  () => import("./analisis-inventario").then(mod => ({ default: mod.AnalisisInventario })),
  { loading: () => <ReporteSkeleton />, ssr: false }
)

export function ReportesAvanzadosView() {
  const [activeTab, setActiveTab] = useState("ingresos")

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Reportes</h1>
        <p className="text-muted-foreground">
          Analiza el rendimiento de tu taller con métricas detalladas
        </p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4">
          <TabsTrigger value="ingresos" className="gap-2">
            <TrendingUp className="h-4 w-4" />
            <span className="hidden sm:inline">Ingresos</span>
          </TabsTrigger>
          <TabsTrigger value="tecnicos" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">Técnicos</span>
          </TabsTrigger>
          <TabsTrigger value="clientes" className="gap-2">
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">Clientes</span>
          </TabsTrigger>
          <TabsTrigger value="inventario" className="gap-2">
            <Package className="h-4 w-4" />
            <span className="hidden sm:inline">Inventario</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ingresos" className="mt-6">
          <ResumenIngresos />
        </TabsContent>

        <TabsContent value="tecnicos" className="mt-6">
          <PerformanceTecnicos />
        </TabsContent>

        <TabsContent value="clientes" className="mt-6">
          <TopClientes />
        </TabsContent>

        <TabsContent value="inventario" className="mt-6">
          <AnalisisInventario />
        </TabsContent>
      </Tabs>
    </div>
  )
}
