import { supabaseAdmin } from "@/lib/supabase"

/**
 * Devuelve la reserva de stock que tomó una solicitud del catálogo público.
 *
 * Se llama en todos los finales sin venta de una cotización del catálogo:
 * rechazo (interno y desde el link público) y borrado. El vencimiento va por
 * cron aparte (`/api/cron/catalogo-reservas-vencidas`).
 *
 * La RPC es idempotente y no-op sobre cotizaciones de otro origen, así que es
 * seguro llamarla sin filtrar antes.
 *
 * No propaga el error: la cotización ya cambió de estado cuando esto corre, y
 * hacer fallar el request dejaría al usuario sin poder rechazar ni borrar. Se
 * loguea para que quede rastro — a diferencia del `try/catch` alrededor de un
 * `supabaseAdmin.rpc()`, que nunca dispara porque la RPC devuelve `{ error }`
 * en vez de tirar, y termina descartando el fallo en silencio.
 */
export async function liberarReservaCatalogo(
  cotizacionId: string,
  motivo: string
): Promise<void> {
  try {
    const res = await supabaseAdmin.rpc("liberar_reserva_catalogo", {
      p_cotizacion_id: cotizacionId,
      p_motivo: motivo,
    })
    if (res?.error) {
      console.error("[catalogo] liberar_reserva_catalogo falló:", res.error)
    }
  } catch (err) {
    console.error("[catalogo] liberar_reserva_catalogo lanzó:", err)
  }
}
