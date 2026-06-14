import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"

export const SUCURSAL_COOKIE = "stapp-sucursal-activa"
const TODAS = "todas"

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
    // TECNICO/VENDEDOR: su sucursal fija, ignora cookie.
    return { sucursalId: input.userSucursalId, verTodas: false }
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
