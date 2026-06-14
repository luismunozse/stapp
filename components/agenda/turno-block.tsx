"use client"

import { Clock, MapPin, Wrench, FileText } from "lucide-react"
import { format, parseISO } from "date-fns"
import type { TipoTurno, TurnoConRelaciones } from "@/types"
import { TURNO_ESTADO_STYLES } from "@/lib/turno-colors"

const TIPO_SHORT: Record<TipoTurno, string> = {
  visita_diagnostico: "Diag.",
  reparacion_onsite: "Rep.",
  retiro: "Retiro",
  entrega: "Entrega",
  mantenimiento: "Mant.",
}

interface TurnoBlockProps {
  turno: TurnoConRelaciones
  onClick: () => void
  variant?: "calendar" | "list"
  style?: React.CSSProperties
  compact?: boolean
}

export function TurnoBlock({ turno, onClick, variant = "calendar", style, compact }: TurnoBlockProps) {
  const s = TURNO_ESTADO_STYLES[turno.estado]
  const clienteNombre = turno.cliente?.nombre || turno.clienteSnapshot?.nombre || "Sin cliente"
  const hora = format(parseISO(turno.inicio), "HH:mm")
  const horaFin = turno.fin ? format(parseISO(turno.fin), "HH:mm") : null

  if (variant === "calendar") {
    return (
      <button
        onClick={onClick}
        style={style}
        className={`
          absolute left-1 right-1 rounded-md overflow-hidden cursor-pointer
          ${s.bg} ${s.text}
          border border-black/5 dark:border-white/10
          text-left transition-colors shadow-sm
          flex flex-col
        `}
      >
        <span className={`absolute left-0 top-0 bottom-0 w-1 ${s.bar}`} />
        <div className="pl-2 pr-1.5 py-1 flex-1 min-h-0 overflow-hidden">
          <div className="flex items-center gap-1 text-[10px] font-semibold leading-tight">
            <Clock className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{hora}{horaFin ? `–${horaFin}` : ""}</span>
            <span className="ml-auto text-[9px] px-1 rounded bg-black/5 dark:bg-white/10 font-medium">
              {TIPO_SHORT[turno.tipo]}
            </span>
          </div>
          {!compact && (
            <>
              <p className="text-[11px] font-medium truncate mt-0.5 leading-tight">
                {clienteNombre}
              </p>
              {turno.tecnico && (
                <p className="text-[10px] truncate opacity-75 leading-tight">
                  {turno.tecnico.nombre}
                </p>
              )}
            </>
          )}
        </div>
      </button>
    )
  }

  // list variant
  return (
    <button
      onClick={onClick}
      className="w-full text-left p-3 hover:bg-accent/40 transition-colors flex gap-3 items-start border-b last:border-b-0"
    >
      <div className={`shrink-0 w-1 self-stretch rounded-full ${s.bar} min-h-[40px]`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="font-semibold text-sm flex items-center gap-1">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            {hora}{horaFin ? ` — ${horaFin}` : ""}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.bg} ${s.text} font-medium`}>
            {TIPO_SHORT[turno.tipo]}
          </span>
          {turno.orden && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-300 font-medium flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {turno.orden.codigoOrden || `#${turno.orden.numeroOrden}`}
            </span>
          )}
        </div>
        <p className="text-sm font-medium truncate">{clienteNombre}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-0.5">
          {turno.tecnico && (
            <span className="flex items-center gap-1">
              <Wrench className="h-3 w-3" />
              {turno.tecnico.nombre}
            </span>
          )}
          {turno.direccion && (
            <span className="flex items-center gap-1 truncate max-w-[200px]">
              <MapPin className="h-3 w-3 shrink-0" />
              {turno.direccion}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}
