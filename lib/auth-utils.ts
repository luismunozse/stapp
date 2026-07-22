import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { validateUserTenant } from "@/lib/tenant"
import { supabaseAdmin } from "@/lib/supabase"

export async function getAuthSession() {
  const session = await auth()
  if (!session?.user) {
    return { session: null, organizationId: null, userId: null, role: null }
  }
  return {
    session,
    organizationId: session.user.organizationId,
    userId: session.user.id,
    role: session.user.role,
  }
}

export async function requireAuth() {
  const { session, organizationId, userId, role } = await getAuthSession()
  if (!session || !organizationId) {
    return {
      error: NextResponse.json({ error: "No autorizado" }, { status: 401 }),
      session: null,
      organizationId: null,
      userId: null,
      role: null,
    }
  }

  // Validar contexto de tenant si existe (subdominio)
  const headersList = await headers()
  const tenantSlug = headersList.get("x-tenant-slug")

  if (tenantSlug) {
    const isValidTenant = await validateUserTenant(organizationId, tenantSlug)
    if (!isValidTenant) {
      return {
        error: NextResponse.json(
          { error: "No tienes acceso a esta organización" },
          { status: 403 }
        ),
        session: null,
        organizationId: null,
        userId: null,
        role: null,
      }
    }
  }

  return { error: null, session, organizationId, userId, role }
}

export async function requireAdmin() {
  const result = await requireAuth()
  if (result.error) return result

  if (result.role !== "ADMIN") {
    return {
      error: NextResponse.json({ error: "Acceso denegado" }, { status: 403 }),
      session: null,
      organizationId: null,
      userId: null,
      role: null,
    }
  }
  return result
}

// ADMIN OR el propio técnico accediendo a sus datos
export async function requireAdminOrSelf(targetUserId: string) {
  const result = await requireAuth()
  if (result.error) return result

  if (result.role !== "ADMIN" && result.userId !== targetUserId) {
    return {
      error: NextResponse.json({ error: "Acceso denegado" }, { status: 403 }),
      session: null,
      organizationId: null,
      userId: null,
      role: null,
    }
  }
  return result
}

// VENDEDOR puede: crear clientes, crear órdenes, ver inventario
// No puede: modificar inventario, acceder a configuración, gestionar usuarios
export async function requireAdminOrVendedor() {
  const result = await requireAuth()
  if (result.error) return result

  if (result.role !== "ADMIN" && result.role !== "VENDEDOR") {
    return {
      error: NextResponse.json({ error: "Acceso denegado" }, { status: 403 }),
      session: null,
      organizationId: null,
      userId: null,
      role: null,
    }
  }
  return result
}

// Regla pura de acceso a administración de inventario.
// ADMIN siempre; VENDEDOR solo si la org habilitó el permiso (opt-in,
// default apagado); TECNICO y cualquier otro rol, nunca.
export function hasInventarioAccess(
  role: string | null,
  vendedoresHabilitados: boolean
): boolean {
  if (role === "ADMIN") return true
  if (role === "VENDEDOR") return vendedoresHabilitados
  return false
}

// Guard de endpoints de inventario. Mismo contrato que requireAdmin() para
// swap 1:1. Fail-closed: si la columna no existe o la lectura falla,
// el VENDEDOR queda denegado (idéntico al comportamiento histórico).
export async function requireInventarioAccess() {
  const result = await requireAuth()
  if (result.error) return result

  if (result.role === "ADMIN") return result

  let vendedoresHabilitados = false
  if (result.role === "VENDEDOR") {
    try {
      const { data } = await supabaseAdmin
        .from("organizations")
        .select("vendedores_administran_inventario")
        .eq("id", result.organizationId!)
        .single()
      vendedoresHabilitados = data?.vendedores_administran_inventario === true
    } catch {
      vendedoresHabilitados = false
    }
  }

  if (!hasInventarioAccess(result.role, vendedoresHabilitados)) {
    return {
      error: NextResponse.json({ error: "Acceso denegado" }, { status: 403 }),
      session: null,
      organizationId: null,
      userId: null,
      role: null,
    }
  }
  return result
}

// Verifica si el usuario puede crear órdenes y clientes (ADMIN, VENDEDOR)
export function canCreateOrders(role: string | null): boolean {
  return role === "ADMIN" || role === "VENDEDOR"
}

// Verifica si el usuario actual puede importar datos
export async function canImportData(): Promise<boolean> {
  const { session } = await getAuthSession()
  return !!session?.user?.email
}

// Verifica si el usuario actual puede editar configuración (ADMIN)
export async function canEditConfiguration(): Promise<boolean> {
  const { session, role } = await getAuthSession()
  return !!session?.user?.email && role === "ADMIN"
}
