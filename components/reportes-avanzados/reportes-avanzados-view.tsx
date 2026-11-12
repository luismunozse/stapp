"use client"

import { useState, type ReactNode } from "react"
import dynamic from "next/dynamic"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Users, Package, BarChart3, Clock, AlertTriangle, DollarSign, Boxes, ShoppingCart, Lock } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { PageShell } from "@/components/ui/page-shell"
import { ExportButton } from "./export-button"
import { BranchScopeLabel } from "./branch-scope-label"
import { ReporteBloqueado } from "./reporte-estados"
import { esReportePro, type ReportePro } from "./reportes-pro"

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

/**
 * `verTopClientes` — "Clientes" es Top clientes: cuánto gastó cada uno. Un
 * taller puede apagarle eso al vendedor con `vendedores_ven_ingresos`
 * (migración 326).
 *
 * Llega RESUELTO como prop desde la página, que es un server component y ya
 * tiene la sesión y el acceso a la BD. Se hizo así y no con useSession() + un
 * fetch a /api/org/features por tres motivos: no obliga a este componente a
 * vivir dentro de un <SessionProvider> (sus tests lo montan pelado), no hay
 * flash de la pestaña apareciendo y desapareciendo, y el valor sale del mismo
 * resolver que usa la API en vez de una segunda fuente de verdad.
 *
 * Default `true`: quien no pase la prop ve la pestaña, que es la conducta
 * previa a este permiso. Esconder de más sería una denegación fabricada; del
 * lado del servidor requireIngresosAccess() decide de verdad igual.
 *
 * `reportesAvanzados` — si la organización tiene la feature `advanced_reports`
 * (plan Profesional). Sin ella, las pestañas de REPORTES_PRO siguen visibles
 * con un candado y adentro muestran la invitación a pasarse de plan, en vez de
 * pedirle a la API un 403 que el gráfico pintaba como "Error al cargar datos".
 * Default `true` por el mismo motivo que `verTopClientes`: la API decide igual
 * y, si este valor se equivoca, el gráfico reconoce el 403 FEATURE_REQUIRED y
 * muestra el mismo bloqueo.
 */
export function ReportesAvanzadosView({
  verTopClientes = true,
  reportesAvanzados = true,
}: {
  verTopClientes?: boolean
  reportesAvanzados?: boolean
}) {
  const [activeTab, setActiveTab] = useState("tecnicos")
  const bloqueado = (tab: string) => !reportesAvanzados && esReportePro(tab)
  const contenidoPro = (tab: ReportePro, reporte: ReactNode) =>
    reportesAvanzados ? reporte : <ReporteBloqueado reporte={tab} />

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
    <PageShell
      title="Reportes"
      description="Analizá el rendimiento de tu taller con métricas detalladas"
      meta={<BranchScopeLabel />}
      actions={
        exportableReports[activeTab] && !bloqueado(activeTab) ? (
          <ExportButton reportType={exportableReports[activeTab]} />
        ) : undefined
      }
    >

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto">
          <TabsList className="inline-flex w-auto min-w-full lg:grid lg:grid-cols-10">
            <TabsTrigger value="tecnicos" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              <span className="hidden sm:inline">Técnicos</span>
            </TabsTrigger>
            <TabsTrigger value="vendedores" className="gap-2">
              <ShoppingCart className="h-4 w-4" />
              <span className="hidden sm:inline">Vendedores</span>
            </TabsTrigger>
            {verTopClientes && (
              <TabsTrigger value="clientes" className="gap-2">
                <Users className="h-4 w-4" />
                <span className="hidden sm:inline">Clientes</span>
              </TabsTrigger>
            )}
            <TabsTrigger value="inventario" className="gap-2">
              <Package className="h-4 w-4" />
              <span className="hidden sm:inline">Inventario</span>
            </TabsTrigger>
            <TabsTrigger value="tiempo-reparacion" className="gap-2">
              <Clock className="h-4 w-4" />
              <span className="hidden sm:inline">Tiempos</span>
              {bloqueado("tiempo-reparacion") && <Lock className="h-3 w-3 text-amber-600" aria-label="Plan Profesional" />}
            </TabsTrigger>
            <TabsTrigger value="tasa-retorno" className="gap-2">
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">Retorno</span>
              {bloqueado("tasa-retorno") && <Lock className="h-3 w-3 text-amber-600" aria-label="Plan Profesional" />}
            </TabsTrigger>
            <TabsTrigger value="fallas" className="gap-2">
              <AlertTriangle className="h-4 w-4" />
              <span className="hidden sm:inline">Fallas</span>
              {bloqueado("fallas") && <Lock className="h-3 w-3 text-amber-600" aria-label="Plan Profesional" />}
            </TabsTrigger>
            <TabsTrigger value="rentabilidad" className="gap-2">
              <DollarSign className="h-4 w-4" />
              <span className="hidden sm:inline">Rentabilidad</span>
              {bloqueado("rentabilidad") && <Lock className="h-3 w-3 text-amber-600" aria-label="Plan Profesional" />}
            </TabsTrigger>
            <TabsTrigger value="rentabilidad-tecnicos" className="gap-2">
              <DollarSign className="h-4 w-4" />
              <span className="hidden sm:inline">Rentab. técnico</span>
              {bloqueado("rentabilidad-tecnicos") && <Lock className="h-3 w-3 text-amber-600" aria-label="Plan Profesional" />}
            </TabsTrigger>
            <TabsTrigger value="prediccion" className="gap-2">
              <Boxes className="h-4 w-4" />
              <span className="hidden sm:inline">Predicción</span>
              {bloqueado("prediccion") && <Lock className="h-3 w-3 text-amber-600" aria-label="Plan Profesional" />}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="tecnicos" className="mt-6">
          <PerformanceTecnicos />
        </TabsContent>

        <TabsContent value="vendedores" className="mt-6">
          <PerformanceVendedores />
        </TabsContent>

        {verTopClientes && (
          <TabsContent value="clientes" className="mt-6">
            <TopClientes />
          </TabsContent>
        )}

        <TabsContent value="inventario" className="mt-6">
          <AnalisisInventario />
        </TabsContent>

        <TabsContent value="tiempo-reparacion" className="mt-6">
          {contenidoPro("tiempo-reparacion", <TiempoReparacionChart />)}
        </TabsContent>

        <TabsContent value="tasa-retorno" className="mt-6">
          {contenidoPro("tasa-retorno", <TasaRetornoChart />)}
        </TabsContent>

        <TabsContent value="fallas" className="mt-6">
          {contenidoPro("fallas", <FallasComunesChart />)}
        </TabsContent>

        <TabsContent value="rentabilidad" className="mt-6">
          {contenidoPro("rentabilidad", <RentabilidadChart />)}
        </TabsContent>

        <TabsContent value="rentabilidad-tecnicos" className="mt-6">
          {contenidoPro("rentabilidad-tecnicos", <RentabilidadTecnicos />)}
        </TabsContent>

        <TabsContent value="prediccion" className="mt-6">
          {contenidoPro("prediccion", <PrediccionRepuestosChart />)}
        </TabsContent>
      </Tabs>
    </PageShell>
  )
}
