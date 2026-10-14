"use client"

import { useState, type Dispatch } from "react"
import { ChevronDown } from "lucide-react"
import { etiquetaDeFila, filasEnOrden, type Fila, type VariantesAccion, type VariantesState } from "@/lib/variantes-filas"
import { useEfectosDeDeshacer } from "./use-efectos-de-deshacer"
import type { EfectoDeDeshacer } from "./vista"
import { BloqueDeArchivo, CamposAvanzados, CampoCodigo, CampoCosto, CampoPrecio, CampoStock } from "./campos-fila"

/*
 * The combinations as a table, from the `sm` breakpoint up (the phone gets `combinacion-card.tsx`; both
 * are in the DOM and the classes decide which one is seen). It scrolls inside its own box if the form is
 * narrow, never the page. Rows pending archive sit apart, under their own heading.
 */

export interface PropsCombinaciones {
  estado: VariantesState
  dispatch: Dispatch<VariantesAccion>
  /** A saved row's stock was adjusted: the form should reload the group to see the new number. */
  alAjustarStock?: () => void
  deshabilitado?: boolean
  /** The undo preview of every pending row, if the caller already has it; else the table computes it. */
  efectos?: ReadonlyMap<string, EfectoDeDeshacer>
}

interface PropsFila extends PropsCombinaciones {
  fila: Fila
  columnas: number
}

function FilaActiva({ estado, fila, dispatch, alAjustarStock, deshabilitado, columnas }: PropsFila) {
  const [abierta, setAbierta] = useState(false)
  const etiqueta = etiquetaDeFila(estado, fila)
  const comunes = { estado, fila, etiqueta, dispatch, deshabilitado, compacto: true }
  return (
    <>
      <tr className="border-t align-middle">
        <th scope="row" className="px-3 py-2 text-left text-sm font-medium">
          <span>{etiqueta}</span>
          {estado.promocionId === fila.id && (
            <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Es este producto</span>
          )}
        </th>
        <td className="min-w-[9rem] px-2 py-2">
          <CampoCodigo {...comunes} />
        </td>
        <td className="min-w-[7rem] px-2 py-2">
          <CampoPrecio {...comunes} />
        </td>
        {estado.costoCargado && (
          <td className="min-w-[7rem] px-2 py-2">
            <CampoCosto {...comunes} />
          </td>
        )}
        <td className="min-w-[6rem] px-2 py-2">
          <CampoStock {...comunes} alAjustarStock={alAjustarStock} />
        </td>
        <td className="px-2 py-2 text-right">
          <button
            type="button"
            aria-label={`Más datos de ${etiqueta}`}
            aria-expanded={abierta}
            disabled={deshabilitado}
            onClick={() => setAbierta((a) => !a)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <ChevronDown className={`h-4 w-4 ${abierta ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
        </td>
      </tr>
      {abierta && (
        <tr className="bg-muted/30">
          <td colSpan={columnas} className="px-3 py-3">
            <CamposAvanzados {...comunes} />
          </td>
        </tr>
      )}
    </>
  )
}

function FilaPorArchivar({ estado, fila, dispatch, deshabilitado, columnas, efectos }: PropsFila) {
  const etiqueta = etiquetaDeFila(estado, fila)
  return (
    <tr className="border-t align-middle">
      <th scope="row" className="px-3 py-2 text-left text-sm font-medium text-muted-foreground line-through">
        {etiqueta}
      </th>
      <td colSpan={columnas - 1} className="px-2 py-2">
        <BloqueDeArchivo estado={estado} fila={fila} etiqueta={etiqueta} dispatch={dispatch} deshabilitado={deshabilitado} compacto efecto={efectos?.get(fila.id)} />
      </td>
    </tr>
  )
}

export function CombinacionesTabla({ estado, dispatch, alAjustarStock, deshabilitado, efectos }: PropsCombinaciones) {
  const propios = useEfectosDeDeshacer(estado, efectos === undefined)
  const filas = filasEnOrden(estado)
  const activas = filas.filter((f) => !f.archivar)
  const porArchivar = filas.filter((f) => f.archivar)
  if (filas.length === 0) return null

  const columnas = estado.costoCargado ? 6 : 5
  const comunes = { estado, dispatch, alAjustarStock, deshabilitado, columnas, efectos: efectos ?? propios }
  return (
    <div className="hidden overflow-x-auto rounded-lg border sm:block">
      <table className="w-full min-w-[40rem] text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">Variante</th>
            <th scope="col" className="px-2 py-2 text-left font-medium">Código</th>
            <th scope="col" className="px-2 py-2 text-left font-medium">Precio</th>
            {estado.costoCargado && (
              <th scope="col" className="px-2 py-2 text-left font-medium">Costo</th>
            )}
            <th scope="col" className="px-2 py-2 text-left font-medium">Stock</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Más</th>
          </tr>
        </thead>
        <tbody>
          {activas.map((fila) => (
            <FilaActiva key={fila.id} fila={fila} {...comunes} />
          ))}
        </tbody>
        {porArchivar.length > 0 && (
          <tbody role="group" aria-label="Se archivarán al guardar" className="bg-amber-50/60 dark:bg-amber-950/20">
            <tr>
              <th colSpan={columnas} scope="colgroup" className="px-3 pb-1 pt-3 text-left text-xs font-semibold text-amber-900 dark:text-amber-200">
                Se archivarán al guardar ({porArchivar.length})
              </th>
            </tr>
            {porArchivar.map((fila) => (
              <FilaPorArchivar key={fila.id} fila={fila} {...comunes} />
            ))}
          </tbody>
        )}
      </table>
    </div>
  )
}
