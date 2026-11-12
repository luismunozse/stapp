import { z } from "zod"
import { supabaseAdmin } from "@/lib/supabase"
import { combinarOr, terminoDeBusquedaSeguro } from "@/lib/sucursal-ordenes"
import { COBRO_PENDIENTE_ESTADOS_COBRO, COBRO_PENDIENTE_ESTADOS_ORDEN } from "@/lib/ordenes/filtros-url"
import { dayRangeUtc } from "@/lib/timezone"
import { alcanceListaOrdenes } from "./alcance-lista"
import { ESTADOS_ABIERTOS, SELECT_ORDEN_LISTA, ordenResumida } from "./formato-orden"
import type { Herramienta } from "./tipos"

const ESTADOS = [
  "RECIBIDO", "EN_DIAGNOSTICO", "PRESUPUESTADO", "APROBADO", "EN_REPARACION", "ESPERANDO_REPUESTO",
  "REPARADO", "ENTREGADO", "ENTREGADO_SIN_REPARACION", "ENTREGADO_SIN_COBRO", "CANCELADO",
  "SIN_REPARACION", "SIN_FALLA_DETECTADA",
] as const

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const inputSchema = z.object({
  texto: z.string().trim().min(1).max(80).optional(),
  estado: z.enum([...ESTADOS, "ABIERTAS"]).optional(),
  atrasadas: z.boolean().optional(),
  sin_tecnico: z.boolean().optional(),
  cobro_pendiente: z.boolean().optional(),
  ingresadas_desde: fecha.optional(),
  ingresadas_hasta: fecha.optional(),
  limite: z.number().int().min(1).max(20).optional(),
})

const MAX_CLIENTES_EN_BUSQUEDA = 50

export const buscarOrdenes: Herramienta = {
  definicion: {
    name: "buscar_ordenes",
    description:
      "Lista órdenes de servicio con filtros: texto (nombre o teléfono del cliente, equipo, marca, código o IMEI), estado, atrasadas (fecha prometida vencida y todavía en el taller), sin técnico, con cobro pendiente y rango de fecha de ingreso. Devuelve el total que coincide y hasta 20 órdenes resumidas. Usala para preguntas como \"¿qué órdenes están atrasadas?\", \"¿qué equipos tiene Juan?\" o \"¿cuántas órdenes esperan repuesto?\". Para el detalle de una orden puntual usá ver_orden.",
    input_schema: {
      type: "object",
      properties: {
        texto: { type: "string", description: "Texto a buscar en cliente, equipo, marca, código o IMEI." },
        estado: {
          type: "string",
          enum: [...ESTADOS, "ABIERTAS"],
          description: "Estado exacto, o ABIERTAS para todas las que siguen en el taller (no entregadas ni cerradas).",
        },
        atrasadas: { type: "boolean", description: "Solo las que pasaron su fecha prometida y siguen en el taller." },
        sin_tecnico: { type: "boolean", description: "Solo las que no tienen técnico asignado." },
        cobro_pendiente: { type: "boolean", description: "Solo las reparadas o entregadas que tienen saldo sin cobrar." },
        ingresadas_desde: { type: "string", description: "Fecha de ingreso desde (YYYY-MM-DD, inclusive)." },
        ingresadas_hasta: { type: "string", description: "Fecha de ingreso hasta (YYYY-MM-DD, inclusive)." },
        limite: { type: "integer", description: "Cuántas órdenes devolver (1 a 20, por defecto 10)." },
      },
      additionalProperties: false,
    },
    strict: true,
  },

  disponible: () => true,

  async ejecutar(input, ctx) {
    const f = inputSchema.parse(input)
    const { actor } = ctx
    const ahora = new Date()

    let query: any = supabaseAdmin
      .from("ordenes_servicio")
      .select(SELECT_ORDEN_LISTA, { count: "exact" })
      .eq("organization_id", actor.organizationId)
    const grupos: string[] = []

    const alcance = await alcanceListaOrdenes(ctx)
    if (alcance.eq) query = query.eq(...alcance.eq)
    if (alcance.or) grupos.push(alcance.or)

    if (f.estado === "ABIERTAS") query = query.in("estado", [...ESTADOS_ABIERTOS])
    else if (f.estado) query = query.eq("estado", f.estado)

    if (f.atrasadas) {
      query = query.lt("fecha_prometida", ahora.toISOString()).in("estado", [...ESTADOS_ABIERTOS])
    }
    if (f.sin_tecnico) query = query.is("tecnico_id", null)
    if (f.cobro_pendiente) {
      query = query
        .in("estado_cobro", [...COBRO_PENDIENTE_ESTADOS_COBRO])
        .in("estado", [...COBRO_PENDIENTE_ESTADOS_ORDEN])
        .gt("costo_final", 0)
    }
    if (f.ingresadas_desde) query = query.gte("fecha_ingreso", dayRangeUtc(f.ingresadas_desde, ctx.zonaHoraria).desde)
    if (f.ingresadas_hasta) query = query.lte("fecha_ingreso", dayRangeUtc(f.ingresadas_hasta, ctx.zonaHoraria).hasta)

    if (f.texto) {
      // Misma búsqueda que la pantalla Órdenes, con el término saneado: no puede cerrar el grupo
      // del alcance ni agregar una condición al lado.
      const termino = terminoDeBusquedaSeguro(f.texto)
      const { data: clientes } = await supabaseAdmin
        .from("clientes")
        .select("id")
        .eq("organization_id", actor.organizationId)
        .or(`nombre.ilike.%${termino}%,telefono.ilike.%${termino}%`)
        .order("id", { ascending: false })
        .limit(MAX_CLIENTES_EN_BUSQUEDA)
      const filtros = [
        `dispositivo.ilike.%${termino}%`,
        `codigo_orden.ilike.%${termino}%`,
        `marca.ilike.%${termino}%`,
        `imei.ilike.%${termino}%`,
      ]
      if (/^\d{1,9}$/.test(f.texto)) filtros.push(`numero_orden.eq.${Number(f.texto)}`)
      const ids = (clientes ?? []).map((c: { id: string }) => c.id)
      if (ids.length > 0) filtros.push(`cliente_id.in.(${ids.join(",")})`)
      grupos.push(filtros.join(","))
    }

    if (grupos.length > 0) query = query.or(combinarOr(...grupos))

    query = f.atrasadas
      ? query.order("fecha_prometida", { ascending: true })
      : query.order("fecha_ingreso", { ascending: false })

    const { data, error, count } = await query.limit(f.limite ?? 10)
    if (error) throw new Error(`buscar_ordenes: ${error.message}`)

    const ordenes = (data ?? []).map((o: any) => ordenResumida(o, ahora))
    return {
      datos: { total: count ?? ordenes.length, mostradas: ordenes.length, moneda: ctx.moneda, ordenes },
      filas: ordenes.length,
    }
  },
}
