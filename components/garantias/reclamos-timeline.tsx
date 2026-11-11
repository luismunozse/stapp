"use client"

import Link from "next/link"
import { CheckCircle, Clock, MessageSquareWarning, Wrench, XCircle, type LucideIcon } from "lucide-react"
import { Badge, type BadgeProps } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ETIQUETA_FASE_RECLAMO, type FaseReclamo } from "@/lib/garantias/reclamo-estado"
import type { ReclamoGarantiaApi } from "@/lib/garantias/formato"
import type { AccionReclamo } from "./decidir-reclamo-dialog"
import { cn } from "@/lib/utils"

const FASE: Record<FaseReclamo, { variant: NonNullable<BadgeProps["variant"]>; icon: LucideIcon; punto: string }> = {
  ABIERTO: { variant: "warningSoft", icon: Clock, punto: "bg-warning" },
  ACEPTADO: { variant: "infoSoft", icon: Wrench, punto: "bg-info" },
  RECHAZADO: { variant: "destructiveSoft", icon: XCircle, punto: "bg-destructive" },
  RESUELTO: { variant: "successSoft", icon: CheckCircle, punto: "bg-success" },
}

export function FaseReclamoBadge({ fase }: { fase: FaseReclamo }) {
  const f = FASE[fase]
  return (
    <Badge variant={f.variant} showIcon icon={f.icon} className="whitespace-nowrap">
      {ETIQUETA_FASE_RECLAMO[fase]}
    </Badge>
  )
}

export interface ReclamosTimelineProps {
  reclamos: ReclamoGarantiaApi[]
  formatDate: (d: string) => string
  /** Solo ADMIN: muestra Aceptar / Rechazar en los reclamos por decidir. */
  puedeDecidir?: boolean
  onDecidir?: (reclamo: ReclamoGarantiaApi, accion: AccionReclamo) => void
}

/** Los reclamos de una garantía como línea de tiempo, del más nuevo al más viejo. */
export function ReclamosTimeline({ reclamos, formatDate, puedeDecidir = false, onDecidir }: ReclamosTimelineProps) {
  if (reclamos.length === 0) return null
  return (
    <div className="space-y-2">
      <h4 className="flex items-center gap-2 text-sm font-medium">
        <MessageSquareWarning className="h-4 w-4" aria-hidden="true" />
        Reclamos ({reclamos.length})
      </h4>
      <ol className="relative space-y-4 border-l border-border pl-5" aria-label="Historial de reclamos">
        {reclamos.map((r) => (
          <li key={r.id} className="relative">
            <span
              aria-hidden="true"
              className={cn("absolute -left-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-background", FASE[r.fase].punto)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <FaseReclamoBadge fase={r.fase} />
              <span className="text-xs text-muted-foreground">
                {formatDate(r.fechaReclamo)}
                {r.registradoPor ? ` · ${r.registradoPor}` : ""}
              </span>
            </div>
            <p className="mt-1 text-sm">{r.descripcion}</p>
            {r.vigenciaForzadaMotivo ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Registrado fuera de garantía: {r.vigenciaForzadaMotivo}
              </p>
            ) : null}
            {r.fase === "RECHAZADO" && (r.motivoRechazo || r.resolucion) ? (
              <p className="mt-1 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Motivo del rechazo:</span> {r.motivoRechazo || r.resolucion}
              </p>
            ) : null}
            {r.ordenReingreso ? (
              <p className="mt-1 text-sm">
                <Link
                  href={`/ordenes/${r.ordenReingreso.id}`}
                  className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline"
                >
                  {r.ordenReingreso.numero ? `Orden de re-ingreso ${r.ordenReingreso.numero}` : "Ver orden de re-ingreso"}
                </Link>
              </p>
            ) : null}
            {r.fase === "RESUELTO" && r.resolucion ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {r.resolucion}
                {r.fechaResolucion ? ` (${formatDate(r.fechaResolucion)})` : ""}
              </p>
            ) : null}
            {r.decididoPor && r.fase !== "ABIERTO" ? (
              <p className="mt-1 text-xs text-muted-foreground">Decidió: {r.decididoPor}</p>
            ) : null}
            {puedeDecidir && r.fase === "ABIERTO" && onDecidir ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="min-h-11 gap-1.5" onClick={() => onDecidir(r, "aceptar")}>
                  <CheckCircle className="h-4 w-4" aria-hidden="true" />
                  Aceptar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-11 gap-1.5 text-destructive"
                  onClick={() => onDecidir(r, "rechazar")}
                >
                  <XCircle className="h-4 w-4" aria-hidden="true" />
                  Rechazar
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  )
}
