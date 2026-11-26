import { supabaseAdmin } from "@/lib/supabase"

/**
 * País de la organización (ISO, ej. "MX") para leer los teléfonos de un import
 * de clientes. Null si no está cargado o no se pudo leer: la validación cae a
 * Argentina, que es como se comportaba el import antes de mirar el país.
 */
export async function paisParaImportar(organizationId: string): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin
      .from("organizations")
      .select("pais")
      .eq("id", organizationId)
      .single()
    return (data?.pais as string | null) ?? null
  } catch {
    return null
  }
}
