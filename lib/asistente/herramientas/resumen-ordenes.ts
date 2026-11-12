import { z } from "zod"
import { combinarOr } from "@/lib/sucursal-ordenes"
import { fetchAllRows } from "@/lib/fetch-all-rows"
import { COBRO_PENDIENTE_ESTADOS_COBRO, COBRO_PENDIENTE_ESTADOS_ORDEN } from "@/lib/ordenes/filtros-url"
import { NOTAS_CREDITO_APLICADO_EMBED } from "@/lib/ordenes/pendiente"
import { ESTADO_LABELS } from "@/lib/orden-state-machine"
import { dayRangeUtc, todayInTimeZone } from "@/lib/timezone"
import type { EstadoOrden } from "@/types"
import { alcanceListaOrdenes } from "./alcance-lista"
import { ESTADOS_ABIERTOS, ESTADOS_ENTREGADA, saldoDeOrden } from "./formato-orden"
import type { Herramienta } from "./tipos"

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const inputSchema = z.object({
  desde: fecha.optional(),
  hasta: fecha.optional(),
})

const NC_EMBED = NOTAS_CREDITO_APLICADO_EMBED.replace(/\s+\(/, "(")

export const resumenOrdenes: Herramienta = {
  definicion: {
    name: "resumen_ordenes",
    description:
      "Métricas de órdenes de servicio: cuántas ingresaron y cuántas se entregaron en un período (con el total facturado de las entregadas), y la foto de hoy: órdenes abiertas por estado, atrasadas y saldo pendiente de cobro. Si no se indica período, toma el mes en curso hasta hoy. Usala para \"¿cómo venimos este mes?\", \"¿cuántas órdenes entraron esta semana?\" o \"¿cuánto falta cobrar?\".",
    input_schema: {
      type: "object",
      properties: {
        desde: { type: "string", description: "Inicio del período (YYYY-MM-DD, inclusive)." },
        hasta: { type: "string", description: "Fin del período (YYYY-MM-DD, inclusive)." },
      },
      additionalProperties: false,
    },
    strict: true,
  },

  disponible: () => true,

  async ejecutar(input, ctx) {
    const f = inputSchema.parse(input)
    const hoy = todayInTimeZone(ctx.zonaHoraria)
    const desde = f.desde ?? `${hoy.slice(0, 8)}01`
    const hasta = f.hasta ?? hoy
    const rangoDesde = dayRangeUtc(desde, ctx.zonaHoraria).desde
    const rangoHasta = dayRangeUtc(hasta, ctx.zonaHoraria).hasta
    const ahora = new Date()

    const alcance = await alcanceListaOrdenes(ctx)
    // Cada consulta: organización + alcance de la lista + sus propios filtros.
    const conAlcance = (extra: (q: any) => any) => (q: any) => {
      let query = q.eq("organization_id", ctx.actor.organizationId)
      if (alcance.eq) query = query.eq(...alcance.eq)
      if (alcance.or) query = query.or(combinarOr(alcance.or))
      return extra(query)
    }

    const [ingresadas, entregadas, abiertas, conDeuda] = await Promise.all([
      fetchAllRows<{ id: string }>("ordenes_servicio", "id", conAlcance((q) =>
        q.gte("fecha_ingreso", rangoDesde).lte("fecha_ingreso", rangoHasta))),
      fetchAllRows<{ id: string; costo_final: number | null }>("ordenes_servicio", "id, costo_final", conAlcance((q) =>
        q.in("estado", [...ESTADOS_ENTREGADA]).gte("fecha_entrega", rangoDesde).lte("fecha_entrega", rangoHasta))),
      fetchAllRows<{ id: string; estado: EstadoOrden; fecha_prometida: string | null }>(
        "ordenes_servicio", "id, estado, fecha_prometida", conAlcance((q) => q.in("estado", [...ESTADOS_ABIERTOS]))),
      fetchAllRows<any>(
        "ordenes_servicio", `id, costo_final, total_cobrado, descuento_cobro, ${NC_EMBED}`, conAlcance((q) =>
          q.in("estado_cobro", [...COBRO_PENDIENTE_ESTADOS_COBRO])
            .in("estado", [...COBRO_PENDIENTE_ESTADOS_ORDEN])
            .gt("costo_final", 0))),
    ])

    const porEstado: Record<string, number> = {}
    for (const o of abiertas) {
      const etiqueta = ESTADO_LABELS[o.estado] ?? o.estado
      porEstado[etiqueta] = (porEstado[etiqueta] ?? 0) + 1
    }
    const atrasadas = abiertas.filter((o) => o.fecha_prometida && new Date(o.fecha_prometida) < ahora).length
    const facturado = entregadas.reduce((s, o) => s + Number(o.costo_final ?? 0), 0)
    const saldos = conDeuda.map((o) => saldoDeOrden(o) ?? 0).filter((s) => s > 0)

    return {
      datos: {
        moneda: ctx.moneda,
        periodo: { desde, hasta },
        enElPeriodo: {
          ingresadas: ingresadas.length,
          entregadas: entregadas.length,
          facturadoEntregadas: facturado,
        },
        hoy: {
          abiertas: abiertas.length,
          abiertasPorEstado: porEstado,
          atrasadas,
          ordenesConSaldo: saldos.length,
          saldoPendienteTotal: saldos.reduce((s, x) => s + x, 0),
        },
      },
      filas: ingresadas.length + entregadas.length + abiertas.length + conDeuda.length,
    }
  },
}
