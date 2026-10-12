/**
 * True cuando el error de un `.rpc()` significa "esa función no existe todavía"
 * (migración sin aplicar), y no "la función corrió y se quejó".
 *
 * Distinguirlas importa: un error de negocio del plpgsql (`RAISE EXCEPTION`) se
 * mapea a 400/404, mientras que una función ausente es lo único que habilita
 * caer a un camino JS de compatibilidad. Vivía dentro de
 * `app/api/cotizaciones/[id]/aprobar/route.ts`; se compartió cuando la ruta
 * pública de aprobación pasó a usar el mismo RPC atómico, porque dos copias del
 * criterio son dos criterios.
 */
export function isFunctionMissingError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as Record<string, unknown>
  const code = String(e.code ?? "")
  const msg = String(e.message ?? "").toLowerCase()
  return (
    code === "PGRST202" ||
    code === "42883" ||
    msg.includes("could not find the function") ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  )
}
