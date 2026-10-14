import { supabaseAdmin } from "@/lib/supabase"
import { imagenRespaldoDe, type OpcionDeGrupo } from "@/lib/variantes"
import type { AtributoVariante } from "@/types"

// Cap of the sibling query. If a page ever needs more rows than this, the truncation can only
// hide a fallback (the row shows no borrowed photo); it never shows a wrong one for long.
const LIMITE_HERMANOS = 2000

/** The slice of a formatted inventory item the fallback reads and adds. */
export interface ItemParaRespaldo {
  id: string
  grupoId?: string | null
  atributos?: AtributoVariante[] | null
  imagenUrl?: string | null
  imagenRespaldo?: { url: string; etiqueta: string } | null
}

type Fila = Record<string, any>

/**
 * Adds the display-only `imagenRespaldo {url, etiqueta}` to every grouped item without an own
 * photo: the photo of the first ACTIVE sibling, in combination order, that has one (PI-2).
 * `imagenUrl` is never touched (it keeps meaning "the row's own photo").
 *
 * The siblings are read from the whole organization, never from the rows a paged or
 * depósito-scoped list happens to return, so the answer does not depend on paging, filters or
 * viewer. Cost: none when no grouped item lacks a photo; otherwise two parallel queries for the
 * whole page, never one per row. Best-effort: a failure logs a warning and returns the items
 * unchanged, because a display fallback must never turn a 200 into a 500.
 */
export async function adjuntarFotoDeRespaldo<T extends ItemParaRespaldo>(
  organizationId: string,
  items: T[]
): Promise<T[]> {
  const sinFoto = items.filter((i) => i.grupoId && !i.imagenUrl)
  if (sinFoto.length === 0) return items
  const grupoIds = [...new Set(sinFoto.map((i) => i.grupoId as string))]

  try {
    const [hermanas, grupos] = await Promise.all([
      supabaseAdmin
        .from("inventario")
        .select("id, grupo_id, atributos, imagen_url")
        .eq("organization_id", organizationId)
        .in("grupo_id", grupoIds)
        .is("deleted_at", null)
        .not("imagen_url", "is", null)
        .limit(LIMITE_HERMANOS),
      supabaseAdmin
        .from("inventario_grupos")
        .select("id, opciones")
        .eq("organization_id", organizationId)
        .in("id", grupoIds),
    ])
    const fallo = hermanas.error ?? grupos.error
    if (fallo) throw fallo

    const hermanosPorGrupo = new Map<string, Fila[]>()
    for (const fila of (hermanas.data ?? []) as Fila[]) {
      hermanosPorGrupo.set(fila.grupo_id, [...(hermanosPorGrupo.get(fila.grupo_id) ?? []), fila])
    }
    const opcionesPorGrupo = new Map<string, OpcionDeGrupo[]>(
      ((grupos.data ?? []) as Fila[]).map((g) => [g.id, g.opciones])
    )

    return items.map((item) => {
      if (!item.grupoId || item.imagenUrl) return item
      const opciones = opcionesPorGrupo.get(item.grupoId)
      // Without the group's options there is no way to say which sibling is "first".
      if (!opciones) return item
      const hermanos = (hermanosPorGrupo.get(item.grupoId) ?? []).map((h) => ({
        id: h.id as string,
        atributos: h.atributos,
        foto: h.imagen_url as string | null,
      }))
      const imagenRespaldo = imagenRespaldoDe(opciones, hermanos, item.id)
      return imagenRespaldo ? { ...item, imagenRespaldo } : item
    })
  } catch (error) {
    console.warn("No se pudo calcular la foto de respaldo de las variantes:", error)
    return items
  }
}
