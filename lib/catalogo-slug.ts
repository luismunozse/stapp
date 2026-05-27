import { supabaseAdmin } from "@/lib/supabase"

export const CATEGORIA_SLUG_REGEX = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/

export function normalizarSlugCategoria(texto: string): string {
  const base = (texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
  return base || "categoria"
}

export async function generarSlugCategoriaUnico(
  organizationId: string,
  base: string,
  excludeId?: string
): Promise<string> {
  let candidato = normalizarSlugCategoria(base)
  let n = 0
  while (true) {
    let query = supabaseAdmin
      .from("catalogo_categorias")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("slug", candidato)
    if (excludeId) query = query.neq("id", excludeId)
    const { data } = await query.maybeSingle()
    if (!data) return candidato
    n += 1
    candidato = `${normalizarSlugCategoria(base)}-${n}`
  }
}
