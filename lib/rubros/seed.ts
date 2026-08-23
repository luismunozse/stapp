import { supabaseAdmin } from "@/lib/supabase"
import { getRubro } from "./index"
import type { RubroPack } from "./types"

export interface SeedRubroResult {
  /** Rubro efectivamente aplicado (puede ser el genérico si el pedido no existe). */
  rubroId: string
  tiposSembrados: number
  checklistsCreados: number
  /** Errores no fatales. La siembra nunca lanza: el registro no debe fallar por esto. */
  errors: string[]
}

/**
 * Siembra una organización recién creada con el contenido de su pack de rubro:
 * tipos de equipo (con su config), vocabulario y checklists de recepción.
 *
 * Reemplaza al trigger `trigger_organization_tipos_dispositivo` (migraciones
 * 014/021/092), que sembraba ocho tipos de electrónica en toda org nueva sin
 * saber a qué se dedicaba. La migración 307 lo da de baja.
 *
 * Es idempotente en los tipos (upsert por `organization_id,codigo`) y tolerante
 * a fallos: acumula errores en el resultado en vez de lanzar, porque una org sin
 * checklist es recuperable pero un registro que revienta a mitad de camino no.
 */
export async function seedOrganizationFromRubro(
  organizationId: string,
  rubroId: string | null | undefined,
  client: typeof supabaseAdmin = supabaseAdmin
): Promise<SeedRubroResult> {
  const pack = getRubro(rubroId)
  const errors: string[] = []

  const tiposSembrados = await sembrarTipos(organizationId, pack, client, errors)
  const tipoIdPorCodigo = await resolverTipos(organizationId, client, errors)

  await sembrarVocabulario(organizationId, pack, client, errors)

  const checklistsCreados = await sembrarChecklists(
    organizationId,
    pack,
    tipoIdPorCodigo,
    client,
    errors
  )

  return { rubroId: pack.id, tiposSembrados, checklistsCreados, errors }
}

async function sembrarTipos(
  organizationId: string,
  pack: RubroPack,
  client: typeof supabaseAdmin,
  errors: string[]
): Promise<number> {
  const filas = pack.tipos.map((tipo) => ({
    organization_id: organizationId,
    codigo: tipo.codigo,
    nombre: tipo.nombre,
    prefijo_orden: tipo.prefijoOrden,
    icono: tipo.icono ?? null,
    activo: true,
    es_base: true,
    orden: tipo.orden,
    config: tipo.config,
  }))

  const { error } = await client
    .from("tipos_dispositivo")
    .upsert(filas, { onConflict: "organization_id,codigo", ignoreDuplicates: true })

  if (error) {
    errors.push(`tipos_dispositivo: ${error.message}`)
    return 0
  }
  return filas.length
}

/**
 * Relee los tipos de la org para armar el mapa código → id. No alcanza con el
 * retorno del upsert: con `ignoreDuplicates` las filas ya existentes no vuelven,
 * y los checklists necesitan el id de esas también.
 */
async function resolverTipos(
  organizationId: string,
  client: typeof supabaseAdmin,
  errors: string[]
): Promise<Map<string, string>> {
  const { data, error } = await client
    .from("tipos_dispositivo")
    .select("id, codigo")
    .eq("organization_id", organizationId)

  if (error) {
    errors.push(`tipos_dispositivo (lectura): ${error.message}`)
    return new Map()
  }

  return new Map((data ?? []).map((t: any) => [t.codigo, t.id]))
}

async function sembrarVocabulario(
  organizationId: string,
  pack: RubroPack,
  client: typeof supabaseAdmin,
  errors: string[]
): Promise<void> {
  // Un pack sin overrides deja los defaults neutrales de lib/terminologia.ts.
  // Escribir `{}` sería equivalente, pero evitamos el UPDATE para no pisar
  // configuración previa si esto se llama sobre una org que ya existía.
  if (Object.keys(pack.terminologia).length === 0) return

  const { error } = await client
    .from("organizations")
    .update({ terminologia: pack.terminologia })
    .eq("id", organizationId)

  if (error) errors.push(`organizations.terminologia: ${error.message}`)
}

/**
 * `checklist_template_items.opciones` viaja como JSON array: la UI lo consume
 * con `JSON.parse` en orden-form, checklist-picker y checklist-form, y el POST
 * de /api/checklist-templates/[id]/items lo documenta asi.
 *
 * Los presets historicos de lib/onboarding/checklist-presets.ts estaban escritos
 * separados por coma ("Sin dano,Rayones,Roto"). Nunca reventó porque ningun
 * codigo los instalaba; al conectarlos habrian roto el render del checklist con
 * un SyntaxError. Normalizamos aca para no reescribir esos presets ni obligar a
 * cada pack nuevo a acordarse del formato.
 */
function normalizarOpciones(opciones: string | null, tipo: string): string | null {
  if (tipo !== "SELECT") return null
  if (!opciones) return null

  const crudo = opciones.trim()
  if (crudo === "") return null

  if (crudo.startsWith("[")) {
    try {
      const parsed = JSON.parse(crudo)
      if (Array.isArray(parsed)) return JSON.stringify(parsed)
    } catch {
      // Cae al split por coma de abajo.
    }
  }

  const items = crudo
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o !== "")

  return items.length > 0 ? JSON.stringify(items) : null
}

async function sembrarChecklists(
  organizationId: string,
  pack: RubroPack,
  tipoIdPorCodigo: Map<string, string>,
  client: typeof supabaseAdmin,
  errors: string[]
): Promise<number> {
  let creados = 0

  for (const checklist of pack.checklists) {
    if (checklist.items.length === 0) continue

    let tipoDispositivoId: string | null = null
    if (checklist.tipoCodigo !== null) {
      tipoDispositivoId = tipoIdPorCodigo.get(checklist.tipoCodigo) ?? null
      // El preset pide un tipo puntual y no lo pudimos resolver: crear el
      // template igual lo dejaría aplicando a todo, que no es lo pedido.
      if (!tipoDispositivoId) {
        errors.push(
          `checklist "${checklist.nombre}": no se resolvió el tipo ${checklist.tipoCodigo}`
        )
        continue
      }
    }

    const { data: template, error: templateError } = await client
      .from("checklist_templates")
      .insert({
        organization_id: organizationId,
        nombre: checklist.nombre,
        activo: true,
        tipo_dispositivo_id: tipoDispositivoId,
      })
      .select("id")
      .single()

    if (templateError || !template) {
      errors.push(
        `checklist_templates "${checklist.nombre}": ${templateError?.message ?? "sin id"}`
      )
      continue
    }

    const { error: itemsError } = await client
      .from("checklist_template_items")
      .insert(
        checklist.items.map((item) => ({
          template_id: (template as any).id,
          label: item.label,
          tipo: item.tipo,
          categoria: item.categoria,
          opciones: normalizarOpciones(item.opciones, item.tipo),
          orden: item.orden,
          requerido: item.requerido,
        }))
      )

    if (itemsError) {
      errors.push(`checklist_template_items "${checklist.nombre}": ${itemsError.message}`)
      continue
    }

    creados++
  }

  return creados
}
