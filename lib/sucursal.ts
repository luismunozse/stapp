import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"

export const SUCURSAL_COOKIE = "stapp-sucursal-activa"
const TODAS = "todas"

/**
 * Sentinel UUID used when a non-admin user has no assigned branch.
 * Applying .eq("sucursal_id", SUCURSAL_NINGUNA) matches zero real rows,
 * so the query returns empty rather than leaking all branches (fail-closed).
 */
export const SUCURSAL_NINGUNA = "00000000-0000-0000-0000-000000000000"

export interface ResultadoLectura {
  sucursalId: string | null // null => sin filtro de sucursal (ver todas)
  verTodas: boolean
}

interface InputResolucion {
  role: string | null
  userSucursalId: string | null
  cookieSucursalId: string | null
}

/** Resuelve el filtro de sucursal para LECTURAS. */
export function resolveSucursalLectura(input: InputResolucion): ResultadoLectura {
  const esAdmin = input.role === "ADMIN"

  if (!esAdmin) {
    // TECNICO/VENDEDOR must always be branch-scoped. If their sucursal_id is null
    // (invalid state, e.g. role changed from ADMIN without assigning a branch),
    // return the sentinel so the .eq filter matches zero rows instead of leaking
    // all branches (fail-closed rather than fail-open).
    return { sucursalId: input.userSucursalId ?? SUCURSAL_NINGUNA, verTodas: false }
  }

  // ADMIN: cookie manda. Sin cookie o 'todas' => ver todas.
  if (!input.cookieSucursalId || input.cookieSucursalId === TODAS) {
    return { sucursalId: null, verTodas: true }
  }
  return { sucursalId: input.cookieSucursalId, verTodas: false }
}

/** Resuelve la sucursal CONCRETA para ESCRITURAS (siempre devuelve un id). */
export function resolveSucursalEscritura(
  input: InputResolucion & { principalId: string }
): string {
  const esAdmin = input.role === "ADMIN"

  if (!esAdmin) {
    return input.userSucursalId ?? input.principalId
  }
  if (!input.cookieSucursalId || input.cookieSucursalId === TODAS) {
    return input.principalId
  }
  return input.cookieSucursalId
}

/** Lee el id de la sucursal principal (Casa Central) de una org. */
export async function getPrincipalId(organizationId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("sucursales")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("principal", true)
    .is("deleted_at", null)
    .single()
  return data?.id ?? null
}

/** Valida que una sucursal pertenezca a la org y esté activa. Previene cross-org. */
export async function assertSucursalEnOrg(
  sucursalId: string,
  organizationId: string
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("sucursales")
    .select("id")
    .eq("id", sucursalId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .single()
  return !!data
}

/** Lee la cookie de sucursal activa (server-side). */
export async function getCookieSucursalId(): Promise<string | null> {
  const store = await cookies()
  return store.get(SUCURSAL_COOKIE)?.value ?? null
}

/** Resuelve la sucursal concreta para una ESCRITURA en el request actual. */
export async function sucursalParaEscritura(params: {
  role: string | null
  organizationId: string
  userSucursalId: string | null
}): Promise<string | null> {
  const cookieSucursalId = await getCookieSucursalId()
  const principalId = await getPrincipalId(params.organizationId)
  if (!principalId) return null
  return resolveSucursalEscritura({
    role: params.role,
    userSucursalId: params.userSucursalId,
    cookieSucursalId,
    principalId,
  })
}

/** Resuelve el filtro de sucursal para una LECTURA en el request actual. */
export async function sucursalParaLectura(params: {
  role: string | null
  userSucursalId: string | null
}): Promise<ResultadoLectura> {
  const cookieSucursalId = await getCookieSucursalId()
  return resolveSucursalLectura({
    role: params.role,
    userSucursalId: params.userSucursalId,
    cookieSucursalId,
  })
}

/**
 * Returns the principal deposito id for a sucursal, or null if none exists.
 * Used by sales routes to resolve the strict deposit for stock deduction.
 */
export async function getDepositoDeSucursal(
  organizationId: string,
  sucursalId: string
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("depositos")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("sucursal_id", sucursalId)
    .eq("principal", true)
    .is("deleted_at", null)
    .maybeSingle()
  return data?.id ?? null
}

export interface DestinoVenta {
  /** Concrete sucursal a POS sale will be attributed to, null if the org has no principal sucursal. */
  sucursalId: string | null
  /** Concrete deposito a POS sale will draw stock from, null if the sucursal has no principal deposito (drain-mode fallback). */
  depositoId: string | null
}

/**
 * Resolves the concrete sucursal + deposito a POS sale will draw stock from
 * for the current request — the exact same resolution as the ventas write
 * path (`sucursalParaEscritura` + `getDepositoDeSucursal`). Exposed as a
 * single helper so the ventas write route and the POS read endpoints
 * (search/barcode/check-stock, via their opt-in `scope=venta` query param)
 * can never drift apart on which sucursal/deposito a sale actually uses.
 */
export async function resolverDestinoVenta(params: {
  role: string | null
  organizationId: string
  userSucursalId: string | null
}): Promise<DestinoVenta> {
  const sucursalId = await sucursalParaEscritura(params)
  if (!sucursalId) {
    return { sucursalId: null, depositoId: null }
  }

  const depositoId = await getDepositoDeSucursal(params.organizationId, sucursalId)
  if (!depositoId) {
    console.warn(
      `[ventas] Sucursal ${sucursalId} has no principal deposito — falling back to drain mode`
    )
  }

  return { sucursalId, depositoId }
}

/**
 * Reads the display name of a sucursal. Used to name the sucursal in the
 * POS "selling from" indicator and in stock-insufficient error messages,
 * without duplicating the sucursal/deposito resolution logic itself.
 */
export async function getNombreSucursal(
  organizationId: string,
  sucursalId: string
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("sucursales")
    .select("nombre")
    .eq("id", sucursalId)
    .eq("organization_id", organizationId)
    .single()
  return data?.nombre ?? null
}
