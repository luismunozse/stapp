"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { etiquetaDeFila, filasEnOrden, type Fila } from "@/lib/variantes-filas"
import type { PropsCombinaciones } from "./combinaciones-tabla"
import { useEfectosDeDeshacer } from "./use-efectos-de-deshacer"
import { BloqueDeArchivo, CamposAvanzados, CampoCodigo, CampoCosto, CampoPrecio, CampoStock } from "./campos-fila"

/*
 * One combination as a card, for phones (`sm:hidden`; the table takes over from `sm`). Fields are 44px
 * tall, two to a row, with tabular digits. Row ids are the keys, so editing a row never moves the focus.
 */

interface PropsCard extends PropsCombinaciones {
  fila: Fila
}

const ROTULO = "grid gap-1 text-xs font-medium text-muted-foreground"

export function CombinacionCard({ estado, fila, dispatch, alAjustarStock, deshabilitado, efectos }: PropsCard) {
  const [abierta, setAbierta] = useState(false)
  const etiqueta = etiquetaDeFila(estado, fila)
  const comunes = { estado, fila, etiqueta, dispatch, deshabilitado }

  if (fila.archivar) {
    return (
      <article className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 sm:hidden dark:border-amber-900 dark:bg-amber-950/20">
        <h3 className="text-sm font-semibold text-muted-foreground line-through">{etiqueta}</h3>
        <BloqueDeArchivo {...comunes} efecto={efectos?.get(fila.id)} />
      </article>
    )
  }

  return (
    <article className="space-y-3 rounded-lg border bg-card p-3 sm:hidden">
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {etiqueta}
          {estado.promocionId === fila.id && (
            <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Es este producto</span>
          )}
        </h3>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <div className={`${ROTULO} col-span-2`}>
          Código
          <CampoCodigo {...comunes} />
        </div>
        <div className={ROTULO}>
          Precio
          <CampoPrecio {...comunes} />
        </div>
        {estado.costoCargado && (
          <div className={ROTULO}>
            Costo
            <CampoCosto {...comunes} />
          </div>
        )}
        <div className={ROTULO}>
          Stock
          <CampoStock {...comunes} alAjustarStock={alAjustarStock} />
        </div>
      </div>

      <button
        type="button"
        aria-label={`Más datos de ${etiqueta}`}
        aria-expanded={abierta}
        disabled={deshabilitado}
        onClick={() => setAbierta((a) => !a)}
        className="flex min-h-11 w-full items-center justify-between rounded-md px-1 text-sm font-medium text-muted-foreground active:scale-[0.97] disabled:opacity-50 motion-reduce:transform-none"
      >
        Más datos
        <ChevronDown className={`h-4 w-4 ${abierta ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {abierta && <CamposAvanzados {...comunes} />}
    </article>
  )
}

export function CombinacionesCards({ estado, dispatch, alAjustarStock, deshabilitado, efectos }: PropsCombinaciones) {
  const propios = useEfectosDeDeshacer(estado, efectos === undefined)
  const filas = filasEnOrden(estado)
  const activas = filas.filter((f) => !f.archivar)
  const porArchivar = filas.filter((f) => f.archivar)
  if (filas.length === 0) return null

  const comunes = { estado, dispatch, alAjustarStock, deshabilitado, efectos: efectos ?? propios }
  return (
    <div className="space-y-3 sm:hidden">
      {activas.map((fila) => (
        <CombinacionCard key={fila.id} fila={fila} {...comunes} />
      ))}
      {porArchivar.length > 0 && (
        <div role="group" aria-label="Se archivarán al guardar" className="space-y-2">
          <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">Se archivarán al guardar ({porArchivar.length})</p>
          {porArchivar.map((fila) => (
            <CombinacionCard key={fila.id} fila={fila} {...comunes} />
          ))}
        </div>
      )}
    </div>
  )
}
