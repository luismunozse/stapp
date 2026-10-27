import { SUCURSAL_NINGUNA, sucursalParaLectura } from "@/lib/sucursal"

/**
 * Read scope over service orders (`ordenes_servicio`) and everything derived
 * from them (number, code, device, status, amounts, customer of that order,
 * photos, PDFs).
 *
 *  - ADMIN: every branch, narrowed by the branch switcher when one is selected.
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
