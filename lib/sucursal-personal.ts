import { supabaseAdmin } from "@/lib/supabase"
import { SUCURSAL_NINGUNA, assertSucursalEnOrg, sucursalParaEscritura, sucursalParaLectura } from "@/lib/sucursal"
import { soloAtendidasPor, sucursalQueAtiende } from "@/lib/sucursal-ordenes"
import { ESTADOS_ACTIVOS } from "@/lib/order-states"

/**
 * The branch a technician / seller list is scoped to, or null for every branch.
 *
 * A branch-scoped user (TECNICO, VENDEDOR) always gets their own branch, or the
 * fail-closed sentinel when they have none: the requested branch is ignored. An ADMIN
 * may ask for any branch of their organization; a request for anything else (unknown,
 * another org, malformed) is ignored, not an error, and the switcher's choice applies.
 * The requested id only ever reaches a query as a bound value, never inside a filter
 * string.
 *
 * `alcance: "escritura"` is for the screen that CREATES something these people get
 * assigned to. With no valid branch requested, an ADMIN is scoped to the branch the
 * write will land in (`sucursalParaEscritura`: the selected branch, or the principal on
 * Todas) instead of every branch, so what the screen offers is what the server validates.
 * Nothing changes for anyone else.
 */
export async function sucursalParaListaPersonal(params: {
  role: string | null
  userSucursalId: string | null
  organizationId: string
  sucursalSolicitada: string | null
  alcance?: "lectura" | "escritura"
}): Promise<string | null> {
  const lectura = await sucursalParaLectura({
    role: params.role,
    userSucursalId: params.userSucursalId,
  })
  const pedida = params.sucursalSolicitada
  if (params.role === "ADMIN" && pedida && (await assertSucursalEnOrg(pedida, params.organizationId))) {
    return pedida
  }
  if (params.role === "ADMIN" && params.alcance === "escritura") {
    // No write branch (no principal, two principals, a failed lookup): POST rejects everyone, so
    // the list offers nobody instead of every branch.
    return (
      (await sucursalParaEscritura({
        role: params.role,
        organizationId: params.organizationId,
        userSucursalId: params.userSucursalId,
      })) ?? SUCURSAL_NINGUNA
    )
  }
  return lectura.sucursalId
}

/**
 * How many open orders each technician holds in EVERY branch (a map from his id; zero when he holds none).
 * Deactivating or deleting a technician is a global action, so what warns about it counts everything he
 * holds, not only the part in the scope the ADMIN is looking at. A read that fails throws: a count that
 * could not be read is not zero.
 */
export async function ordenesActivasTotales(organizationId: string, tecnicoIds: string[]): Promise<Map<string, number>> {
  const totales = new Map<string, number>()
  if (tecnicoIds.length === 0) return totales
  const { data, error } = await supabaseAdmin
    .from("ordenes_servicio")
    .select("tecnico_id")
    .eq("organization_id", organizationId)
    .in("tecnico_id", tecnicoIds)
    .in("estado", ESTADOS_ACTIVOS as unknown as string[])
  if (error) throw error
  for (const fila of (data ?? []) as Array<{ tecnico_id: string }>) totales.set(fila.tecnico_id, (totales.get(fila.tecnico_id) ?? 0) + 1)
  return totales
}

/** What the destination picker of a bulk move needs to know about the orders that would move. */
export interface DestinoDeReasignacion {
  /** The branch whose technicians can take every one of those orders; null = every branch. */
  sucursalId: string | null
  /** How many open orders the move touches in the scope it applies: what it will actually move. */
  ordenes: number
  /** They are handled by more than one branch: nobody can take them all, so the move needs a branch picked first. */
  variasSucursales: boolean
}

/**
 * The branch whose technicians can take EVERY open order of `origenId` that an ADMIN's bulk move
 * would touch: the picker of the destination. A technician can be assigned only an order handled by
 * his own branch (BM-5), so the orders to move decide the list, not the origin technician's branch:
 *  - all of them handled by one branch: that branch;
 *  - handled by several: nobody (the move is refused unless the destination is an ADMIN), and the
 *    answer says so, so the screen can ask for a branch instead of showing an empty list;
 *  - none open: the scope the request already had.
 * `sucursalDelAlcance` is that scope (the ADMIN's selected branch, or null for all of them), the
 * same one the bulk move applies. It also counts the orders in that scope, so what the screen says it
 * will move is what moves.
 *
 * A read that fails throws: an unreadable set of orders is not "no orders", and a list judged against
 * nothing would offer technicians the move then refuses.
 */
export async function sucursalParaReasignar(params: {
  organizationId: string
  origenId: string
  sucursalDelAlcance: string | null
}): Promise<DestinoDeReasignacion> {
  const { data, error } = await soloAtendidasPor(
    supabaseAdmin
      .from("ordenes_servicio")
      .select("sucursal_id")
      .eq("organization_id", params.organizationId)
      .eq("tecnico_id", params.origenId)
      .in("estado", ESTADOS_ACTIVOS as unknown as string[]),
    params.sucursalDelAlcance,
  )
  if (error) throw error
  const filas = (data ?? []) as Array<{ sucursal_id: string }>
  const ramas = new Set(filas.map((o) => sucursalQueAtiende(o)).filter(Boolean))
  if (ramas.size === 0) return { sucursalId: params.sucursalDelAlcance, ordenes: 0, variasSucursales: false }
  if (ramas.size === 1) return { sucursalId: [...ramas][0], ordenes: filas.length, variasSucursales: false }
  return { sucursalId: SUCURSAL_NINGUNA, ordenes: filas.length, variasSucursales: true }
}
