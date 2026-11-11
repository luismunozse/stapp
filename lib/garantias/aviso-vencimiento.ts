/**
 * Aviso al cliente de una garantía por vencer (GARANTIA_POR_VENCER, Fase 3 de
 * docs/garantias-flujo-2026-11-11.md; decisión 6: opcional, apagado por
 * defecto). Lo corre /api/cron/garantias-por-vencer una vez por día y org.
 *
 * Qué garantías se avisan: las de la pestaña "Por vencer" de /garantias, con
 * la MISMA consulta (aplicarTab) y la ventana de la org: no anuladas, sin
 * reclamo abierto, vencen hoy o dentro de la ventana. Las vencidas no entran.
 * Las dos clases (reparación y venta), siempre acotadas por organization_id.
 *
 * Idempotencia: la marca aviso_vencimiento_enviado_at (migración 402) se toma
 * con un UPDATE condicional (... WHERE aviso_vencimiento_enviado_at IS NULL)
 * ANTES de encolar. Si dos corridas se pisan, solo una la toma; si el encolado
 * tira, la marca se suelta y se reintenta al día siguiente. Una garantía nunca
 * se avisa dos veces.
 */
import { supabaseAdmin } from "@/lib/supabase"
import { queueNotification } from "@/lib/notifications/queue"
import { DEFAULT_TIMEZONE } from "@/lib/timezone"
import { aplicarTab } from "./listado"
import { diaCalendario, diasEntre, type OrigenGarantia } from "./estado"

/** Tope de garantías por org y corrida (el resto sale al día siguiente). */
export const MAX_AVISOS_POR_ORG = 200

const COLUMNAS_CANDIDATAS =
  "id, origen, organization_id, sucursal_id, cliente_id, descripcion, orden_id, numero_garantia, " +
  "dias_validez, fecha_vencimiento, dia_vencimiento"

interface Candidata {
  id: string
  origen: OrigenGarantia
  organization_id: string
  sucursal_id: string | null
  cliente_id: string | null
  descripcion: string | null
  orden_id: string | null
  numero_garantia: string | null
  dias_validez: number | null
  fecha_vencimiento: string
  dia_vencimiento: string
}

export interface OrgAviso {
  id: string
  nombre: string
  slug: string | null
  moneda: string | null
  zonaHoraria: string | null
  ventana: number
}

export interface ResultadoAvisoOrg {
  candidatas: number
  enviados: number
  /** Ya avisadas, sin cliente con contacto o con una garantía más corta que la ventana. */
  omitidos: number
  errores: number
}

const tablaDe = (origen: OrigenGarantia) => (origen === "VENTA" ? "garantias_venta" : "garantias")

/**
 * Una garantía que dura lo mismo o menos que la ventana nace "por vencer": el
 * aviso le llegaría al cliente junto con la entrega. Esas no se avisan.
 */
export function esGarantiaCortaParaAviso(diasValidez: number | null, ventana: number): boolean {
  return diasValidez != null && diasValidez <= ventana
}

/** Toma la marca de aviso. true = esta corrida la tomó y le toca avisar. */
async function tomarMarca(c: Candidata, organizationId: string, ahora: Date): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from(tablaDe(c.origen))
    .update({ aviso_vencimiento_enviado_at: ahora.toISOString() })
    .eq("id", c.id)
    .eq("organization_id", organizationId)
    .is("aviso_vencimiento_enviado_at", null)
    .select("id")
  if (error) throw error
  return Array.isArray(data) && data.length > 0
}

async function soltarMarca(c: Candidata, organizationId: string): Promise<void> {
  await supabaseAdmin
    .from(tablaDe(c.origen))
    .update({ aviso_vencimiento_enviado_at: null })
    .eq("id", c.id)
    .eq("organization_id", organizationId)
}

/** Ids ya avisados de una tabla (para no intentar tomar la marca de nuevo). */
async function yaAvisadas(origen: OrigenGarantia, ids: string[], organizationId: string): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const { data, error } = await supabaseAdmin
    .from(tablaDe(origen))
    .select("id")
    .eq("organization_id", organizationId)
    .in("id", ids)
    .not("aviso_vencimiento_enviado_at", "is", null)
  if (error) throw error
  return new Set(((data ?? []) as { id: string }[]).map((r) => r.id))
}

export async function avisarGarantiasPorVencerDeOrg(org: OrgAviso, ahora: Date = new Date()): Promise<ResultadoAvisoOrg> {
  const zonaHoraria = org.zonaHoraria || DEFAULT_TIMEZONE
  const hoy = diaCalendario(ahora, zonaHoraria)
  const resultado: ResultadoAvisoOrg = { candidatas: 0, enviados: 0, omitidos: 0, errores: 0 }

  let query: any = supabaseAdmin.from("v_garantias").select(COLUMNAS_CANDIDATAS).eq("organization_id", org.id)
  query = aplicarTab(query, "por-vencer", hoy, org.ventana)
  const { data, error } = await query.order("dia_vencimiento", { ascending: true }).limit(MAX_AVISOS_POR_ORG)
  if (error) throw error

  const candidatas = ((data ?? []) as Candidata[]).filter((c) => c.organization_id === org.id)
  resultado.candidatas = candidatas.length
  if (candidatas.length === 0) return resultado

  const [avisadasRep, avisadasVenta] = await Promise.all([
    yaAvisadas("REPARACION", candidatas.filter((c) => c.origen === "REPARACION").map((c) => c.id), org.id),
    yaAvisadas("VENTA", candidatas.filter((c) => c.origen === "VENTA").map((c) => c.id), org.id),
  ])

  const pendientes = candidatas.filter((c) => {
    const avisada = (c.origen === "VENTA" ? avisadasVenta : avisadasRep).has(c.id)
    const omitir = avisada || !c.cliente_id || esGarantiaCortaParaAviso(c.dias_validez, org.ventana)
    if (omitir) resultado.omitidos++
    return !omitir
  })
  if (pendientes.length === 0) return resultado

  const clienteIds = [...new Set(pendientes.map((c) => c.cliente_id as string))]
  const ordenIds = [...new Set(pendientes.map((c) => c.orden_id).filter((v): v is string => !!v))]

  const [{ data: clientesData }, { data: ordenesData }] = await Promise.all([
    supabaseAdmin
      .from("clientes")
      .select("id, nombre, email, telefono")
      .eq("organization_id", org.id)
      .in("id", clienteIds),
    ordenIds.length > 0
      ? supabaseAdmin
          .from("ordenes_servicio")
          .select("id, numero_orden, dispositivo, public_token")
          .eq("organization_id", org.id)
          .in("id", ordenIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ])

  type Cliente = { id: string; nombre: string | null; email: string | null; telefono: string | null }
  type Orden = { id: string; numero_orden: number; dispositivo: string | null; public_token: string | null }
  const clientes = new Map(((clientesData ?? []) as Cliente[]).map((c) => [c.id, c]))
  const ordenes = new Map(((ordenesData ?? []) as Orden[]).map((o) => [o.id, o]))

  for (const c of pendientes) {
    const cliente = clientes.get(c.cliente_id as string)
    if (!cliente || (!cliente.email && !cliente.telefono)) {
      resultado.omitidos++
      continue
    }
    const orden = c.origen === "REPARACION" && c.orden_id ? ordenes.get(c.orden_id) ?? null : null

    let tomada = false
    try {
      tomada = await tomarMarca(c, org.id, ahora)
      if (!tomada) {
        // Otra corrida la avisó entre la lectura y ahora.
        resultado.omitidos++
        continue
      }
      await queueNotification({
        organizationId: org.id,
        sucursalId: c.sucursal_id,
        ordenId: orden?.id,
        // notification_logs.garantia_id apunta a garantias (reparación): la de venta no va.
        garantiaId: c.origen === "REPARACION" ? c.id : undefined,
        clienteId: cliente.id,
        tipo: "GARANTIA_POR_VENCER",
        context: {
          organizationName: org.nombre,
          organizationSlug: org.slug ?? undefined,
          moneda: org.moneda || "ARS",
          zonaHoraria,
          cliente: {
            id: cliente.id,
            nombre: cliente.nombre || "",
            email: cliente.email,
            telefono: cliente.telefono ?? "",
          },
          ...(orden && {
            orden: {
              id: orden.id,
              numeroOrden: orden.numero_orden,
              dispositivo: orden.dispositivo || c.descripcion || "",
              estado: "ENTREGADO",
              publicToken: orden.public_token,
            },
          }),
          garantia: {
            id: c.id,
            diasValidez: c.dias_validez ?? 0,
            fechaVencimiento: c.fecha_vencimiento,
            origen: c.origen,
            descripcion: c.descripcion,
            numeroGarantia: c.numero_garantia,
            diasRestantes: diasEntre(hoy, c.dia_vencimiento),
          },
        },
      })
      resultado.enviados++
    } catch (err) {
      console.error(`aviso garantía por vencer ${c.origen} ${c.id}:`, err)
      resultado.errores++
      if (tomada) await soltarMarca(c, org.id).catch(() => {})
    }
  }

  return resultado
}
