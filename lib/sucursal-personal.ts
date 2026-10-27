import { assertSucursalEnOrg, sucursalParaLectura } from "@/lib/sucursal"

/**
 * The branch a technician / seller list is scoped to, or null for every branch.
 *
 * A branch-scoped user (TECNICO, VENDEDOR) always gets their own branch, or the
 * fail-closed sentinel when they have none: the requested branch is ignored. An ADMIN
 * may ask for any branch of their organization; a request for anything else (unknown,
 * another org, malformed) is ignored, not an error, and the switcher's choice applies.
 * The requested id only ever reaches a query as a bound value, never inside a filter
 * string.
 */
export async function sucursalParaListaPersonal(params: {
  role: string | null
  userSucursalId: string | null
  organizationId: string
  sucursalSolicitada: string | null
}): Promise<string | null> {
  const lectura = await sucursalParaLectura({
    role: params.role,
    userSucursalId: params.userSucursalId,
  })
  const pedida = params.sucursalSolicitada
  if (params.role === "ADMIN" && pedida && (await assertSucursalEnOrg(pedida, params.organizationId))) {
    return pedida
  }
  return lectura.sucursalId
}
