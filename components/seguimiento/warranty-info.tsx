"use client"

import { Shield, Calendar, Clock, CheckCircle2, AlertTriangle, MessageSquareWarning, XCircle, Ban, type LucideIcon } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EstadoGarantiaPill } from "@/components/garantias/estado-garantia-pill"
import { cn } from "@/lib/utils"
import type { EstadoGarantia } from "@/lib/garantias/estado"
import type { GarantiaPublica, FaseReclamoPublica } from "@/lib/garantias/seguimiento-publico"

interface WarrantyInfoProps {
  garantia: GarantiaPublica
  timezone?: string
}

function formatDate(dateStr: string | null, timezone?: string) {
  if (!dateStr) return "—"
  try {
    return new Intl.DateTimeFormat("es-AR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: timezone || "America/Argentina/Buenos_Aires",
    }).format(new Date(dateStr))
  } catch {
    return dateStr
  }
}

/** Tono del recuadro según el estado: tokens semánticos, con modo oscuro. */
const TONO: Record<EstadoGarantia, { caja: string; icono: string; icon: LucideIcon; texto: string }> = {
  VIGENTE: { caja: "border-success/30 bg-success-50 dark:bg-success/10", icono: "text-success-700 dark:text-success-400", icon: CheckCircle2, texto: "Tu garantía está vigente" },
  POR_VENCER: { caja: "border-warning/30 bg-warning-50 dark:bg-warning/10", icono: "text-warning-700 dark:text-warning-500", icon: AlertTriangle, texto: "Tu garantía está por vencer" },
  RECLAMADA: { caja: "border-info/30 bg-info-50 dark:bg-info/10", icono: "text-info-700 dark:text-info-400", icon: MessageSquareWarning, texto: "Tenés un reclamo de garantía en curso" },
  VENCIDA: { caja: "border-destructive/30 bg-destructive/10", icono: "text-destructive-text", icon: XCircle, texto: "Tu garantía venció" },
  ANULADA: { caja: "border-border bg-muted", icono: "text-muted-foreground", icon: Ban, texto: "Esta garantía fue anulada" },
}

const TONO_RECLAMO: Record<FaseReclamoPublica, { caja: string; icono: string; icon: LucideIcon }> = {
  EN_REVISION: { caja: "border-info/30 bg-info-50 dark:bg-info/10", icono: "text-info-700 dark:text-info-400", icon: Clock },
  ACEPTADO: { caja: "border-success/30 bg-success-50 dark:bg-success/10", icono: "text-success-700 dark:text-success-400", icon: CheckCircle2 },
  RESUELTO: { caja: "border-border bg-muted", icono: "text-muted-foreground", icon: CheckCircle2 },
  RECHAZADO: { caja: "border-destructive/30 bg-destructive/10", icono: "text-destructive-text", icon: XCircle },
}

export function WarrantyInfo({ garantia, timezone }: WarrantyInfoProps) {
  const tono = TONO[garantia.estado] ?? TONO.VIGENTE
  const IconoEstado = tono.icon
  const corriendo = garantia.estado === "VIGENTE" || garantia.estado === "POR_VENCER" || garantia.estado === "RECLAMADA"
  const reclamo = garantia.reclamo
  const tonoReclamo = reclamo ? TONO_RECLAMO[reclamo.fase] : null
  const IconoReclamo = tonoReclamo?.icon

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-lg">
          <span className="flex items-center gap-2">
            <Shield className={cn("h-5 w-5", tono.icono)} aria-hidden />
            Garantía de reparación
          </span>
          <EstadoGarantiaPill estado={garantia.estado} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {reclamo && tonoReclamo && IconoReclamo && (
          <div className={cn("rounded-lg border p-4", tonoReclamo.caja)} role="status">
            <div className="flex items-start gap-2">
              <IconoReclamo className={cn("h-5 w-5 mt-0.5 shrink-0", tonoReclamo.icono)} aria-hidden />
              <div className="space-y-1 min-w-0">
                <p className="font-medium text-foreground break-words">{reclamo.titulo}</p>
                {reclamo.detalle && <p className="text-sm text-muted-foreground">{reclamo.detalle}</p>}
                {reclamo.fecha && (
                  <p className="text-xs text-muted-foreground">Reclamo del {formatDate(reclamo.fecha, timezone)}</p>
                )}
              </div>
            </div>
          </div>
        )}

        <div className={cn("rounded-lg border p-4", tono.caja)}>
          <div className="flex items-center gap-2 mb-2">
            <IconoEstado className={cn("h-5 w-5", tono.icono)} aria-hidden />
            <span className="font-medium text-foreground">{tono.texto}</span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" aria-hidden />
              <div>
                <p className="text-muted-foreground">Duración</p>
                <p className="font-medium">{garantia.diasValidez} días</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" aria-hidden />
              <div>
                <p className="text-muted-foreground">{corriendo ? "Días restantes" : "Venció"}</p>
                <p className="font-medium">
                  {corriendo
                    ? garantia.diasRestantes === 0
                      ? "Vence hoy"
                      : `${garantia.diasRestantes} ${garantia.diasRestantes === 1 ? "día" : "días"}`
                    : formatDate(garantia.fechaVencimiento, timezone)}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-3 text-xs text-muted-foreground">
            <p>Desde: {formatDate(garantia.fechaInicio, timezone)}</p>
            <p>Hasta: {formatDate(garantia.fechaVencimiento, timezone)}</p>
          </div>
        </div>

        {garantia.notas && <p className="text-sm text-muted-foreground whitespace-pre-line">{garantia.notas}</p>}

        {garantia.terminos && (
          <details className="rounded-lg border p-3 text-sm">
            <summary className="cursor-pointer font-medium text-foreground">Términos de garantía</summary>
            <p className="mt-2 text-muted-foreground whitespace-pre-line">{garantia.terminos}</p>
          </details>
        )}
      </CardContent>
    </Card>
  )
}
