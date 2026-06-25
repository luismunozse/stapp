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
 * La whitelist es defensa en profundidad opcional. El acceso al panel ya
 * está protegido por:
 *   1. SUPERADMIN_EMAILS (allowlist por email)
 *   2. Auth NextAuth + sesión
 *   3. 2FA (si está activado)
 *
 * Si SUPERADMIN_IP_WHITELIST no está definida, permite todo (admin móvil OK).
 * Si está definida explícitamente a "*", permite todo (escape hatch claro).
 * Si tiene IPs, exige match estricto.
 *
 * En producción sin whitelist se loguea un WARN para visibilidad — antes
 * el fail-open era completamente silencioso.
 */
let warnedMissingWhitelist = false
export function isIpWhitelisted(ip: string | null): boolean {
  const whitelist = process.env.SUPERADMIN_IP_WHITELIST
  if (!whitelist) {
    if (process.env.NODE_ENV === "production" && !warnedMissingWhitelist) {
      console.warn(
        "[superadmin-auth] SUPERADMIN_IP_WHITELIST no configurada. " +
          "Acceso protegido solo por email allowlist + 2FA. " +
          "Para restringir por IP, setear la env var con IPs separadas por coma o '*' para deshabilitar."
      )
      warnedMissingWhitelist = true
    }
    return true
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
 * Seguridad: el middleware de Next.js BORRA los headers x-superadmin-* / x-user-id
 * entrantes al inicio (antes de cualquier branch) y solo los vuelve a setear en el
 * path del subdominio admin tras validar JWT + email. Por eso un cliente no puede
 * inyectarlos desde afuera ni siquiera en rutas que no los reescriben.
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

  // Verificar IP whitelist.
  // x-vercel-forwarded-for lo setea el CDN de Vercel y no es spoofable por el
  // cliente. El PRIMER valor de x-forwarded-for SÍ es inyectable, asi que como
  // fallback usamos el ULTIMO valor de la cadena (el que agrega el proxy mas
  // cercano), nunca el primero.
  const xff = headersList.get("x-forwarded-for")
  const clientIp =
    headersList.get("x-vercel-forwarded-for")?.trim() ||
    (xff ? xff.split(",").map((s) => s.trim()).filter(Boolean).pop() ?? null : null)
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
