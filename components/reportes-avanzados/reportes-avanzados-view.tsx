"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Users, Package, BarChart3, Clock, AlertTriangle, DollarSign, Boxes, ShoppingCart } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { ExportButton } from "./export-button"
import { BranchScopeLabel } from "./branch-scope-label"

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

const TiempoReparacionChart = dynamic(
  () => import("./tiempo-reparacion-chart").then(mod => ({ default: mod.TiempoReparacionChart })),
  { loading: () => <ReporteSkeleton />, ssr: false }
)

const TasaRetornoChart = dynamic(
  () => import("./tasa-retorno-chart").then(mod => ({ default: mod.TasaRetornoChart })),
  { loading: () => <ReporteSkeleton />, ssr: false }
)

const FallasComunesChart = dynamic(
  () => import("./fallas-comunes-chart").then(mod => ({ default: mod.FallasComunesChart })),
  { loading: () => <ReporteSkeleton />, ssr: false }
)

const RentabilidadChart = dynamic(
  () => import("./rentabilidad-chart").then(mod => ({ default: mod.RentabilidadChart })),
  { loading: () => <ReporteSkeleton />, ssr: false }
)

const PrediccionRepuestosChart = dynamic(
  () => import("./prediccion-repuestos-chart").then(mod => ({ default: mod.PrediccionRepuestosChart })),
  { loading: () => <ReporteSkeleton />, ssr: false }
)

const PerformanceVendedores = dynamic(
  () => import("./performance-vendedores").then(mod => ({ default: mod.PerformanceVendedores })),
  { loading: () => <ReporteSkeleton />, ssr: false }
)

const RentabilidadTecnicos = dynamic(
  () => import("./rentabilidad-tecnicos").then(mod => ({ default: mod.RentabilidadTecnicos })),
  { loading: () => <ReporteSkeleton />, ssr: false }
)

export function ReportesAvanzadosView() {
  const [activeTab, setActiveTab] = useState("tecnicos")

  // Map tab values to report types for export
  const exportableReports: Record<string, string> = {
    "tiempo-reparacion": "tiempo-reparacion",
    "tasa-retorno": "tasa-retorno",
    "fallas": "fallas-comunes",
    "rentabilidad": "rentabilidad",
    "rentabilidad-tecnicos": "rentabilidad-tecnicos",
    "prediccion": "prediccion-repuestos",
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <div>
          <h1 className="text-headline">Reportes</h1>
          <p className="text-muted-foreground">
            Analiza el rendimiento de tu taller con métricas detalladas
          </p>
          <BranchScopeLabel />
        </div>
        {exportableReports[activeTab] && (
          <ExportButton reportType={exportableReports[activeTab]} />
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto">
          <TabsList className="inline-flex w-auto min-w-full lg:grid lg:grid-cols-10">
            <TabsTrigger value="tecnicos" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              <span className="hidden sm:inline">Tecnicos</span>
            </TabsTrigger>
            <TabsTrigger value="vendedores" className="gap-2">
              <ShoppingCart className="h-4 w-4" />
              <span className="hidden sm:inline">Vendedores</span>
            </TabsTrigger>
            <TabsTrigger value="clientes" className="gap-2">
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">Clientes</span>
            </TabsTrigger>
            <TabsTrigger value="inventario" className="gap-2">
              <Package className="h-4 w-4" />
              <span className="hidden sm:inline">Inventario</span>
            </TabsTrigger>
            <TabsTrigger value="tiempo-reparacion" className="gap-2">
              <Clock className="h-4 w-4" />
              <span className="hidden sm:inline">Tiempos</span>
            </TabsTrigger>
            <TabsTrigger value="tasa-retorno" className="gap-2">
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">Retorno</span>
            </TabsTrigger>
            <TabsTrigger value="fallas" className="gap-2">
              <AlertTriangle className="h-4 w-4" />
              <span className="hidden sm:inline">Fallas</span>
            </TabsTrigger>
            <TabsTrigger value="rentabilidad" className="gap-2">
              <DollarSign className="h-4 w-4" />
              <span className="hidden sm:inline">Rentabilidad</span>
            </TabsTrigger>
            <TabsTrigger value="rentabilidad-tecnicos" className="gap-2">
              <DollarSign className="h-4 w-4" />
              <span className="hidden sm:inline">Rentab. tecnico</span>
            </TabsTrigger>
            <TabsTrigger value="prediccion" className="gap-2">
              <Boxes className="h-4 w-4" />
              <span className="hidden sm:inline">Prediccion</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="tecnicos" className="mt-6">
          <PerformanceTecnicos />
        </TabsContent>

        <TabsContent value="vendedores" className="mt-6">
          <PerformanceVendedores />
        </TabsContent>

        <TabsContent value="clientes" className="mt-6">
          <TopClientes />
        </TabsContent>

        <TabsContent value="inventario" className="mt-6">
          <AnalisisInventario />
        </TabsContent>

        <TabsContent value="tiempo-reparacion" className="mt-6">
          <TiempoReparacionChart />
        </TabsContent>

        <TabsContent value="tasa-retorno" className="mt-6">
          <TasaRetornoChart />
        </TabsContent>

        <TabsContent value="fallas" className="mt-6">
          <FallasComunesChart />
        </TabsContent>

        <TabsContent value="rentabilidad" className="mt-6">
          <RentabilidadChart />
        </TabsContent>

        <TabsContent value="rentabilidad-tecnicos" className="mt-6">
          <RentabilidadTecnicos />
        </TabsContent>

        <TabsContent value="prediccion" className="mt-6">
          <PrediccionRepuestosChart />
        </TabsContent>
      </Tabs>
    </div>
  )
}
