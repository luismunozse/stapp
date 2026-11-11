// Límites de intentos de login (panel superadmin y talleres), compartidos entre instancias.
// Seguro para el middleware: fetch directo al RPC `check_superadmin_rate_limit`
// (migración 086) con el service role, sin supabase-js. Si la base no responde
// cae al límite en memoria de la instancia: nunca deja de limitar del todo.

import { rateLimit, type RateLimitResult } from "@/lib/rate-limit"

export function checkSuperadminLoginLimit(
  ip: string,
  maxAttempts: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  return checkLoginLimit(ip, "superadmin:login", maxAttempts, windowSeconds)
}

// Login de los talleres. El bloqueo por cuenta (locked_until) frena probar
// muchas contraseñas contra un usuario; este frena probar una contraseña
// contra muchos usuarios desde la misma IP. Contador aparte del superadmin.
export function checkTenantLoginLimit(
  ip: string,
  maxAttempts: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  return checkLoginLimit(ip, "tenant:login", maxAttempts, windowSeconds)
}

async function checkLoginLimit(
  ip: string,
  endpoint: string,
  maxAttempts: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const identifier = `ip:${ip}`
  const fallback = () => rateLimit(`${identifier}:${endpoint}`, maxAttempts, windowSeconds * 1000)

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) return fallback()

  try {
    const res = await fetch(`${base}/rest/v1/rpc/check_superadmin_rate_limit`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_identifier: identifier,
        p_endpoint: endpoint,
        p_max_requests: maxAttempts,
        p_window_seconds: windowSeconds,
      }),
      signal: AbortSignal.timeout(2000),
    })
    if (!res.ok) return fallback()
    const data = (await res.json()) as { allowed?: unknown; count?: unknown; reset?: unknown }
    if (typeof data?.allowed !== "boolean") return fallback()
    const count = typeof data.count === "number" ? data.count : 0
    const reset = typeof data.reset === "number" ? data.reset * 1000 : Date.now() + windowSeconds * 1000
    return { success: data.allowed, limit: maxAttempts, remaining: Math.max(0, maxAttempts - count), reset }
  } catch {
    return fallback()
  }
}
