import { z } from "zod"
import { supabaseAdmin } from "@/lib/supabase"
import { cargarOrdenEnAlcance } from "@/lib/ordenes/alcance"
import { pendienteOrden, aplicadoNotasCreditoDeOrden, NOTAS_CREDITO_APLICADO_EMBED } from "@/lib/ordenes/pendiente"
import { ESTADO_LABELS } from "@/lib/orden-state-machine"
import type { EstadoOrden } from "@/types"
import type { Herramienta } from "./tipos"

const inputSchema = z.object({
  numero: z.string().trim().min(1).max(40),
})

/** Si dos tipos de equipo comparten número, se devuelven todas las que el actor puede ver (como máximo estas). */
const MAX_COINCIDENCIAS = 5

const SELECT_ORDEN = `
  id, numero_orden, codigo_orden, estado, tipo_dispositivo, dispositivo, marca,
  problema_reportado, diagnostico, fecha_ingreso, fecha_prometida, fecha_entrega,
  presupuesto, costo_final, total_cobrado, descuento_cobro, estado_cobro,
  clientes(nombre),
  users:tecnico_id(nombre),
  ${NOTAS_CREDITO_APLICADO_EMBED.replace(/\s+\(/, "(")}
`

export const verOrden: Herramienta = {
  etiqueta: "Buscando la orden…",
  definicion: {
    name: "ver_orden",
    description:
      "Busca una orden de servicio por su número (por ejemplo 1234) o su código (por ejemplo CEL-0012) y devuelve estado, equipo, cliente, técnico, fechas, costo y saldo pendiente. Usala cuando el usuario pregunte por una orden puntual. Solo devuelve órdenes que el usuario tiene permiso de ver.",
    input_schema: {
      type: "object",
      properties: {
        numero: {
          type: "string",
          description: "Número de la orden (solo dígitos) o código completo con prefijo, tal como lo escribió el usuario.",
        },
      },
      required: ["numero"],
      additionalProperties: false,
    },
    strict: true,
  },

  // Todos los roles pueden ver órdenes; el alcance de cada una lo decide cargarOrdenEnAlcance.
  disponible: () => true,

  async ejecutar(input, ctx) {
    const { numero } = inputSchema.parse(input)
    const { actor } = ctx

    const limpio = numero.replace(/^#/, "")
    let query = supabaseAdmin
      .from("ordenes_servicio")
      .select("id")
      .eq("organization_id", actor.organizationId)
      .limit(MAX_COINCIDENCIAS)
    if (/^\d{1,9}$/.test(limpio)) {
      query = query.eq("numero_orden", Number(limpio))
    } else {
      query = query.eq("codigo_orden", limpio.toUpperCase())
    }
    const { data: candidatas, error } = await query
    if (error) throw new Error("No se pudo buscar la orden")

    const ordenes = []
    for (const { id } of candidatas ?? []) {
      // La misma puerta que usa el detalle de la orden: fuera de alcance = no existe.
      const cargada = await cargarOrdenEnAlcance(id, actor, "leer", { select: SELECT_ORDEN })
      if ("error" in cargada) continue
      const o = cargada.orden
      const costoFinal = Number(o.costo_final ?? 0)
      ordenes.push({
        id: o.id,
        link: `/ordenes/${o.id}`,
        numero: o.numero_orden,
        codigo: o.codigo_orden,
        estado: ESTADO_LABELS[o.estado as EstadoOrden] ?? o.estado,
        equipo: [o.tipo_dispositivo, o.marca, o.dispositivo].filter(Boolean).join(" · "),
        cliente: o.clientes?.nombre ?? null,
        tecnico: o.users?.nombre ?? "Sin asignar",
        problema: o.problema_reportado ?? null,
        diagnostico: o.diagnostico ?? null,
        fechaIngreso: o.fecha_ingreso ?? null,
        fechaPrometida: o.fecha_prometida ?? null,
        fechaEntrega: o.fecha_entrega ?? null,
        presupuesto: o.presupuesto != null ? Number(o.presupuesto) : null,
        costoFinal: o.costo_final != null ? costoFinal : null,
        totalCobrado: Number(o.total_cobrado ?? 0),
        saldoPendiente: o.costo_final != null
          ? pendienteOrden({
              costoFinal,
              descuentoCobro: Number(o.descuento_cobro ?? 0),
              totalCobrado: Number(o.total_cobrado ?? 0),
              aplicadoNotasCredito: aplicadoNotasCreditoDeOrden(o),
            })
          : null,
        estadoCobro: o.estado_cobro ?? null,
      })
    }

    if (ordenes.length === 0) {
      return { datos: { encontrada: false, mensaje: `No hay una orden ${numero} que puedas ver.` }, filas: 0 }
    }
    return { datos: { encontrada: true, moneda: ctx.moneda, ordenes }, filas: ordenes.length }
  },
}
