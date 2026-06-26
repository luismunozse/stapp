import { supabaseAdmin } from "@/lib/supabase"
import { resolveTerminologia, type Terminologia } from "@/lib/terminologia"

/** Mapa de terminología resuelto de la org. Fail-safe: ante error => defaults. */
export async function getTerminologia(organizationId: string): Promise<Terminologia> {
  try {
    const { data, error } = await supabaseAdmin
      .from("organizations")
      .select("terminologia")
      .eq("id", organizationId)
      .single()
    if (error || !data) return resolveTerminologia(null)
    return resolveTerminologia(data.terminologia as Terminologia | null)
  } catch {
    return resolveTerminologia(null)
  }
}
