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
 * The branch whose technicians can take EVERY open order of `origenId` that an ADMIN's bulk move
 * would touch: the picker of the destination. A technician can be assigned only an order handled by
 * his own branch (BM-5), so the orders to move decide the list, not the origin technician's branch:
 *  - all of them handled by one branch: that branch;
 *  - handled by several: nobody (the move is refused unless the destination is an ADMIN);
 *  - none open: the scope the request already had.
 * `sucursalDelAlcance` is that scope (the ADMIN's selected branch, or null for all of them), the
 * same one the bulk move applies.
 */
export async function sucursalParaReasignar(params: {
  organizationId: string
  origenId: string
  sucursalDelAlcance: string | null
}): Promise<string | null> {
  const { data } = await soloAtendidasPor(
    supabaseAdmin
      .from("ordenes_servicio")
      .select("sucursal_id")
      .eq("organization_id", params.organizationId)
      .eq("tecnico_id", params.origenId)
      .in("estado", ESTADOS_ACTIVOS as unknown as string[]),
    params.sucursalDelAlcance,
  )
  const ramas = new Set((data ?? []).map((o: { sucursal_id: string }) => sucursalQueAtiende(o)).filter(Boolean))
  if (ramas.size === 0) return params.sucursalDelAlcance
  if (ramas.size === 1) return [...ramas][0]
  return SUCURSAL_NINGUNA
}
