import { useMemo } from "react"
import type { VariantesState } from "@/lib/variantes-filas"
import { efectosDeDeshacer, type EfectoDeDeshacer } from "./vista"

/**
 * Everything the undo preview of a row can depend on, as text: the options and their values, the order, each
 * row's combination and archive state, the children archived in the database and the id counter. Codes, prices,
 * stock and photos are NOT in it, so typing into a row does not make the previews be computed again.
 */
export function firmaEstructural(estado: VariantesState): string {
  return JSON.stringify([
    estado.opciones.map((o) => [o.id, o.nombre, o.valores.map((v) => [v.id, v.texto])]),
    estado.orden,
    estado.orden.map((id) => {
      const f = estado.filas[id]
      return f ? [f.id, f.valorIds, f.archivar, f.existente, f.restaurada ?? false, f.previos ?? null] : id
    }),
    estado.archivadas,
    estado.semilla,
    estado.contador,
  ])
}

const NINGUNO: ReadonlyMap<string, EfectoDeDeshacer> = new Map()

/**
 * The undo preview of every row pending archive, computed when the structure changes and not on every render.
 * `activo` false skips the work (a caller that was handed the previews already).
 */
export function useEfectosDeDeshacer(estado: VariantesState, activo = true): ReadonlyMap<string, EfectoDeDeshacer> {
  const firma = firmaEstructural(estado)
  // `firma` stands for every field of `estado` the previews read; the rest of the state changes on each key.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (activo ? efectosDeDeshacer(estado) : NINGUNO), [firma, activo])
}
