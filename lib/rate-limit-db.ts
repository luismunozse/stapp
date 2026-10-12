import { supabaseAdmin } from "@/lib/supabase"

/**
 * Rate limit compartido entre instancias serverless (contador en Postgres).
 *
 * `lib/rate-limit.ts` vive en memoria: cada instancia de Vercel tiene su propio
 * Map, asi que un atacante repartido entre instancias nunca llega al tope. Este
 * helper delega en la RPC `rate_limit_hit` (migracion 336), que incrementa el
 * bucket de forma atomica.
 *
 * Devuelve true = permitido. FALLA ABIERTO: si la DB no responde (o la RPC aun
 * no esta aplicada) se deja pasar y se loguea. Un hipo de la base no debe
 * bloquear compradores reales; la proteccion es best-effort.
 */
export async function rateLimitDb(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin.rpc("rate_limit_hit", {
      p_key: key,
      p_max: max,
      p_window_seconds: windowSeconds,
    })
    if (error) {
      console.error("[rate-limit-db] RPC fallo, se deja pasar:", error.message)
      return true
    }
    return typeof data === "boolean" ? data : true
  } catch (err) {
    console.error("[rate-limit-db] error inesperado, se deja pasar:", err)
    return true
  }
}
