// Branch rules for service orders: which branch HANDLES an order, the PostgREST
// filters that scope a list to a branch, and who may be assigned to an order.
//
// Pure on purpose (no I/O): the list, the detail and the assignment checks agree
// on one definition.
//
// Until the derivation migration is applied there is no `derivada_a_sucursal_id`
// column, so the handling branch is the origin `sucursal_id` and NO filter here may
// mention the new column (an unknown column is a 42703 on the hot list query).

import { SUCURSAL_NINGUNA } from "@/lib/sucursal-constantes"

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

/** How the actor relates to an order. */
export type RolEnOrden = "ADMIN" | "ORIGEN" | "DESTINO" | "ASIGNADO" | "AJENO"

/** Who is asking. `sucursalId` is the FRESH branch that `requireAuth()` returns, never the JWT copy. */
export interface ActorOrden {
  userId: string
  role: string
  sucursalId: string | null
  /** The org opt-in `tecnicos_toman_ordenes`. Only read for a TECNICO; missing means off. */
  tomaSinAsignar?: boolean
}

/** The facts about an order that the policy needs. */
export interface OrdenParaPolitica {
  /** Where the order was created (the origin). null = unknown: only an ADMIN or the assignee reaches it. */
  sucursalId: string | null
  tecnicoId: string | null
  /** The branch an active derivation sends it to; null or missing when there is none. */
  derivadaA?: string | null
}

export interface PermisosOrden {
  /** The order is in the actor's scope. false means the caller answers "not found" (XC-2). */
  ver: boolean
  rol: RolEnOrden
  /** May open the order. A TECNICO opens only his own, or an unassigned one he can claim. */
  leer: boolean
  /** May change the order (PUT). A TECNICO changes only his own. */
  editar: boolean
  /** Repair work (repair statuses, repuestos, services, checklist, photos): the branch that works the order. */
  reparar: boolean
  /** Client-facing side (client-facing statuses, payments, invoices, messages): the origin. */
  comercial: boolean
  /** ENTREGADO*: the origin, and never while an active derivation exists (OD-7). */
  entregar: boolean
  /** Send the order to another branch: ADMIN or origin staff who may edit it, once at a time (OD-1, OD-8). */
  derivar: boolean
  /** Take it back: ADMIN or destination staff who may edit it (OD-6). */
  devolver: boolean
  /** Claim an unassigned order handled by his branch (OI-3). */
  tomar: boolean
}

/**
 * Who may do what with an order. Pure: the route (`cargarOrdenEnAlcance`) feeds it the order row.
 *
 * Scope (`ver`): an ADMIN, a user of the origin branch, a user of the destination branch while an
 * active derivation sends the order there, and a TECNICO the order is assigned to, whatever his
 * branch (BM-6). Anyone else, including a user with no branch, is out of scope (XC-4). The
 * assignment counts only for a TECNICO: changing a technician into a seller does not clear his
 * assignments, and a seller who still holds one gets his branch's orders and no more.
 *
 * Inside the scope the branch decides the work (`reparar`, `comercial`, `entregar`) and the role
 * narrows the person: a TECNICO opens and edits only his own orders, or opens one he can claim.
 * `reparar`, `comercial` and `entregar` are branch-level: they do not narrow a technician to his
 * own orders, and a route that narrows technicians does it itself (the detail through `leer` and
 * `editar`, the delivery with its own check). That keeps an org with one branch unchanged (XC-3):
 * while an order is not derived, everybody in scope has the branch permissions the routes always
 * gave them, so wiring a route to this policy narrows by branch and changes nothing else.
 *
 * Derived (the approved split, OD-3, OD-4): the origin keeps the client-facing side, the
 * destination does the repair work, and nobody delivers (OD-7) or derives it again (OD-8). An
 * ADMIN is unrestricted except for those two. Once an order has ever been derived, only the origin
 * or an ADMIN delivers it (a destination technician who kept the assignment after the return does
 * not). A derived order always has `everDerived` true.
 */
export function politicaOrden(
  actor: ActorOrden,
  orden: OrdenParaPolitica,
  everDerived: boolean,
): PermisosOrden {
  const derivada = orden.derivadaA ?? null
  const estaDerivada = derivada !== null
  const handling = derivada ?? orden.sucursalId
  const sucursal = actor.sucursalId

  const esAdmin = actor.role === "ADMIN"
  const esTecnico = actor.role === "TECNICO"
  // Branch membership grants access only to the known branch roles: an unknown or
  // missing role gets nothing (fail-closed).
  const esDeSucursal = esTecnico || actor.role === "VENDEDOR"
  const esAsignado = esTecnico && orden.tecnicoId !== null && orden.tecnicoId === actor.userId
  const esOrigen = esDeSucursal && sucursal !== null && sucursal === orden.sucursalId
  const esDestino = esDeSucursal && sucursal !== null && sucursal === derivada

  const rol: RolEnOrden = esAdmin
    ? "ADMIN"
    : esDestino
      ? "DESTINO"
      : esOrigen
        ? "ORIGEN"
        : esAsignado
          ? "ASIGNADO"
          : "AJENO"

  const ver = esAdmin || esOrigen || esDestino || esAsignado
  const tomar =
    esTecnico &&
    ver &&
    orden.tecnicoId === null &&
    actor.tomaSinAsignar === true &&
    sucursal !== null &&
    sucursal === handling

  const leer = esTecnico ? esAsignado || tomar : ver
  const editar = esTecnico ? esAsignado : ver

  const reparar = estaDerivada ? esAdmin || esDestino || (esAsignado && !esOrigen) : ver
  const comercial = estaDerivada ? esAdmin || esOrigen : ver
  const entregar = !estaDerivada && ver && (!everDerived || esAdmin || esOrigen)
  const derivar = editar && !estaDerivada && (esAdmin || esOrigen)
  const devolver = editar && estaDerivada && (esAdmin || esDestino)

  return { ver, rol, leer, editar, reparar, comercial, entregar, derivar, devolver, tomar }
}
