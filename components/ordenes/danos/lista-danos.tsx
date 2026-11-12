"use client"

import { Lock, X } from "lucide-react"
import { diagramaPorRef } from "@/components/ordenes/danos/diagramas"
import type { PinVista } from "@/components/ordenes/danos/pin-vista"
import { TIPO_DANO_META } from "@/lib/ordenes/danos"
import { cn, formatDateTime } from "@/lib/utils"

interface Props {
  pins: PinVista[]
  onQuitar?: (numero: number) => void
  onBorrar?: (id: string) => void
  puedeBorrar?: (p: PinVista) => boolean
  mostrarAutor?: boolean
  /** Leyenda para los pins de diagnóstico (p. ej. en la vista pública). */
  etiquetaDiagnostico?: string
  resaltado?: number | null
  onSeleccionar?: (numero: number) => void
}

export function ListaDanos({ pins, onQuitar, onBorrar, puedeBorrar, mostrarAutor, etiquetaDiagnostico, resaltado, onSeleccionar }: Props) {
  if (pins.length === 0) return null

  return (
    <ul className="space-y-1.5">
      {pins.map((p) => {
        const meta = TIPO_DANO_META[p.tipo]
        const Icon = meta.icon
        const vistaLabel = diagramaPorRef(p.diagrama).vistas.find((v) => v.id === p.vista)?.label ?? p.vista
        const recepcion = p.momento === "recepcion"
        const quitable = !recepcion && (p.id ? onBorrar && (puedeBorrar?.(p) ?? true) : onQuitar)
        return (
          <li
            key={p.numero}
            className={cn(
              "flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm",
              resaltado === p.numero && "ring-2 ring-ring",
            )}
          >
            <button
              type="button"
              onClick={() => onSeleccionar?.(p.numero)}
              className="flex min-h-11 flex-1 items-start gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.colorClass)} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{`${p.numero}. ${meta.label} – ${vistaLabel}${p.nota ? ` · ${p.nota}` : ""}`}</span>
                {recepcion && (
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <Lock className="h-3 w-3" aria-hidden="true" data-testid="icono-candado" />
                    Firmado por el cliente
                  </span>
                )}
                {!recepcion && etiquetaDiagnostico && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">{etiquetaDiagnostico}</span>
                )}
                {mostrarAutor && (p.createdByNombre || p.createdAt) && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {[p.createdByNombre, p.createdAt ? formatDateTime(p.createdAt) : null].filter(Boolean).join(" · ")}
                  </span>
                )}
              </span>
            </button>
            {quitable && (
              <button
                type="button"
                aria-label={`Quitar daño ${p.numero}`}
                onClick={() => (p.id ? onBorrar?.(p.id) : onQuitar?.(p.numero))}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
