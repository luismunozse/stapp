// The door for LISTS of orders (change sucursales-aislamiento: OI-1, SC-3, SC-6, BM-6, OI-3, XC-4).
//
// One place decides which orders an actor reads, so the list, the export and the other read
// surfaces cannot disagree about the rows of a scope. The detail of ONE order goes through
// `cargarOrdenEnAlcance` (lib/ordenes/alcance.ts); this is its counterpart for queries.
//
// Server-only: it reads the org opt-in and the switcher cookie.

import { resolveTecnicosTomanOrdenes } from "@/lib/auth-utils"
import { sucursalParaLectura } from "@/lib/sucursal"
import { combinarOr, filtroListaTecnico, filtroVisibleEnSucursal } from "@/lib/sucursal-ordenes"

export interface ActorLectura {
  organizationId: string
  userId: string
  role: string
  /** The FRESH branch `requireAuth()` returned, never the JWT copy. */
  sucursalId: string | null
}

export interface AlcanceLectura {
  /** A TECNICO who may claim the unassigned orders of his branch: the list marks them. */
  puedeTomarSinAsignar: boolean
  /**
   * Narrows a filterable query on `ordenes_servicio` to the orders this actor reads. `otrosOr` are
   * the caller's own OR lists (search, "no budget"): they are ANDed with the scope inside ONE
   * expression, so a search can never widen it. Apply it before `.order()` / `.range()`.
   */
  aplicar<Q>(query: Q, otrosOr?: string[]): Q
}

interface Filtrable<Q> {
  eq(columna: string, valor: string): Q
  or(filtro: string): Q
}

/**
 * - ADMIN: the whole organization on Todas, one branch when the switcher selects it (= what that
 *   branch's staff reads).
 * - TECNICO: what is assigned to him, from any branch (BM-6); with the org opt-in also the
 *   unassigned orders his branch handles (OI-3). Without a branch only what is assigned (XC-4). The
 *   switcher does not apply to him.
 * - Anyone else: the orders his branch may open; without a branch, none.
 */
export async function alcanceLecturaOrdenes(actor: ActorLectura): Promise<AlcanceLectura> {
  if (actor.role === "TECNICO") {
    const toma = await resolveTecnicosTomanOrdenes(actor.organizationId)
    const filtro = filtroListaTecnico(actor.userId, actor.sucursalId, toma)
    return {
      puedeTomarSinAsignar: filtro !== null,
      aplicar: <Q>(query: Q, otrosOr: string[] = []) => {
        const base = filtro ? query : (query as unknown as Filtrable<Q>).eq("tecnico_id", actor.userId)
        return unir(base, [filtro ?? "", ...otrosOr])
      },
    }
  }

  const lectura = await sucursalParaLectura({ role: actor.role, userSucursalId: actor.sucursalId })
  const filtro = lectura.verTodas ? "" : filtroVisibleEnSucursal(lectura.sucursalId)
  return {
    puedeTomarSinAsignar: false,
    aplicar: <Q>(query: Q, otrosOr: string[] = []) => unir(query, [filtro, ...otrosOr]),
  }
}

/** The OR lists as one expression on one `.or()`, or the query as it came when there are none. */
function unir<Q>(query: Q, listas: string[]): Q {
  const unida = combinarOr(...listas)
  return unida === "" ? query : (query as unknown as Filtrable<Q>).or(unida)
}
