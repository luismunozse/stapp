import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"

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

// Verifica si el usuario puede gestionar inventario (solo ADMIN)
export function canManageInventory(role: string | null): boolean {
  return role === "ADMIN"
}

// Verifica si el usuario puede crear órdenes y clientes (ADMIN, VENDEDOR)
export function canCreateOrders(role: string | null): boolean {
  return role === "ADMIN" || role === "VENDEDOR"
}
