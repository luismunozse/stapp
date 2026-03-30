/**
 * Rate limiting con sliding window en memoria.
 * Para entornos serverless (Vercel), cada instancia tiene su propio Map,
 * lo que significa que el rate limiting es "best effort" pero suficiente
 * para proteger contra abuso obvio.
 */

export interface RateLimitResult {
  success: boolean
  limit: number
  remaining: number
  reset: number // timestamp en ms
}

interface RateLimitEntry {
  count: number
  resetAt: number
}

// Store en memoria con LRU eviction
const store = new Map<string, RateLimitEntry>()
const MAX_STORE_SIZE = 10000

// Limpieza periódica para evitar memory leaks
function cleanup() {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key)
    }
  }
  // LRU eviction si excede el tamaño máximo
  if (store.size > MAX_STORE_SIZE) {
    const entries = Array.from(store.entries())
    entries.sort((a, b) => a[1].resetAt - b[1].resetAt)
    const toDelete = entries.slice(0, entries.length - MAX_STORE_SIZE)
    for (const [key] of toDelete) {
      store.delete(key)
    }
  }
}

// Cleanup cada 60 segundos
let cleanupInterval: ReturnType<typeof setInterval> | null = null
if (typeof setInterval !== "undefined" && !cleanupInterval) {
  cleanupInterval = setInterval(cleanup, 60000)
  // No bloquear el proceso
  if (cleanupInterval && typeof cleanupInterval === "object" && "unref" in cleanupInterval) {
    cleanupInterval.unref()
  }
}

/**
 * Verificar rate limit para un identificador dado.
 * @param identifier - Clave única (ej: "ip:1.2.3.4" o "org:uuid")
 * @param limit - Máximo de requests permitidos en la ventana
 * @param windowMs - Tamaño de la ventana en milisegundos
 */
export async function rateLimit(
  identifier: string,
  limit: number = 60,
  windowMs: number = 60000
): Promise<RateLimitResult> {
  const now = Date.now()
  const entry = store.get(identifier)

  // Si no existe o la ventana expiró, crear nueva
  if (!entry || entry.resetAt <= now) {
    const resetAt = now + windowMs
    store.set(identifier, { count: 1, resetAt })
    return {
      success: true,
      limit,
      remaining: limit - 1,
      reset: resetAt,
    }
  }

  // Incrementar contador
  entry.count++
  store.set(identifier, entry)

  const remaining = Math.max(0, limit - entry.count)
  const success = entry.count <= limit

  return {
    success,
    limit,
    remaining,
    reset: entry.resetAt,
  }
}

// Configuración de límites por tipo de ruta
export interface RateLimitConfig {
  max: number
  windowMs: number
}

export function getApiRateLimit(pathname: string): RateLimitConfig {
  // Webhooks exentos
  if (
    pathname.startsWith("/api/mercadopago/webhook") ||
    pathname.startsWith("/api/rebill/webhook") ||
    pathname.startsWith("/api/inngest") ||
    pathname.startsWith("/api/cron") ||
    pathname.startsWith("/api/whatsapp/webhook")
  ) {
    return { max: 1000, windowMs: 60000 }
  }

  // Auth endpoints: más restrictivos
  if (
    pathname.startsWith("/api/auth/login") ||
    pathname.startsWith("/api/auth/register") ||
    pathname.startsWith("/api/auth/forgot-password")
  ) {
    return { max: 10, windowMs: 60000 }
  }

  // APIs públicas
  if (pathname.startsWith("/api/public")) {
    return { max: 30, windowMs: 60000 }
  }

  // APIs autenticadas por defecto
  return { max: 120, windowMs: 60000 }
}

/**
 * Verifica si una ruta está exenta de rate limiting.
 */
export function isExemptFromRateLimit(pathname: string): boolean {
  const exemptPaths = [
    "/api/mercadopago/webhook",
    "/api/rebill/webhook",
    "/api/inngest",
    "/api/cron",
    "/api/auth/session",
    "/api/auth/csrf",
    "/api/auth/providers",
  ]
  return exemptPaths.some((path) => pathname.startsWith(path))
}
