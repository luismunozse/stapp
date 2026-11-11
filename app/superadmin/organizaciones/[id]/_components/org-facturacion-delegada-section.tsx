"use client"

import { useEffect, useCallback } from "react"
import { FileCheck2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useSuperadminFetch, useSuperadminMutation } from "@/hooks/use-superadmin-fetch"
import type { OrganizationDetail } from "@/types/superadmin"

interface Delegacion {
  cuit: string | null
  estado: string | null
  puntoVenta: number | null
  condicionFiscal: string | null
  updatedAt: string | null
}

interface DelegacionResponse {
  delegacion: Delegacion | null
}

const ESTADOS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  conectado: { label: "Verificada", variant: "default" },
  pendiente_verificacion: { label: "Pendiente de verificación", variant: "secondary" },
  error: { label: "Rechazada", variant: "destructive" },
}

/**
 * Verificación de la delegación ARCA (migración 385). Antes de aprobar,
 * confirmar en ARCA que la razón social del CUIT corresponde a esta
 * organización: aprobar habilita a facturar en nombre de ese CUIT.
 * No se muestra si la org no factura por delegación.
 */
export function OrgFacturacionDelegadaSection({ organization }: { organization: OrganizationDetail }) {
  const { data, fetchData } = useSuperadminFetch<DelegacionResponse>()
  const { mutate, loading: mutating } = useSuperadminMutation()

  const endpoint = `/api/superadmin/organizations/${organization.id}/facturacion-delegada`

  const refresh = useCallback(() => {
    fetchData(endpoint)
  }, [endpoint, fetchData])

  useEffect(() => {
    refresh()
  }, [refresh])

  const delegacion = data?.delegacion
  if (!delegacion) return null

  const estado = ESTADOS[delegacion.estado ?? ""] ?? { label: delegacion.estado ?? "—", variant: "outline" as const }

  const accionar = (accion: "aprobar" | "rechazar") =>
    mutate(endpoint, {
      method: "POST",
      body: { accion },
      successMessage: accion === "aprobar" ? "Delegación aprobada" : "Delegación rechazada",
      onSuccess: refresh,
    })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileCheck2 className="h-5 w-5" />
          Facturación delegada (ARCA)
        </CardTitle>
        <CardDescription>
          Antes de aprobar, verificá en ARCA que el CUIT pertenece a esta organización. Aprobar habilita a
          emitir comprobantes en nombre de ese CUIT.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-mono">CUIT {delegacion.cuit}</span>
          {delegacion.puntoVenta ? <span>Punto de venta {delegacion.puntoVenta}</span> : null}
          {delegacion.condicionFiscal ? <span>{delegacion.condicionFiscal}</span> : null}
          <Badge variant={estado.variant}>{estado.label}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {delegacion.estado !== "conectado" && (
            <Button size="sm" onClick={() => accionar("aprobar")} disabled={mutating}>
              Aprobar CUIT
            </Button>
          )}
          {delegacion.estado !== "error" && (
            <Button size="sm" variant="outline" onClick={() => accionar("rechazar")} disabled={mutating}>
              {delegacion.estado === "conectado" ? "Revocar" : "Rechazar"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
