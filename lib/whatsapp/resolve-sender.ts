/**
 * Resuelve desde qué número de WhatsApp mandar un envío automático.
 * - Si la orden pertenece a una sucursal con WhatsApp propio conectado (open),
 *   se usa la instancia de esa sucursal.
 * - En cualquier otro caso (sin sucursal, sin config, inactiva o desconectada),
 *   se cae al número central per-organización (whatsapp_config).
 */
import { supabaseAdmin } from "@/lib/supabase"

export interface ResolvedSender {
  scope: "sucursal" | "central"
  instanceName?: string
}

export async function resolveWhatsAppSender(
  organizationId: string,
  sucursalId?: string | null
): Promise<ResolvedSender> {
  if (!sucursalId) return { scope: "central" }

  const { data } = await supabaseAdmin
    .from("sucursal_whatsapp_config")
    .select("activo, evolution_connection_state, evolution_instance_name")
    .eq("organization_id", organizationId)
    .eq("sucursal_id", sucursalId)
    .maybeSingle()

  if (
    data &&
    data.activo &&
    data.evolution_connection_state === "open" &&
    data.evolution_instance_name
  ) {
    return { scope: "sucursal", instanceName: data.evolution_instance_name }
  }

  return { scope: "central" }
}
