// Estado de la suscripción de una organización, seguro para el proxy (Edge).
// Mismo patrón que user-status-edge: fetch directo al REST de Supabase con el
// service role key y caché en memoria de 30 s.
//
// Solo mira el status guardado. Los casos derivados (período vencido, trial
// vencido) los escriben hasValidAccess y el cron subscription-sweep: el proxy
// no repite esas reglas.

export type SuscripcionLookup = { kind: "ok"; bloqueada: boolean } | { kind: "error" }

const store = new Map<string, { bloqueada: boolean; expiresAt: number }>()
const TTL_MS = 30_000
const MAX_ENTRIES = 5000

/** Status que cortan el uso del sistema (el layout del panel redirige a /suscripcion-requerida). */
const STATUS_BLOQUEADOS = new Set(["CANCELED", "PAST_DUE"])

export function clearSuscripcionCache(): void {
  store.clear()
}

export async function getSuscripcionBloqueada(organizationId: string): Promise<SuscripcionLookup> {
  const now = Date.now()
  const hit = store.get(organizationId)
  if (hit) {
    if (hit.expiresAt > now) return { kind: "ok", bloqueada: hit.bloqueada }
    store.delete(organizationId)
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) return { kind: "error" }

  const url = `${base}/rest/v1/subscriptions?organization_id=eq.${encodeURIComponent(organizationId)}&select=status&limit=1`
  try {
    const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
    if (!res.ok) return { kind: "error" }
    const rows = (await res.json()) as Array<{ status: string | null }>
    // Sin fila no se bloquea: una org recién registrada puede no tenerla todavía.
    const bloqueada = STATUS_BLOQUEADOS.has(rows[0]?.status ?? "")
    if (store.size >= MAX_ENTRIES) store.clear()
    store.set(organizationId, { bloqueada, expiresAt: now + TTL_MS })
    return { kind: "ok", bloqueada }
  } catch {
    return { kind: "error" }
  }
}

/**
 * Escrituras que una org bloqueada tiene que poder hacer: pagar o reactivar,
 * loguearse, pedir soporte, gestionar su cuenta y sus avisos.
 */
const ESCRITURAS_PERMITIDAS = [
  "/api/auth",
  "/api/mercadopago",
  "/api/subscription",
  "/api/subscriptions",
  "/api/creem",
  "/api/rebill",
  "/api/reactivar-trial",
  "/api/soporte",
  "/api/account",
  "/api/user",
  "/api/users/profile",
  "/api/user-notifications",
  "/api/push",
  "/api/push-token",
  "/api/nps",
  "/api/sucursales/set-activa",
]

export function escrituraPermitidaSinSuscripcion(pathname: string): boolean {
  return ESCRITURAS_PERMITIDAS.some((p) => pathname === p || pathname.startsWith(p + "/"))
}
