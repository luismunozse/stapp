"use client"

import { AlertCircle, Loader2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { FeatureLockedView } from "@/components/billing/feature-locked-view"
import { BENEFICIOS_REPORTES_PRO, REPORTES_PRO, type ReportePro } from "./reportes-pro"

/** Estado bloqueado de un reporte Profesional, dentro de su pestaña. */
export function ReporteBloqueado({ reporte }: { reporte: ReportePro }) {
  const { nombre, descripcion } = REPORTES_PRO[reporte]
  return (
    <FeatureLockedView
      featureName={nombre}
      description={descripcion}
      benefits={BENEFICIOS_REPORTES_PRO}
      upgradeKey="reportes-avanzados"
    />
  )
}

/** Error real (500, red caída): a diferencia del bloqueo, se puede reintentar. */
export function ReporteError({
  mensaje,
  onReintentar,
}: {
  mensaje: string
  onReintentar: () => void
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <EmptyState
          icon={AlertCircle}
          title="Error al cargar datos"
          description={mensaje}
          variant="error"
          action={{ label: "Reintentar", onClick: onReintentar }}
        />
      </CardContent>
    </Card>
  )
}

export function ReporteCargando() {
  return (
    <Card>
      <CardContent className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </CardContent>
    </Card>
  )
}
