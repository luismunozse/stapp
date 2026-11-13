"use client"

import { useId, useMemo, useState } from "react"
import { CheckCircle2 } from "lucide-react"
import { DiagramaDanos } from "@/components/ordenes/danos/diagrama-danos"
import { ListaDanos } from "@/components/ordenes/danos/lista-danos"
import { refDiagrama, resolverDiagrama } from "@/components/ordenes/danos/diagramas"
import type { PinVista } from "@/components/ordenes/danos/pin-vista"
import { MAX_DANOS_POR_ORDEN, danoInputSchema, validarDanosParaTipo, type DanoInput } from "@/lib/ordenes/danos"
import type { EstadoFisicoPDF } from "@/lib/ordenes/estado-fisico-lineas"
import { cn } from "@/lib/utils"

export interface EstadoFisicoValor {
  danos: DanoInput[]
  sinDanos: boolean
}

interface Props {
  codigoTipo: string | null
  valor: EstadoFisicoValor
  onChange: (v: EstadoFisicoValor) => void
  obligatorio: boolean
  error?: string
  /** Id del boton "Sin daños visibles". Por defecto ESTADO_FISICO_FOCO_ID; un
   *  formulario con varios equipos pasa uno por equipo (ids unicos). */
  focoId?: string
}

/** Id del boton "Sin daños visibles": el formulario lo enfoca cuando la
 *  seccion es obligatoria y quedo sin marcar. */
export const ESTADO_FISICO_FOCO_ID = "estado-fisico-sin-danos"

export const ESTADO_FISICO_VACIO: EstadoFisicoValor = { danos: [], sinDanos: false }

/** El estado fisico que trae un borrador, saneado: cada pin pasa por el mismo
 *  schema que valida la API (los que no, se tiran), y si los que quedan no
 *  corresponden al dibujo del tipo de equipo restaurado se tira la lista entera
 *  -- un pin sobre otro dibujo marca un lugar que no existe en este. Nunca
 *  tira: un borrador viejo o tocado a mano tiene que poder restaurarse igual. */
export function sanearEstadoFisicoBorrador(raw: unknown, codigoTipo: string | null): EstadoFisicoValor {
  if (!raw || typeof raw !== "object") return ESTADO_FISICO_VACIO
  const { danos: rawDanos, sinDanos } = raw as { danos?: unknown; sinDanos?: unknown }
  const danos: DanoInput[] = []
  if (Array.isArray(rawDanos)) {
    for (const item of rawDanos) {
      const parsed = danoInputSchema.safeParse(item)
      if (parsed.success) danos.push(parsed.data)
    }
  }
  if (danos.length > 0 && validarDanosParaTipo(danos, codigoTipo).ok) {
    return { danos, sinDanos: false }
  }
  return { danos: [], sinDanos: sinDanos === true }
}

/** Lo que el ticket/comprobante imprime de un estado fisico recien guardado
 *  (pins numerados por posicion, todos de recepcion); null si no hay nada. */
export function estadoFisicoParaComprobante(valor: EstadoFisicoValor): EstadoFisicoPDF | null {
  if (valor.danos.length === 0 && !valor.sinDanos) return null
  return {
    diagrama: valor.danos[0]?.diagrama ?? "",
    sinDanos: valor.danos.length === 0 && valor.sinDanos,
    danos: valor.danos.map((d, i) => ({ ...d, numero: i + 1, momento: "recepcion" as const })),
  }
}

/** Estado fisico del equipo al recibirlo: pins sobre el dibujo del tipo de
 *  equipo, o "Sin daños visibles". Nunca las dos cosas. Los pins son locales
 *  (sin id) y se numeran por posicion. */
export function EstadoFisicoRecepcion({
  codigoTipo,
  valor,
  onChange,
  obligatorio,
  error,
  focoId = ESTADO_FISICO_FOCO_ID,
}: Props) {
  const tituloId = useId()
  const errorId = useId()
  const [resaltado, setResaltado] = useState<number | null>(null)
  const diagrama = useMemo(() => refDiagrama(resolverDiagrama(codigoTipo)), [codigoTipo])
  const pins: PinVista[] = valor.danos.map((d, i) => ({ ...d, numero: i + 1 }))
  const hayPins = valor.danos.length > 0
  const editable = !valor.sinDanos && valor.danos.length < MAX_DANOS_POR_ORDEN

  function agregar(p: Omit<DanoInput, "diagrama">) {
    if (valor.sinDanos || valor.danos.length >= MAX_DANOS_POR_ORDEN) return
    onChange({ danos: [...valor.danos, { ...p, diagrama }], sinDanos: false })
  }

  function quitar(numero: number) {
    setResaltado(null)
    onChange({ danos: valor.danos.filter((_, i) => i !== numero - 1), sinDanos: valor.sinDanos })
  }

  return (
    <section aria-labelledby={tituloId} className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={tituloId} className="font-medium">
          Estado físico
        </h3>
        {obligatorio && <span className="text-xs text-muted-foreground">Obligatorio</span>}
      </div>

      <DiagramaDanos
        diagrama={diagrama}
        pins={pins}
        editable={editable}
        onAgregar={agregar}
        resaltado={resaltado}
        onSeleccionar={setResaltado}
      />

      {valor.sinDanos && (
        <p className="flex items-center justify-center gap-2 text-sm font-medium text-success-text">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Sin daños visibles al ingreso
        </p>
      )}

      <ListaDanos pins={pins} onQuitar={quitar} resaltado={resaltado} onSeleccionar={setResaltado} />

      <div className="text-center">
        <button
          id={focoId}
          type="button"
          aria-pressed={valor.sinDanos}
          aria-describedby={error ? errorId : undefined}
          disabled={hayPins}
          onClick={() => onChange({ danos: [], sinDanos: !valor.sinDanos })}
          className={cn(
            "inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            valor.sinDanos ? "border-primary bg-primary/10 text-foreground" : "bg-background hover:bg-accent",
          )}
        >
          Sin daños visibles
        </button>
        {hayPins && (
          <p className="mt-1 text-xs text-muted-foreground">Para marcarlo, quitá primero los daños de la lista.</p>
        )}
      </div>

      {error && (
        <p id={errorId} role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
    </section>
  )
}
