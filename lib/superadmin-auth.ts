import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"
import { headers } from "next/headers"

/**
 * Verifica si un email está en la lista de SUPERADMIN_EMAILS
 */
export function isSuperadminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const superadminEmails =
    process.env.SUPERADMIN_EMAILS?.split(",").map((e) => e.trim().toLowerCase()) || []
  return superadminEmails.includes(email.toLowerCase())
}

/**
 * Middleware para APIs de superadmin
 * Valida que la request venga del panel superadmin y que el email sea válido
 */
export async function requireSuperadmin() {
  const headersList = await headers()
  const isSuperadminPanel = headersList.get("x-superadmin-panel") === "true"
  const superadminEmail = headersList.get("x-superadmin-email")
  const userId = headersList.get("x-user-id")

  if (!isSuperadminPanel || !superadminEmail) {
    return {
      error: NextResponse.json({ error: "Acceso denegado" }, { status: 403 }),
      email: null,
      userId: null,
    }
  }

  // Doble verificación del email
  if (!isSuperadminEmail(superadminEmail)) {
    return {
      error: NextResponse.json({ error: "No autorizado como superadmin" }, { status: 403 }),
      email: null,
      userId: null,
    }
  }

  return {
    error: null,
    email: superadminEmail,
    userId,
  }
}

/**
 * Para usar en Server Components del panel superadmin
 * Valida la sesión y que el email sea de superadmin
 */
export async function getSuperadminSession() {
  const session = await auth()
  if (!session?.user?.email) {
    return null
  }

  if (!isSuperadminEmail(session.user.email)) {
    return null
  }

  return session
}

/**
 * Verifica si el usuario actual es superadmin (para uso en cliente)
 */
export async function checkIsSuperadmin(): Promise<boolean> {
  const session = await auth()
  return isSuperadminEmail(session?.user?.email)
}
