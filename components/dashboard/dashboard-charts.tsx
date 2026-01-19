"use client"

import dynamic from "next/dynamic"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

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
interface OrdenesData {
  RECIBIDO: number
  EN_DIAGNOSTICO: number
  PRESUPUESTADO: number
  APROBADO: number
  EN_REPARACION: number
  ESPERANDO_REPUESTO: number
  REPARADO: number
  ENTREGADO: number
  CANCELADO: number
  SIN_REPARACION: number
}

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

export function DashboardCharts({
  ordenesPorEstado,
  ingresosUltimos7Dias,
  totalIngresos7Dias,
  ordenesPorTecnico,
  children,
}: DashboardChartsProps) {
  return (
    <>
      {/* Gráficos principales */}
      <div className="grid gap-4 md:grid-cols-2">
        <OrdenesPorEstadoChart data={ordenesPorEstado} />
        <IngresosChart data={ingresosUltimos7Dias} totalPeriodo={totalIngresos7Dias} />
      </div>

      {/* Órdenes por técnico + contenido adicional */}
      <div className="grid gap-4 md:grid-cols-2">
        <OrdenesPorTecnicoChart data={ordenesPorTecnico} />
        {children}
      </div>
    </>
  )
}
