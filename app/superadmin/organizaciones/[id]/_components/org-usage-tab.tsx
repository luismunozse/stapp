"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Package } from "lucide-react"
import { formatDate } from "@/lib/utils"
import type { OrganizationUsage } from "@/types/superadmin"

interface OrgUsageTabProps {
  usage: OrganizationUsage | null
}

export function OrgUsageTab({ usage }: OrgUsageTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          Uso Actual
        </CardTitle>
        <CardDescription>
          Consumo de recursos de la organización
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 bg-muted rounded-lg text-center">
            <div className="text-3xl font-bold">
              {usage?.ordenes_mes_actual || 0}
            </div>
            <div className="text-sm text-muted-foreground">
              Órdenes este mes
            </div>
          </div>
          <div className="p-4 bg-muted rounded-lg text-center">
            <div className="text-3xl font-bold">
              {usage?.ordenes_count || 0}
            </div>
            <div className="text-sm text-muted-foreground">
              Órdenes totales
            </div>
          </div>
          <div className="p-4 bg-muted rounded-lg text-center">
            <div className="text-3xl font-bold">
              {usage?.tecnicos_count || 0}
            </div>
            <div className="text-sm text-muted-foreground">Técnicos</div>
          </div>
          <div className="p-4 bg-muted rounded-lg text-center">
            <div className="text-3xl font-bold">
              {usage?.clientes_count || 0}
            </div>
            <div className="text-sm text-muted-foreground">Clientes</div>
          </div>
        </div>

        {usage && (
          <div className="mt-4 p-4 bg-muted/50 rounded-lg">
            <div className="text-sm text-muted-foreground">
              Storage usado: {(usage.storage_used_mb || 0).toFixed(2)} MB
            </div>
            <div className="text-sm text-muted-foreground">
              Período inicio: {formatDate(usage.periodo_inicio)}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
