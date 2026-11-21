"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import { cn } from "@/lib/utils"
import { MobileSectionTabs, mobileSectionClass, type MobileSection } from "@/components/ui/mobile-section-tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import type { EstadoOrden } from "@/types"

// Skeleton loader para gráficos
function ChartSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-24 mt-1" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-[220px] w-full" />
      </CardContent>
    </Card>
  )
}

// Dynamic imports con loading states - no SSR para reducir bundle inicial
const OrdenesPorEstadoChart = dynamic(
  () => import("./ordenes-por-estado-chart").then(mod => ({ default: mod.OrdenesPorEstadoChart })),
  {
    loading: () => <ChartSkeleton />,
    ssr: false,
  }
)

const IngresosChart = dynamic(
  () => import("./ingresos-chart").then(mod => ({ default: mod.IngresosChart })),
  {
    loading: () => <ChartSkeleton />,
    ssr: false,
  }
)

const OrdenesPorTecnicoChart = dynamic(
  () => import("./ordenes-por-tecnico-chart").then(mod => ({ default: mod.OrdenesPorTecnicoChart })),
  {
    loading: () => <ChartSkeleton />,
    ssr: false,
  }
)

// Tipos
type OrdenesData = Partial<Record<EstadoOrden, number>>

interface IngresosDia {
  fecha: string
  total: number
}

interface TecnicoData {
  nombre: string
  ordenes: number
  completadas: number
}

interface DashboardChartsProps {
  ordenesPorEstado: OrdenesData
  ingresosUltimos7Dias: IngresosDia[]
  totalIngresos7Dias: number
  ordenesPorTecnico: TecnicoData[]
  children?: React.ReactNode
}

type ChartKey = "estado" | "ingresos" | "tecnico"

const CHART_TABS: MobileSection<ChartKey>[] = [
  { key: "estado", label: "Estados" },
  { key: "ingresos", label: "Ingresos" },
  { key: "tecnico", label: "Técnicos" },
]

export function DashboardCharts({
  ordenesPorEstado,
  ingresosUltimos7Dias,
  totalIngresos7Dias,
  ordenesPorTecnico,
  children,
}: DashboardChartsProps) {
  // Mobile/app: one chart at a time behind a segmented control instead of
  // three stacked ~300px cards. md+ keeps the 2×2 grid.
  const [chart, setChart] = useState<ChartKey>("estado")
  const mobileHidden = (key: ChartKey) => mobileSectionClass(chart, key, "md")

  return (
    <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2">
      {/* Recent orders lead on mobile: it's what people open the app for */}
      {children && <div className="max-md:order-first md:order-last [&>*]:h-full">{children}</div>}

      <MobileSectionTabs
        label="Gráficos"
        hideFrom="md"
        sections={CHART_TABS}
        value={chart}
        onChange={setChart}
      />

      <div className={cn("[&>*]:h-full", mobileHidden("estado"))}>
        <OrdenesPorEstadoChart data={ordenesPorEstado} />
      </div>
      <div className={cn("[&>*]:h-full", mobileHidden("ingresos"))}>
        <IngresosChart data={ingresosUltimos7Dias} totalPeriodo={totalIngresos7Dias} />
      </div>
      <div className={cn("[&>*]:h-full", mobileHidden("tecnico"))}>
        <OrdenesPorTecnicoChart data={ordenesPorTecnico} />
      </div>
    </div>
  )
}
