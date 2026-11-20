/**
 * Sandbox de Creem vs. producción.
 *
 * Creem firma los webhooks de sandbox igual que los reales, y un checkout creado
 * con una key `creem_test_*` se paga con tarjeta de prueba. Si eso llega a
 * producción, una organización real queda con el plan activo sin haber pagado
 * (pasó: una suscripción de sandbox renovó un plan real durante meses).
 *
 * Los deploys de preview y el desarrollo local siguen aceptando sandbox: es
 * donde se prueba la integración.
 */

/** true solo en el deploy de producción (no en previews ni en local). */
export function isProductionDeployment(): boolean {
  const vercelEnv = process.env.VERCEL_ENV
  if (vercelEnv) return vercelEnv === "production"
  return process.env.NODE_ENV === "production"
}

/** La key configurada es de sandbox. */
export function isCreemTestKey(): boolean {
  return (process.env.CREEM_API_KEY || "").startsWith("creem_test_")
}

/** El evento del webhook viene del sandbox de Creem (`object.mode === "test"`). */
export function isCreemTestEvent(body: unknown): boolean {
  const mode = (body as { object?: { mode?: unknown } } | null)?.object?.mode
  return mode === "test"
}
