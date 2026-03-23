import type { EstadoOrden } from "@/types"

// ============================================
// STATE MACHINE: Transiciones válidas de estado
// ============================================

/**
 * Mapa de transiciones permitidas desde cada estado.
 * Cada estado tiene una lista de estados a los que puede transicionar.
 */
export const TRANSICIONES_VALIDAS: Record<EstadoOrden, EstadoOrden[]> = {
  RECIBIDO: ["EN_DIAGNOSTICO", "PRESUPUESTADO", "EN_REPARACION", "CANCELADO", "SIN_REPARACION"],
  EN_DIAGNOSTICO: ["PRESUPUESTADO", "EN_REPARACION", "CANCELADO", "SIN_REPARACION"],
  PRESUPUESTADO: ["APROBADO", "CANCELADO", "SIN_REPARACION"],
  APROBADO: ["EN_REPARACION", "CANCELADO"],
  EN_REPARACION: ["ESPERANDO_REPUESTO", "REPARADO", "CANCELADO", "SIN_REPARACION"],
  ESPERANDO_REPUESTO: ["EN_REPARACION", "REPARADO", "CANCELADO", "SIN_REPARACION"],
  REPARADO: ["ENTREGADO", "EN_REPARACION"], // Puede volver a reparación si se detecta falla
  ENTREGADO: [], // Estado terminal
  CANCELADO: ["RECIBIDO"], // Puede reactivarse
  SIN_REPARACION: ["RECIBIDO"], // Puede reactivarse
}

/**
 * Valida si una transición de estado es permitida.
 */
export function esTransicionValida(estadoActual: EstadoOrden, estadoNuevo: EstadoOrden): boolean {
  if (estadoActual === estadoNuevo) return true // Mismo estado = no cambio
  return TRANSICIONES_VALIDAS[estadoActual]?.includes(estadoNuevo) ?? false
}

/**
 * Obtiene los estados a los que se puede transicionar desde el estado actual.
 */
export function getTransicionesPosibles(estadoActual: EstadoOrden): EstadoOrden[] {
  return TRANSICIONES_VALIDAS[estadoActual] || []
}

/**
 * Mensaje de error descriptivo para transición inválida.
 */
export function getMensajeTransicionInvalida(estadoActual: EstadoOrden, estadoNuevo: EstadoOrden): string {
  const posibles = TRANSICIONES_VALIDAS[estadoActual]
  if (!posibles || posibles.length === 0) {
    return `La orden en estado "${estadoActual}" no puede cambiar de estado.`
  }
  return `No se puede cambiar de "${estadoActual}" a "${estadoNuevo}". Transiciones permitidas: ${posibles.join(", ")}.`
}

// ============================================
// CAMPOS REQUERIDOS POR ESTADO
// ============================================

/**
 * Define qué campos de la orden deben estar presentes
 * para poder transicionar a cada estado.
 */
export const CAMPOS_REQUERIDOS_POR_ESTADO: Partial<Record<EstadoOrden, {
  campo: string
  label: string
  validar: (orden: Record<string, any>) => boolean
}[]>> = {
  PRESUPUESTADO: [
    {
      campo: "presupuesto",
      label: "Presupuesto",
      validar: (o) => o.presupuesto != null && o.presupuesto > 0,
    },
  ],
  EN_REPARACION: [
    {
      campo: "tecnico_id",
      label: "Técnico asignado",
      validar: (o) => !!o.tecnico_id,
    },
  ],
  REPARADO: [
    {
      campo: "costo_final",
      label: "Costo final",
      validar: (o) => o.costo_final != null && parseFloat(o.costo_final) > 0,
    },
  ],
}

/**
 * Valida que los campos requeridos estén presentes para transicionar a un estado.
 * Retorna null si es válido, o un mensaje de error si no.
 */
export function validarCamposRequeridos(
  estadoNuevo: EstadoOrden,
  orden: Record<string, any>
): string | null {
  const requeridos = CAMPOS_REQUERIDOS_POR_ESTADO[estadoNuevo]
  if (!requeridos) return null

  const faltantes = requeridos.filter((r) => !r.validar(orden))
  if (faltantes.length === 0) return null

  return `Para cambiar a "${estadoNuevo}" se requiere: ${faltantes.map((f) => f.label).join(", ")}.`
}

// ============================================
// LABELS Y HELPERS DE UI
// ============================================

export const ESTADO_LABELS: Record<EstadoOrden, string> = {
  RECIBIDO: "Recibido",
  EN_DIAGNOSTICO: "En Diagnóstico",
  PRESUPUESTADO: "Presupuestado",
  APROBADO: "Aprobado",
  EN_REPARACION: "En Reparación",
  ESPERANDO_REPUESTO: "Esperando Repuesto",
  REPARADO: "Reparado",
  ENTREGADO: "Entregado",
  CANCELADO: "Cancelado",
  SIN_REPARACION: "Sin Reparación",
}
