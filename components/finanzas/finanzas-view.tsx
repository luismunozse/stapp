"use client"

import { useCallback, useState } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import dynamic from "next/dynamic"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { PageShell } from "@/components/ui/page-shell"
import { LayoutDashboard, FileBarChart, TrendingUp, Receipt, DollarSign } from "lucide-react"
import { TendenciaFinanciera } from "./tendencia-financiera"
import { PeriodSelector } from "./period-selector"
import { rangeFromParams, type PeriodRange } from "@/lib/finanzas-period"

// Pestañas que respetan el selector de período global.
// (Resumen usa su propia ventana de tendencia histórica.)
const PERIOD_TABS = new Set(["estado-resultados", "ingresos", "gastos"])

function ReporteSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-32 mt-2" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-[300px] w-full" />
      </CardContent>
    </Card>
  )
}

const EstadoResultados = dynamic(
  () => import("@/components/reportes/estado-resultados").then((m) => ({ default: m.EstadoResultados })),
  { loading: () => <ReporteSkeleton />, ssr: false }
)

const ResumenIngresos = dynamic(
  () => import("@/components/reportes-avanzados/resumen-ingresos").then((m) => ({ default: m.ResumenIngresos })),
  { loading: () => <ReporteSkeleton />, ssr: false }
)

const GastosResumen = dynamic(
  () => import("./gastos-resumen").then((m) => ({ default: m.GastosResumen })),
  { loading: () => <ReporteSkeleton />, ssr: false }
)

export function FinanzasView() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [tab, setTab] = useState("resumen")

  const period = rangeFromParams({
    desde: searchParams.get("desde"),
    hasta: searchParams.get("hasta"),
  })

  const setPeriod = useCallback(
    (r: PeriodRange) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set("desde", r.desde)
      params.set("hasta", r.hasta)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [router, pathname, searchParams]
  )

  return (
    <PageShell
      title="Finanzas"
      description="Panorama financiero del negocio: ingresos, costos, gastos y rentabilidad"
      icon={DollarSign}
    >
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <div className="overflow-x-auto">
          <TabsList className="inline-flex w-auto min-w-full sm:grid sm:grid-cols-4 sm:w-full">
            <TabsTrigger value="resumen" className="gap-1 sm:gap-2 text-xs sm:text-sm">
              <LayoutDashboard className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span>Resumen</span>
            </TabsTrigger>
            <TabsTrigger value="estado-resultados" className="gap-1 sm:gap-2 text-xs sm:text-sm">
              <FileBarChart className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Estado de Resultados</span>
              <span className="sm:hidden">Resultados</span>
            </TabsTrigger>
            <TabsTrigger value="ingresos" className="gap-1 sm:gap-2 text-xs sm:text-sm">
              <TrendingUp className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span>Ingresos</span>
            </TabsTrigger>
            <TabsTrigger value="gastos" className="gap-1 sm:gap-2 text-xs sm:text-sm">
              <Receipt className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span>Gastos</span>
            </TabsTrigger>
          </TabsList>
        </div>

        {PERIOD_TABS.has(tab) && (
          <PeriodSelector value={period} onChange={setPeriod} />
        )}

        <TabsContent value="resumen" className="space-y-4">
          <TendenciaFinanciera />
        </TabsContent>

        <TabsContent value="estado-resultados">
          <EstadoResultados desde={period.desde} hasta={period.hasta} />
        </TabsContent>

        <TabsContent value="ingresos">
          <ResumenIngresos desde={period.desde} hasta={period.hasta} />
        </TabsContent>

        <TabsContent value="gastos">
          <GastosResumen desde={period.desde} hasta={period.hasta} />
        </TabsContent>
      </Tabs>
    </PageShell>
  )
}
