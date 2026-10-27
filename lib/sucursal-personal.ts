import { SUCURSAL_NINGUNA, assertSucursalEnOrg, sucursalParaEscritura, sucursalParaLectura } from "@/lib/sucursal"

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
