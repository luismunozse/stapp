import { supabaseAdmin } from "@/lib/supabase"
import { getRubro } from "./index"
import { personalizarPack } from "./detalle"
import { filasDeTipos } from "./seed"
import type { RubroPack } from "./types"

/**
 * Rubro change for an org with no real orders yet (PUT /api/onboarding/rubro).
 *
 * It reuses the signup's building blocks from seed.ts but has the opposite
 * failure contract: the signup never throws and never aborts; here a failed
 * tipos upsert aborts before any other write, and every later DB error throws
 * so the route answers 500. Every step is idempotent and organizations.rubro is
 * written last, so retrying the same request converges.
 *
 * It never deletes, it deactivates: inventario.tipo_dispositivo_id references
 * tipos with no ON DELETE (migration 014), and quotes keep a checklist snapshot
 * that points at a template id with no FK (lib/cotizacion-pdf.ts).
 *
 * Server-only (supabaseAdmin). Never import it from a client component.
 */

export interface SeleccionRubro {
  rubro: string | null
  rubroDetalle: string | null
}

interface TipoExistente {
  id: string
  codigo: string
  es_base: boolean | null
  activo: boolean | null
}

export async function aplicarCambioDeRubro(
  organizationId: string,
  anterior: SeleccionRubro,
  nuevo: SeleccionRubro,
  client: typeof supabaseAdmin = supabaseAdmin
): Promise<{ tiposActivos: number }> {
  const packNuevo = personalizarPack(getRubro(nuevo.rubro), nuevo.rubroDetalle)

  await reemplazarTipos(organizationId, packNuevo, client)

  // Spec steps 5 and 6 in one statement, written last. The terminology is
  // written even when it is {}: sembrarVocabulario in seed.ts skips that case,
  // so a shop leaving electrodomésticos kept saying "Artefacto".
  const { error } = await client
    .from("organizations")
    .update({
      terminologia: packNuevo.terminologia,
      rubro: nuevo.rubro,
      rubro_detalle: nuevo.rubroDetalle,
    })
    .eq("id", organizationId)
  if (error) throw new Error(`organizations: ${error.message}`)

  return { tiposActivos: await contarTiposActivos(organizationId, client) }
}

/**
 * Active tipos the shop can pick: what GET /api/tipos-dispositivo lists by
 * default (activo = true, without the internal TODOS).
 */
export async function contarTiposActivos(
  organizationId: string,
  client: typeof supabaseAdmin = supabaseAdmin
): Promise<number> {
  const { data, error } = await client
    .from("tipos_dispositivo")
    .select("codigo")
    .eq("organization_id", organizationId)
    .eq("activo", true)

  if (error) throw new Error(`tipos_dispositivo (conteo): ${error.message}`)
  return (data ?? []).filter((t: { codigo: string }) => t.codigo !== "TODOS").length
}

/** Seeds the new pack's tipos, deactivates the old base ones, returns codigo -> id. */
async function reemplazarTipos(
  organizationId: string,
  pack: RubroPack,
  client: typeof supabaseAdmin
): Promise<Map<string, string>> {
  // Read BEFORE any write: a failed read aborts with nothing changed. The
  // overwrite below would turn a custom tipo (es_base = false) that happens to
  // share a pack codigo into a base one, so those codigos are left out.
  const { data: previos, error: previosError } = await client
    .from("tipos_dispositivo")
    .select("codigo, es_base")
    .eq("organization_id", organizationId)
  if (previosError) throw new Error(`tipos_dispositivo (lectura previa): ${previosError.message}`)

  const codigosPropios = new Set(
    ((previos ?? []) as Array<{ codigo: string; es_base: boolean | null }>)
      .filter((t) => t.es_base === false)
      .map((t) => t.codigo)
  )
  const filas = filasDeTipos(organizationId, pack).filter((f) => !codigosPropios.has(f.codigo))

  // Unlike the signup, no ignoreDuplicates: ON CONFLICT DO UPDATE writes the
  // pack's row, activo = true included, in one atomic statement. A code an
  // earlier change deactivated comes back active and with the pack's name.
  const { error: upsertError } = await client
    .from("tipos_dispositivo")
    .upsert(filas, { onConflict: "organization_id,codigo" })
  if (upsertError) throw new Error(`tipos_dispositivo: ${upsertError.message}`)

  const { data, error: readError } = await client
    .from("tipos_dispositivo")
    .select("id, codigo, es_base, activo")
    .eq("organization_id", organizationId)
  if (readError) throw new Error(`tipos_dispositivo (lectura): ${readError.message}`)

  const tipos = (data ?? []) as TipoExistente[]
  const codigosDelPack = new Set(pack.tipos.map((t) => t.codigo))

  // Only base tipos: the ones the shop created by hand never belonged to a pack.
  const aDesactivar = tipos
    .filter((t) => t.es_base === true && t.activo !== false && !codigosDelPack.has(t.codigo))
    .map((t) => t.id)
  await actualizarActivo(client, "tipos_dispositivo", organizationId, aDesactivar, false)

  return new Map(tipos.map((t) => [t.codigo, t.id]))
}

async function actualizarActivo(
  client: typeof supabaseAdmin,
  tabla: "tipos_dispositivo" | "checklist_templates",
  organizationId: string,
  ids: string[],
  activo: boolean
): Promise<void> {
  if (ids.length === 0) return

  const { error } = await client
    .from(tabla)
    .update({ activo })
    .eq("organization_id", organizationId)
    .in("id", ids)

  if (error) throw new Error(`${tabla} (activo = ${activo}): ${error.message}`)
}
