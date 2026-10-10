import { supabaseAdmin } from "@/lib/supabase"

/**
 * ¿Se puede procesar un cobro para esta organización? No si ya no existe
 * (purgada) ni si está dada de baja (período de gracia): un pago en vuelo no
 * debe resucitar la suscripción que se canceló al pedir la eliminación.
 * Si la lectura falla TIRA: el webhook responde 500 y el proveedor reintenta.
 */
export async function organizationAcceptsBilling(orgId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("id, deleted_at")
    .eq("id", orgId)
    .maybeSingle()
  if (error) throw new Error(`organizations: ${error.message}`)
  return !!data && !data.deleted_at
}
