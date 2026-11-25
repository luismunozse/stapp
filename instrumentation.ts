export async function register() {
  // instrumentation hook
}

/**
 * Red de seguridad global: Next llama a este hook por CADA error no controlado
 * del servidor (rutas de API sin try/catch, páginas, server actions, render).
 * Lo que una ruta atrapa por su cuenta lo registra con `reportarError`
 * (lib/api-error.ts); esto cubre todo lo demás.
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routerKind?: string; routePath?: string; routeType?: string; renderSource?: string }
) {
  // El registro usa node:crypto y el cliente admin de Supabase: solo en Node.
  // Con esta forma (import dentro del `if`) el bundle de Edge no lo incluye.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { registrarError } = await import("@/lib/error-log")
      const header = (name: string) => {
        const v = request.headers?.[name]
        return Array.isArray(v) ? v[0] ?? null : v ?? null
      }
      const path = (request.path || "").split("?")[0]
      await registrarError({
        source: path.startsWith("/api/cron")
          ? "CRON"
          : path.includes("/webhook")
            ? "WEBHOOK"
            : context?.routeType === "route"
              ? "API"
              : "SERVER",
        error,
        route: context?.routePath || path,
        method: request.method,
        status: 500,
        tenantSlug: header("x-tenant-slug"),
        userAgent: header("user-agent"),
        context: { routeType: context?.routeType, renderSource: context?.renderSource, path },
      })
    } catch (e) {
      console.error("[instrumentation] no se pudo registrar el error:", e)
    }
  }
}
