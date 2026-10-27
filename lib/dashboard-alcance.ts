// The scope of a dashboard load (change sucursales-aislamiento, OI-1: a cached aggregate is never
// served to a viewer with a different branch scope).
//
// The dashboard aggregates are cached for two minutes with `unstable_cache`, which keys on the
// arguments of the cached function. The scope therefore travels as an argument, as a string: the
// branch id, or `todas`. The cached function turns it back into a branch with `sucursalDeClave`
// and nothing else about the viewer, so two viewers with the same key may share an entry and two
// with different keys never do.

import { esIdSeguro } from "@/lib/sucursal-ordenes"
import { SUCURSAL_NINGUNA, type ResultadoLectura } from "@/lib/sucursal"

/** The key of "every branch of the organization" (an ADMIN on Todas). */
export const CLAVE_TODAS = "todas"

/**
 * The cache key of a read scope (what `sucursalParaLectura` resolved). An id that cannot be spliced
 * into a PostgREST filter, or a scope that is neither a branch nor "every branch", gets the sentinel
 * branch, which matches no row.
 */
export function claveDeAlcance(lectura: ResultadoLectura): string {
  if (lectura.verTodas && lectura.sucursalId === null) return CLAVE_TODAS
  return esIdSeguro(lectura.sucursalId) ? lectura.sucursalId : SUCURSAL_NINGUNA
}

/** The branch of a cache key: `null` for every branch. A key nobody made with `claveDeAlcance` matches no row. */
export function sucursalDeClave(clave: string): string | null {
  if (clave === CLAVE_TODAS) return null
  return esIdSeguro(clave) ? clave : SUCURSAL_NINGUNA
}
