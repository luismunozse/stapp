import { revalidateTag } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Invalida los tags de cache del catálogo público de una organización.
 *
 * Tag tree:
 *   - "catalogo"                     → todos los catálogos (broad)
 *   - "catalogo:${slug}"             → un catálogo específico
 *   - "catalogo-item:${itemId}"      → permalink de un item
 *
 * Las pages SSR (page.tsx, [itemId]/page.tsx, c/[categoriaSlug]/page.tsx)
 * usan estos tags al envolver con unstable_cache. Si solo invalidas
 * "catalogo" la cache granular puede no expirar antes de los 60s del
 * revalidate.
 *
 * Llamar SIEMPRE después de cualquier mutación que afecte la vista pública:
 * items, variantes, categorías, config, cupones, trust badges, banner.
 */
export async function revalidateCatalogo(
  organizationId: string,
  opts?: { itemId?: string }
): Promise<void> {
  // Tag broad: siempre. Cubre admin dashboards, sitemap, otras superficies.
  // "max" en Next 16 = invalidación inmediata (sin segundo arg el call queda
  // deprecated y muestra warning).
  revalidateTag("catalogo", "max")

  // Lookup slug para invalidar tag por catálogo. Único query (lookup por PK).
  // Si el catálogo no existe (org sin catalogo_config), nada que invalidar
  // más allá del tag broad.
  const { data: config } = await supabaseAdmin
    .from("catalogo_config")
    .select("slug")
    .eq("organization_id", organizationId)
    .maybeSingle()

  if (config?.slug) {
    revalidateTag(`catalogo:${config.slug}`, "max")
  }

  if (opts?.itemId) {
    revalidateTag(`catalogo-item:${opts.itemId}`, "max")
  }
}
