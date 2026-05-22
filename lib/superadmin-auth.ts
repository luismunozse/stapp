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
 * Verifica si la IP está en la whitelist de superadmin.
 *
 * Fail-closed en producción: si SUPERADMIN_IP_WHITELIST no está definida y
 * NODE_ENV=production, RECHAZA todo. Antes el default era permitir todo, lo
 * que dejaba al panel sin restricción de red si alguien olvidaba setear la
 * env var en prod.
 *
 * En entornos no-prod (dev, preview, test), si no hay whitelist se permite
 * todo para no romper el flujo de desarrollo local.
 *
 * Si la whitelist se setea explícitamente a "*", se permite todo en
 * cualquier entorno (escape hatch para deploys que no pueden fijar IPs,
 * como Vercel preview con IPs dinámicas).
 */
export function isIpWhitelisted(ip: string | null): boolean {
  const whitelist = process.env.SUPERADMIN_IP_WHITELIST
  if (!whitelist) {
    return process.env.NODE_ENV !== "production"
  }
  const trimmed = whitelist.trim()
  if (trimmed === "*") return true
  const allowedIps = trimmed.split(",").map((i) => i.trim()).filter(Boolean)
  return allowedIps.includes(ip || "")
}

/**
 * Middleware para APIs de superadmin.
 * Valida que la request venga del panel superadmin y que el email sea válido.
 *
 * Seguridad: los headers x-superadmin-* los setea exclusivamente el middleware
 * de Next.js después de validar JWT + email. No se pueden inyectar externamente
 * porque el middleware corre antes que cualquier API route y los sobreescribe.
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
