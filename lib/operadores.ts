import { supabaseAdmin } from "@/lib/supabase"

/**
 * Valida que `actorId` sea un usuario activo de la org (y, si se pasa `roles`,
 * con rol permitido). Devuelve el actor válido o `fallbackUserId`.
 * Server-authoritative: nunca persiste un id ajeno o inválido.
 */
export async function resolveOperador(
  organizationId: string,
  actorId: string | null | undefined,
  fallbackUserId: string,
  opts?: { roles?: string[] }
): Promise<string> {
  if (!actorId) return fallbackUserId
  const { data } = await supabaseAdmin
    .from("users")
    .select("id, rol, activo")
    .eq("id", actorId)
    .eq("organization_id", organizationId)
    .maybeSingle()
  if (!data) return fallbackUserId
  if (data.activo === false) return fallbackUserId
  if (opts?.roles && !opts.roles.includes(data.rol)) return fallbackUserId
  return data.id
}
