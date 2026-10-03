/**
 * ¿El catálogo registra pedidos (feature `cotizaciones_online`)?
 *
 * `hasPlanFeature` devuelve false tanto con un "no" real como ante un error
 * transitorio de Supabase, y ese false se cachea 60s en la página. Acá se falla
 * ABIERTO: solo un "no" confirmado da false. `/cotizar` sigue siendo la
 * autoridad (responde 403 y el carrito cae a WhatsApp), así que equivocarse
 * hacia true es inocuo y equivocarse hacia false le quita pedidos a un taller pago.
 */
import { supabaseAdmin } from "@/lib/supabase"
import { hasPlanFeature } from "@/lib/subscriptions"

export async function catalogoRecibePedidos(organizationId: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from("subscriptions")
      .select("id")
      .eq("organization_id", organizationId)
      .maybeSingle()
    if (error) return true
    // Sin suscripción: /cotizar también lo trata como sin feature.
    if (!data) return false
    return await hasPlanFeature(organizationId, "cotizaciones_online")
  } catch {
    return true
  }
}
