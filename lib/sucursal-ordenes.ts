// Branch rules for service orders: which branch HANDLES an order, the PostgREST
// filters that scope a list to a branch, and who may be assigned to an order.
//
// Pure on purpose (no I/O): the list, the detail and the assignment checks agree
// on one definition.
//
// Until the derivation migration is applied there is no `derivada_a_sucursal_id`
// column, so the handling branch is the origin `sucursal_id` and NO filter here may
// mention the new column (an unknown column is a 42703 on the hot list query).

import { SUCURSAL_NINGUNA } from "@/lib/sucursal"

const ID_SEGURO = /^[A-Za-z0-9_-]+$/

export const MENSAJE_TECNICO_OTRA_SUCURSAL = "Ese técnico no pertenece a la sucursal de esta orden"

/** True when the id can be spliced into a PostgREST filter string without leaving its syntax. */
export function esIdSeguro(id: unknown): id is string {
  return typeof id === "string" && ID_SEGURO.test(id)
}

/** A branch id for a filter string; anything that cannot be spliced matches no row. */
function sucursalParaFiltro(sucursalId: string | null | undefined): string {
  return esIdSeguro(sucursalId) ? sucursalId : SUCURSAL_NINGUNA
}

/** The branch that works the order. Today that is where it was created. */
export function sucursalQueAtiende(orden: {
  sucursal_id: string
  derivada_a_sucursal_id?: string | null
}): string {
  return orden.sucursal_id
}

/** Orders a branch may open. Same as `filtroAtiendeSucursal` until derivations exist. */
export function filtroVisibleEnSucursal(sucursalId: string | null | undefined): string {
  return `sucursal_id.eq.${sucursalParaFiltro(sucursalId)}`
}

/** Orders a branch currently works on. Same as `filtroVisibleEnSucursal` until derivations exist. */
export function filtroAtiendeSucursal(sucursalId: string | null | undefined): string {
  return `sucursal_id.eq.${sucursalParaFiltro(sucursalId)}`
}

/** A comma-separated OR list as ONE operand of a PostgREST and(...) / or(...). */
function comoOperando(lista: string): string {
  return lista.includes(",") ? `or(${lista})` : lista
}

/**
 * The orders list of a TECNICO as a PostgREST `or` list: assigned to him (any
 * branch, BM-6) or unassigned AND handled by his branch (the opt-in
 * `tecnicos_toman_ordenes`, OI-3).
 *
 * Returns null when the list is just "assigned to him": permission off, no branch
 * (XC-4: a branchless technician never gets the unassigned orders), or a user id
 * that cannot be spliced. The caller then applies `.eq("tecnico_id", userId)`.
 */
export function filtroListaTecnico(
  userId: string,
  sucursalId: string | null,
  tomaSinAsignar: boolean,
): string | null {
  if (!esIdSeguro(userId)) return null
  if (!tomaSinAsignar || sucursalId === null) return null
  const libres = `and(tecnico_id.is.null,${comoOperando(filtroAtiendeSucursal(sucursalId))})`
  return `tecnico_id.eq.${userId},${libres}`
}

/**
 * May this user be assigned to an order handled by `atiende`? An ADMIN always (they
 * belong to no branch); a technician of the handling branch; and an assignment that
 * is already there, so a legacy cross-branch technician survives an edit of any
 * other field (BM-5).
 */
export function tecnicoAsignable(
  tecnico: { id: string; rol: string; sucursal_id: string | null },
  atiende: string | null,
  tecnicoPrevioId: string | null,
): boolean {
  if (tecnicoPrevioId !== null && tecnico.id === tecnicoPrevioId) return true
  if (tecnico.rol === "ADMIN") return true
  return !!atiende && tecnico.sucursal_id === atiende
}

/**
 * The technician a form should show and send, out of the one it holds (from a draft, or from the
 * appointment the order comes from) and the ones its picker offers. One the picker does not offer
 * (another branch) would be a blank select that still posts him, so it counts as nobody. A list
 * that loaded and is EMPTY is still a list (nobody is offered, and the hidden picker leaves no way
 * to clear a held choice). Only with no list to judge against (`cargada` false: not loaded, or it
 * failed) is the choice left as it is.
 */
export function tecnicoOfrecido(
  elegidoId: string,
  ofrecidos: ReadonlyArray<{ id: string }>,
  cargada: boolean,
): string {
  if (!cargada) return elegidoId
  return ofrecidos.some((t) => t.id === elegidoId) ? elegidoId : ""
}

/**
 * Joins comma-separated OR lists into ONE expression meaning "every list matches
 * at least one of its conditions". Pass the result to a single `.or()`: repeated
 * `.or()` calls would rely on PostgREST ANDing the repeated `or` params (open item 7).
 */
export function combinarOr(...listas: string[]): string {
  const presentes = listas.filter((lista) => lista !== "")
  if (presentes.length <= 1) return presentes[0] ?? ""
  return `and(${presentes.map(comoOperando).join(",")})`
}

/**
 * A free-text term safe to splice into an `ilike` condition inside a combined
 * expression. The characters that can end a condition or a group are replaced by
 * `_`, the one-character wildcard, so a hostile term cannot add a clause beside the
 * branch filter that wraps it.
 */
export function terminoDeBusquedaSeguro(termino: string): string {
  return termino.replace(/[,()"\\]/g, "_")
}
