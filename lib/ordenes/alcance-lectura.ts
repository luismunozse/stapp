import { SUCURSAL_NINGUNA, sucursalParaLectura } from "@/lib/sucursal"

/**
 * Read scope over service orders (`ordenes_servicio`) and everything derived
 * from them (number, code, device, status, amounts, customer of that order,
 * photos, PDFs).
 *
 *  - ADMIN: every branch. In LISTS the branch switcher narrows it; for a record
 *    opened BY ID the switcher is ignored (see `resolverAlcanceOrdenesPorId`).
 *  - VENDEDOR: only orders of their CURRENT branch. No exception for orders they
 *    received or created before being moved.
 *  - TECNICO: orders of their CURRENT branch plus orders assigned to them in any
 *    branch, so a moved technician can finish their work.
 *
 * Callers resolve the branch with `sucursalParaLectura` (see
 * `resolverAlcanceOrdenesDeSesion`); this module only turns that into a filter
 * and a per-row check, so the role rule lives in one place.
 */
export type AlcanceOrdenes =
  | { tipo: "todas" }
  | { tipo: "sucursal"; sucursalId: string }
  | { tipo: "sucursal_o_asignadas"; sucursalId: string; userId: string }

export interface OrdenAlcanzable {
  sucursal_id?: string | null
  tecnico_id?: string | null
}

// Ids are cuid TEXT (or UUID): letters, digits, "_" and "-" only. Anything with a
// comma, dot or parenthesis could break out of a PostgREST filter string.
const ID_SEGURO_RE = /^[A-Za-z0-9_-]{1,64}$/

function esIdSeguro(valor: unknown): valor is string {
  return typeof valor === "string" && ID_SEGURO_RE.test(valor)
}

export function resolverAlcanceOrdenes(params: {
  role: string | null | undefined
  /** `ResultadoLectura.sucursalId` from `sucursalParaLectura`. */
  sucursalId: string | null
  /** `ResultadoLectura.verTodas` from `sucursalParaLectura`. */
  verTodas: boolean
  userId: string | null | undefined
}): AlcanceOrdenes {
  const { role, verTodas } = params

  // Only an ADMIN can ever be unfiltered. A non-admin with verTodas set is an
  // inconsistent input, not a wider scope.
  if (role === "ADMIN" && verTodas) return { tipo: "todas" }

  // The id is spliced into a PostgREST `.or()` string: anything that is not a safe
  // id fails closed to the sentinel that matches no row.
  const sucursalId = esIdSeguro(params.sucursalId) ? params.sucursalId : SUCURSAL_NINGUNA

  if (role === "TECNICO" && esIdSeguro(params.userId)) {
    return { tipo: "sucursal_o_asignadas", sucursalId, userId: params.userId }
  }
  return { tipo: "sucursal", sucursalId }
}

/** Resolves the scope for the current request (cookie switcher included). */
export async function resolverAlcanceOrdenesDeSesion(params: {
  role: string | null
  userId: string | null | undefined
  userSucursalId: string | null | undefined
}): Promise<AlcanceOrdenes> {
  const filtro = await sucursalParaLectura({
    role: params.role,
    userSucursalId: params.userSucursalId ?? null,
  })
  return resolverAlcanceOrdenes({
    role: params.role,
    sucursalId: filtro.sucursalId,
    verTodas: filtro.verTodas,
    userId: params.userId,
  })
}

/**
 * Scope for BY-ID lookups (a record opened from a link). The branch switcher is a
 * filter for LISTS only: an ADMIN reaches a record of any branch whatever branch the
 * screen has selected, exactly like `ordenes/[id]`, so a link never breaks for them.
 * VENDEDOR and TECNICO get the same scope as in lists.
 */
export async function resolverAlcanceOrdenesPorId(params: {
  role: string | null
  userId: string | null | undefined
  userSucursalId: string | null | undefined
}): Promise<AlcanceOrdenes> {
  if (params.role === "ADMIN") return { tipo: "todas" }
  return resolverAlcanceOrdenesDeSesion(params)
}

/**
 * Branch to filter branch-stamped LINES (e.g. `cuenta_corriente.sucursal_id`)
 * for a non-ADMIN caller; null for ADMIN, whose view is left as it was. Lines
 * carry no technician, so the technician exception of orders does not apply.
 * Fail-closed: a non-admin without a branch gets the sentinel that matches nothing.
 */
export async function sucursalDeLineasNoAdmin(params: {
  role: string | null
  userSucursalId: string | null | undefined
}): Promise<string | null> {
  if (params.role === "ADMIN") return null
  const filtro = await sucursalParaLectura({
    role: params.role,
    userSucursalId: params.userSucursalId ?? null,
  })
  return filtro.sucursalId ?? SUCURSAL_NINGUNA
}

/**
 * Narrows branch-stamped lines to `sucursalId` (from `sucursalDeLineasNoAdmin`).
 * `sucursal_id` is nullable and some historical lines were never attributed to a
 * branch, so those stay visible alongside the caller's own. The no-branch
 * sentinel keeps matching nothing at all.
 */
export function aplicarSucursalLineas<Q extends { eq: (c: string, v: string) => any; or: (f: string) => any }>(
  query: Q,
  sucursalId: string | null
): Q {
  if (!sucursalId) return query
  if (sucursalId === SUCURSAL_NINGUNA || !esIdSeguro(sucursalId)) {
    return query.eq("sucursal_id", SUCURSAL_NINGUNA)
  }
  return query.or(`sucursal_id.eq.${sucursalId},sucursal_id.is.null`)
}

/** Checks a single loaded order row against the scope. */
export function ordenEnAlcance(
  alcance: AlcanceOrdenes,
  orden: OrdenAlcanzable | null | undefined
): boolean {
  if (!orden) return false
  if (alcance.tipo === "todas") return true
  if (orden.sucursal_id === alcance.sucursalId) return true
  return alcance.tipo === "sucursal_o_asignadas" && orden.tecnico_id === alcance.userId
}

/**
 * A quote is visible when the order it is linked to is. `cotizaciones` has no
 * branch column of its own, so a quote with no order is not order data and
 * stays visible as before. The caller's select must embed the order with its
 * `sucursal_id` and `tecnico_id`.
 */
export function cotizacionEnAlcance(
  alcance: AlcanceOrdenes,
  cotizacion: { orden_id?: string | null; ordenes_servicio?: OrdenAlcanzable | null }
): boolean {
  if (alcance.tipo === "todas") return true
  if (!cotizacion.orden_id) return true
  return ordenEnAlcance(alcance, cotizacion.ordenes_servicio)
}

interface QueryFiltrable {
  eq: (columna: string, valor: string) => any
  or: (filtros: string, opciones?: { referencedTable: string }) => any
}

/**
 * Narrows a query to the scope. Without `referencedTable` the columns are those
 * of the queried table (`ordenes_servicio`); with it they belong to an embedded
 * order, which the select must declare with `!inner` for parents to drop out.
 */
export function aplicarAlcanceOrdenes<Q extends QueryFiltrable>(
  query: Q,
  alcance: AlcanceOrdenes,
  opciones: { referencedTable?: string } = {}
): Q {
  if (alcance.tipo === "todas") return query
  const tabla = opciones.referencedTable
  if (alcance.tipo === "sucursal") {
    return query.eq(tabla ? `${tabla}.sucursal_id` : "sucursal_id", alcance.sucursalId)
  }
  return query.or(
    `sucursal_id.eq.${alcance.sucursalId},tecnico_id.eq.${alcance.userId}`,
    tabla ? { referencedTable: tabla } : undefined
  )
}
