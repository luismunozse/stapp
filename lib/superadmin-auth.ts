import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { createHmac } from "crypto"

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
 * Genera un HMAC de los headers de superadmin para verificar integridad.
 * Se genera en el middleware y se valida en requireSuperadmin().
 */
export function generateSuperadminHmac(email: string, userId: string): string {
  const secret = process.env.NEXTAUTH_SECRET || "fallback-secret"
  return createHmac("sha256", secret)
    .update(`superadmin:${email}:${userId}`)
    .digest("hex")
}

/**
 * Verifica si la IP está en la whitelist de superadmin (si está configurada).
 * Si SUPERADMIN_IP_WHITELIST no está definida, permite todo.
 */
export function isIpWhitelisted(ip: string | null): boolean {
  const whitelist = process.env.SUPERADMIN_IP_WHITELIST
  if (!whitelist) return true // Sin whitelist = todo permitido
  const allowedIps = whitelist.split(",").map((i) => i.trim())
  return allowedIps.includes(ip || "")
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
  const hmac = headersList.get("x-superadmin-hmac")

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

  // Verificar integridad de headers con HMAC
  if (userId && hmac) {
    const expectedHmac = generateSuperadminHmac(superadminEmail, userId)
    if (hmac !== expectedHmac) {
      return {
        error: NextResponse.json({ error: "Integridad de headers inválida" }, { status: 403 }),
        email: null,
        userId: null,
      }
    }
  }

  // Verificar IP whitelist
  const clientIp = headersList.get("x-forwarded-for")?.split(",")[0]?.trim() || null
  if (!isIpWhitelisted(clientIp)) {
    return {
      error: NextResponse.json({ error: "IP no autorizada" }, { status: 403 }),
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
