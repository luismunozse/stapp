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
 * The open orders a technician holds in EVERY branch, embedded in the select that reads him, to be COUNTED
 * (only their ids come out). Deactivating or deleting a technician is a global action, so what warns about it
 * counts everything he holds, not only the part in the scope the ADMIN is looking at. It is the second embed
 * of the orders next to the one that narrows to the scope (`ordenes_del_alcance`): each is filtered by its own
 * alias, and neither alias is the table's own name, which both embeds would answer to. It is an embed, and not a
 * read with a row per open order, because a read of rows is cut at PostgREST's max-rows (1000) without an error,
 * and a technician whose orders come after the cut would show none; what an embed carries is not cut.
 * Narrow the query with `soloActivasEnTodasLasSucursales`, and count with `totalDeOrdenesActivas`.
 */
export const EMBED_ORDENES_ACTIVAS_TOTALES = "activas_totales:ordenes_servicio!tecnico_id (id)"

/** The alias of `EMBED_ORDENES_ACTIVAS_TOTALES`: how a filter names it. */
export const ALIAS_ACTIVAS_TOTALES = "activas_totales"

type ConEq<Q> = { eq(columna: string, valor: string): Q }
type ConIn<Q> = { in(columna: string, valores: string[]): Q }

/**
 * Narrows the embed `EMBED_ORDENES_ACTIVAS_TOTALES` of a query to the open orders of the organization, of any
 * branch. It takes any PostgREST filter builder and answers the same builder (see `soloAtendidasPor`).
 */
export function soloActivasEnTodasLasSucursales<Q>(query: Q, organizationId: string): Q {
  const deLaOrganizacion = (query as unknown as ConEq<Q>).eq(`${ALIAS_ACTIVAS_TOTALES}.organization_id`, organizationId)
  return (deLaOrganizacion as unknown as ConIn<Q>).in(`${ALIAS_ACTIVAS_TOTALES}.estado`, ESTADOS_ACTIVOS as unknown as string[])
}

/**
 * How many open orders, in every branch, a technician row that embedded `EMBED_ORDENES_ACTIVAS_TOTALES` holds.
 * A row that does not carry the embed throws: a total that was never read is not zero, and a screen would
 * offer to delete a technician who holds work.
 */
export function totalDeOrdenesActivas(tecnico: { activas_totales?: unknown }): number {
  const ordenes = tecnico.activas_totales
  if (!Array.isArray(ordenes)) throw new Error(`the row does not carry the embed ${ALIAS_ACTIVAS_TOTALES}: its total was not read`)
  return ordenes.length
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
