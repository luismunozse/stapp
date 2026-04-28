import type { EstadoOrden } from "@/types"

// Estados donde la orden está activa (en proceso)
export const ESTADOS_ACTIVOS: EstadoOrden[] = [
  "RECIBIDO",
  "EN_DIAGNOSTICO",
  "PRESUPUESTADO",
  "APROBADO",
  "EN_REPARACION",
  "ESPERANDO_REPUESTO",
]

// Estados donde la orden fue completada exitosamente
export const ESTADOS_COMPLETADOS: EstadoOrden[] = ["REPARADO", "ENTREGADO"]

// Estados terminales (no activos)
export const ESTADOS_TERMINALES: EstadoOrden[] = [
  "REPARADO",
  "ENTREGADO",
  "ENTREGADO_SIN_REPARACION",
  "ENTREGADO_SIN_COBRO",
  "CANCELADO",
  "SIN_REPARACION",
]
