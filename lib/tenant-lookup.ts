/**
 * Cómo lee el login la respuesta de GET /api/public/tenant.
 *
 * Solo un 200 con `tenant: null` dice que el negocio no existe. Cualquier otra
 * cosa (fetch cortado, 429, 500, cuerpo raro) es "no sabemos": el login sigue
 * sin el logo en vez de mandar a "Negocio no encontrado" a un taller que existe.
 */
export type TenantLookupOutcome = "found" | "not_found" | "unknown"

export function tenantLookupOutcome(ok: boolean, body: unknown): TenantLookupOutcome {
  if (!ok || !body || typeof body !== "object" || !("tenant" in body)) return "unknown"
  return (body as { tenant: unknown }).tenant ? "found" : "not_found"
}
