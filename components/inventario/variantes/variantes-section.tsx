"use client"

import { useEffect, useId, useRef, useState, type Dispatch } from "react"
import { Layers } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CollapsibleSection } from "@/components/ui/collapsible-section"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { LIMITES } from "@/lib/variantes-schema"
import { archivosConStock, bloqueos, filasEnOrden, stockTotal, type VariantesAccion, type VariantesState } from "@/lib/variantes-filas"
import { CombinacionesCards } from "./combinacion-card"
import { CombinacionesTabla } from "./combinaciones-tabla"
import { unidades } from "./campos-fila"
import { OpcionesEditor } from "./opciones-editor"
import { validezDeVariantes } from "./vista"

/*
 * The "Variantes" section of the product form. It renders from the reducer state and dispatches to it;
 * it owns no data. NOT mounted anywhere yet: the form wiring (saving, photos, the promote dialog) is a
 * later step, and `permiteVariantes` keeps it dark until the list exposes it.
 *
 * Everything the reducer refuses ends up in `estado.aviso`, shown in a polite live region that exists
 * from the start so a screen reader announces the first message too.
 */

export interface PropsVariantesSection {
  estado: VariantesState
  dispatch: Dispatch<VariantesAccion>
  /** Why the switch cannot be used (a kit, a missing migration...). Shown next to it and read with it. */
  motivoDeshabilitado?: string | null
  /** A saved row's stock was adjusted: the form should reload the group to see the new number. */
  alAjustarStock?: () => void
  /** A save is running: everything is locked. */
  guardando?: boolean
}

const textoDeVariantes = (n: number) => (n === 1 ? "1 variante" : `${n} variantes`)

/**
 * "Aplicar precio a todas": asks first if it would overwrite a price somebody set. The question is inline
 * and not modal, so it is a labelled group (not an alertdialog, which promises a focus trap this does not
 * have): the question names the group, the consequence describes it, the focus moves to its first button
 * and comes back to the trigger when it closes.
 */
function AplicarPrecio({ estado, dispatch, deshabilitado }: { estado: VariantesState; dispatch: Dispatch<VariantesAccion>; deshabilitado?: boolean }) {
  const [confirmando, setConfirmando] = useState(false)
  const idPregunta = useId()
  const idConsecuencia = useId()
  const disparador = useRef<HTMLButtonElement>(null)
  const primero = useRef<HTMLButtonElement>(null)
  const devolverFoco = useRef(false)
  // A row brought back from the archive has a price the client never saw, so applying changes it for sure.
  const cambian = filasEnOrden(estado).filter((f) => !f.archivar && ((f.restaurada && !f.precioTocado) || f.precioVenta !== estado.precioBase)).length

  useEffect(() => {
    if (confirmando) primero.current?.focus()
    else if (devolverFoco.current) {
      devolverFoco.current = false
      disparador.current?.focus()
    }
  }, [confirmando])

  const cerrar = () => {
    devolverFoco.current = true
    setConfirmando(false)
  }

  if (confirmando) {
    return (
      <div role="group" aria-labelledby={idPregunta} aria-describedby={idConsecuencia} className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
        <p id={idPregunta} className="font-medium">
          ¿Cambiar el precio de {textoDeVariantes(cambian)}?
        </p>
        <p id={idConsecuencia} className="text-muted-foreground">
          Todas pasan a tener el precio base.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button ref={primero} type="button" variant="outline" disabled={deshabilitado} onClick={cerrar}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={deshabilitado}
            onClick={() => {
              dispatch({ tipo: "aplicarPrecioATodas" })
              cerrar()
            }}
          >
            Sí, cambiar
          </Button>
        </div>
      </div>
    )
  }
  return (
    <Button
      ref={disparador}
      type="button"
      variant="outline"
      disabled={deshabilitado}
      onClick={() => (cambian === 0 ? dispatch({ tipo: "aplicarPrecioATodas" }) : setConfirmando(true))}
    >
      Aplicar precio a todas
    </Button>
  )
}

// Every state object gets a number once. A refusal returns a NEW state with the same text as the last one, and
// that new number is what makes the message a new node: a live region only announces what it did not have.
const numeros = new WeakMap<object, number>()
let siguienteNumero = 0
const numeroDe = (estado: object) => {
  let n = numeros.get(estado)
  if (n === undefined) numeros.set(estado, (n = ++siguienteNumero))
  return n
}

/** The reducer's reason for the last refusal, in a polite live region that exists from the start. */
function Aviso({ estado }: { estado: VariantesState }) {
  return (
    <div role="status" aria-label="Aviso" aria-live="polite">
      {estado.aviso !== null && (
        <p
          key={numeroDe(estado)}
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
        >
          {estado.aviso}
        </p>
      )}
    </div>
  )
}

export function VariantesSection({ estado, dispatch, motivoDeshabilitado, alAjustarStock, guardando }: PropsVariantesSection) {
  const idInterruptor = useId()
  const idMotivo = useId()
  const activas = filasEnOrden(estado).filter((f) => !f.archivar)
  const conStock = archivosConStock(estado)
  const bloqueados = bloqueos(estado).map((b) => b.motivo)
  // A reserved row already says why on its own row: do not repeat it here.
  const faltan = validezDeVariantes(estado).motivos.filter((m) => !bloqueados.includes(m))

  return (
    <CollapsibleSection
      title="Variantes"
      icon={Layers}
      badge={estado.activo ? <Badge variant="secondary">{textoDeVariantes(activas.length)}</Badge> : undefined}
    >
      <div className="min-w-0 space-y-4">
        <div className="flex min-h-11 items-start gap-3">
          <div className="flex h-11 items-center">
            <Switch
              id={idInterruptor}
              checked={estado.activo}
              disabled={!!motivoDeshabilitado || guardando}
              aria-describedby={motivoDeshabilitado ? idMotivo : undefined}
              onCheckedChange={(activo) => dispatch({ tipo: activo ? "activar" : "desactivar" })}
            />
          </div>
          <div className="min-w-0 flex-1 pt-2.5">
            <Label htmlFor={idInterruptor} className="text-sm font-medium">
              Este producto tiene variantes
            </Label>
            {motivoDeshabilitado ? (
              <p id={idMotivo} className="mt-1 text-xs text-muted-foreground">
                {motivoDeshabilitado}
              </p>
            ) : (
              !estado.activo && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Armá variantes de un mismo producto (por ejemplo por color o talle), cada una con su precio y su stock.
                </p>
              )
            )}
          </div>
        </div>

        {estado.activo && (
          <>
            <Aviso estado={estado} />

            <OpcionesEditor estado={estado} dispatch={dispatch} deshabilitado={guardando} />

            {activas.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <dl className="flex items-baseline gap-2">
                  <dt className="text-sm text-muted-foreground">Stock total</dt>
                  <dd className="text-base font-semibold tabular-nums">{stockTotal(estado)}</dd>
                </dl>
                <AplicarPrecio estado={estado} dispatch={dispatch} deshabilitado={guardando} />
              </div>
            )}

            <CombinacionesTabla estado={estado} dispatch={dispatch} alAjustarStock={alAjustarStock} deshabilitado={guardando} />
            <CombinacionesCards estado={estado} dispatch={dispatch} alAjustarStock={alAjustarStock} deshabilitado={guardando} />

            {activas.length >= LIMITES.combinaciones && (
              <p className="text-xs text-muted-foreground">Llegaste al máximo de {LIMITES.combinaciones} variantes</p>
            )}

            {conStock.length > 0 && (
              <div role="status" aria-label="Variantes con stock que se archivan" className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                <p className="font-medium">Se van a archivar variantes con stock</p>
                <ul className="space-y-0.5">
                  {conStock.map((a) => (
                    <li key={a.filaId} className="flex flex-wrap gap-x-2">
                      <strong>{a.etiqueta}</strong>
                      <span className="tabular-nums">{unidades(a.stock)}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs">El stock se conserva. Si volvés a agregar la combinación, se restaura.</p>
              </div>
            )}

            {faltan.length > 0 && (
              <div className="space-y-1 text-sm">
                <p className="font-medium">Para guardar, falta:</p>
                <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                  {faltan.map((motivo) => (
                    <li key={motivo}>{motivo}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </CollapsibleSection>
  )
}
