import { supabaseAdmin } from "@/lib/supabase"

let cachedId: string | null | undefined = undefined

/**
 * Obtiene el ID de la organización del panel admin (slug="superadmin").
 *
 * Se cachea en memoria del proceso. La org no cambia de ID durante la vida
 * de un deploy, así que el cache no necesita invalidación.
 *
 * Devuelve null si no existe (en algunos entornos puede no estar seeded).
 */
export async function getSuperadminOrgId(): Promise<string | null> {
  if (cachedId !== undefined) return cachedId
  const { data } = await supabaseAdmin
    .from("organizations")
    .select("id")
    .eq("slug", "superadmin")
    .maybeSingle()
  cachedId = (data?.id as string | null | undefined) ?? null
  return cachedId ?? null
}
