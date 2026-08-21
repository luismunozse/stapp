import type { SupabaseClient } from "@supabase/supabase-js"
import type { EstadoOrden } from "@/types"
import { esTransicionValida, getMensajeTransicionInvalida } from "@/lib/orden-state-machine"

export type ResultadoTransicion =
  | { ok: true; estado: EstadoOrden }
  | { ok: false; motivo: "TRANSICION_INVALIDA"; mensaje: string }
  | { ok: false; motivo: "ESTADO_CAMBIO" }

export interface TransicionarOrdenParams {
  ordenId: string
  organizationId: string
  /** Estado en el que el caller cree que está la orden (guarda de concurrencia). */
  esperado: EstadoOrden
  /** Estado destino. */
  nuevo: EstadoOrden
  /** Columnas extra a escribir en el mismo UPDATE atómico (presupuesto, costo_final, firmas, etc.). */
  camposExtra?: Record<string, unknown>
}

/**
 * Aplica una transición de estado de forma atómica: valida contra la máquina
 * de estados y hace el UPDATE condicionado a `estado = esperado`, de modo que
 * dos requests concurrentes no puedan pisarse. Fuente única para cambiar el
 * estado de una orden fuera del PUT genérico y del flujo de entrega.
 */
export async function transicionarOrden(
  supabase: SupabaseClient,
  { ordenId, organizationId, esperado, nuevo, camposExtra }: TransicionarOrdenParams
): Promise<ResultadoTransicion> {
  if (!esTransicionValida(esperado, nuevo)) {
    return {
      ok: false,
      motivo: "TRANSICION_INVALIDA",
      mensaje: getMensajeTransicionInvalida(esperado, nuevo),
    }
  }

  const { data, error } = await supabase
    .from("ordenes_servicio")
    .update({ estado: nuevo, ...camposExtra })
    .eq("id", ordenId)
    .eq("organization_id", organizationId)
    .eq("estado", esperado)
    .select("id")

  if (error) throw error
  if (!data || data.length === 0) {
    return { ok: false, motivo: "ESTADO_CAMBIO" }
  }
  return { ok: true, estado: nuevo }
}
