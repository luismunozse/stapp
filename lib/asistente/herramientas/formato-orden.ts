import { pendienteOrden, aplicadoNotasCreditoDeOrden, NOTAS_CREDITO_APLICADO_EMBED } from "@/lib/ordenes/pendiente"
import { ESTADO_LABELS } from "@/lib/orden-state-machine"
import { ESTADOS_ACTIVOS } from "@/lib/ordenes/filtros-url"
import type { EstadoOrden } from "@/types"

/** Órdenes todavía en el taller: las activas más las reparadas que esperan entrega. */
export const ESTADOS_ABIERTOS: readonly EstadoOrden[] = [...ESTADOS_ACTIVOS, "REPARADO"]

export const ESTADOS_ENTREGADA: readonly EstadoOrden[] = ["ENTREGADO", "ENTREGADO_SIN_REPARACION", "ENTREGADO_SIN_COBRO"]

/** Las columnas de una orden en un listado del asistente. Sin espacios dentro de los embeds. */
export const SELECT_ORDEN_LISTA = [
  "id, numero_orden, codigo_orden, estado, tipo_dispositivo, dispositivo, marca",
  "fecha_ingreso, fecha_prometida, costo_final, total_cobrado, descuento_cobro, estado_cobro",
  "clientes(nombre)",
  "users:tecnico_id(nombre)",
  NOTAS_CREDITO_APLICADO_EMBED.replace(/\s+\(/, "("),
].join(", ")

export function saldoDeOrden(o: any): number | null {
  if (o.costo_final == null) return null
  return pendienteOrden({
    costoFinal: Number(o.costo_final ?? 0),
    descuentoCobro: Number(o.descuento_cobro ?? 0),
    totalCobrado: Number(o.total_cobrado ?? 0),
    aplicadoNotasCredito: aplicadoNotasCreditoDeOrden(o),
  })
}

/** Una orden resumida para el modelo: lo justo para listar, con el link a su detalle. */
export function ordenResumida(o: any, ahora: Date = new Date()) {
  const abierta = ESTADOS_ABIERTOS.includes(o.estado)
  return {
    numero: o.numero_orden,
    codigo: o.codigo_orden,
    link: `/ordenes/${o.id}`,
    estado: ESTADO_LABELS[o.estado as EstadoOrden] ?? o.estado,
    equipo: [o.tipo_dispositivo, o.marca, o.dispositivo].filter(Boolean).join(" · "),
    cliente: o.clientes?.nombre ?? null,
    tecnico: o.users?.nombre ?? "Sin asignar",
    fechaIngreso: o.fecha_ingreso ?? null,
    fechaPrometida: o.fecha_prometida ?? null,
    atrasada: abierta && !!o.fecha_prometida && new Date(o.fecha_prometida) < ahora,
    saldoPendiente: saldoDeOrden(o),
  }
}
