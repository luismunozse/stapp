"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, GraduationCap, Loader2, Smartphone, Trash2, User, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { OrderStatusBadge } from "@/components/ui/badge"
import { StatusBanner } from "@/components/ui/status-banner"
import { FieldSectionLabel } from "@/components/ui/field-section-label"
import { useCurrency, useTerminologia } from "@/contexts/currency-context"
import { NotificationHistory } from "@/components/ordenes/notification-history"
import { PracticaBadge } from "@/components/onboarding/practica-badge"
import { useBorrarPractica } from "@/components/onboarding/use-borrar-practica"
import { VerLoQueVeTuCliente } from "@/components/onboarding/ver-lo-que-ve-tu-cliente"
import type { OrdenServicio } from "@/types"

interface PracticaOrdenDetailProps {
  orden: OrdenServicio
  isAdmin: boolean
}

/**
 * Read-only view of the onboarding practice order. It deliberately renders
 * none of the order actions (state changes, cobros, seña, parts, quotes,
 * invoices, printing): the practice must never reach caja, stock or ARCA, and
 * a separate view keeps actions added to OrdenDetail later from leaking in.
 */
export function PracticaOrdenDetail({ orden, isAdmin }: PracticaOrdenDetailProps) {
  const router = useRouter()
  const term = useTerminologia()
  const { formatPrice, formatDate } = useCurrency()
  const { borrar, borrando } = useBorrarPractica(() => router.push("/ordenes"))
  const entregada = orden.estado === "ENTREGADO_SIN_COBRO"

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-4">
          <Button asChild variant="outline" size="icon" className="shrink-0">
            <Link href="/ordenes" aria-label="Volver a órdenes">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">Orden de práctica</h1>
              <OrderStatusBadge status={orden.estado} showIcon />
            </div>
            <PracticaBadge conAviso />
            <p className="text-sm text-muted-foreground">Ingresado el {formatDate(orden.fechaIngreso)}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {orden.publicToken && <VerLoQueVeTuCliente publicToken={orden.publicToken} />}
          {isAdmin && !entregada && (
            <Button asChild variant="outline" size="sm">
              <Link href="/onboarding">Seguir con la práctica</Link>
            </Button>
          )}
          {isAdmin && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => void borrar()}
              disabled={borrando}
            >
              {borrando ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
              )}
              Borrar práctica
            </Button>
          )}
        </div>
      </div>

      <StatusBanner tone="info" icon={GraduationCap}>
        Es una orden de práctica: acá no se cobra, no se mueve stock y no se factura.
      </StatusBanner>

      <Card>
        <CardContent className="grid gap-6 p-6 md:grid-cols-2">
          <div className="space-y-2">
            <FieldSectionLabel icon={User}>Cliente</FieldSectionLabel>
            <p className="text-lg font-semibold">{isAdmin ? "Vos" : orden.cliente?.nombre}</p>
            {orden.cliente?.email && <p className="text-sm text-muted-foreground">{orden.cliente.email}</p>}
          </div>
          <div className="space-y-2">
            <FieldSectionLabel icon={Smartphone}>{term("equipo")}</FieldSectionLabel>
            <p className="text-lg font-semibold">{orden.dispositivo}</p>
          </div>
          <div className="space-y-2 md:col-span-2">
            <FieldSectionLabel icon={Wrench}>Problema reportado</FieldSectionLabel>
            <p className="text-sm">{orden.problemaReportado}</p>
          </div>
          {orden.costoFinal != null && (
            <div className="space-y-1 md:col-span-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Cobrarías</p>
              <p className="text-lg font-semibold">{formatPrice(orden.costoFinal)}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <NotificationHistory ordenId={orden.id} />
    </div>
  )
}
