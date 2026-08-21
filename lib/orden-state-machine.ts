import type { EstadoOrden } from "@/types"

// ============================================
// STATE MACHINE: Transiciones válidas de estado
// ============================================

/**
 * Mapa de transiciones permitidas desde cada estado.
 * Cada estado tiene una lista de estados a los que puede transicionar.
 */
export const TRANSICIONES_VALIDAS: Record<EstadoOrden, EstadoOrden[]> = {
  RECIBIDO: ["EN_DIAGNOSTICO", "PRESUPUESTADO", "EN_REPARACION", "CANCELADO", "SIN_REPARACION", "SIN_FALLA_DETECTADA", "ENTREGADO_SIN_COBRO"],
  EN_DIAGNOSTICO: ["PRESUPUESTADO", "EN_REPARACION", "CANCELADO", "SIN_REPARACION", "SIN_FALLA_DETECTADA", "ENTREGADO_SIN_COBRO"],
  PRESUPUESTADO: ["APROBADO", "EN_DIAGNOSTICO", "CANCELADO", "SIN_REPARACION"],
  APROBADO: ["EN_REPARACION", "CANCELADO"],
  EN_REPARACION: ["ESPERANDO_REPUESTO", "REPARADO", "CANCELADO", "SIN_REPARACION"],
  ESPERANDO_REPUESTO: ["EN_REPARACION", "REPARADO", "CANCELADO", "SIN_REPARACION"],
  REPARADO: ["ENTREGADO", "ENTREGADO_SIN_COBRO", "EN_REPARACION"], // Puede volver a reparación si se detecta falla
  ENTREGADO: [], // Estado terminal
  ENTREGADO_SIN_REPARACION: [], // Estado terminal - retirado sin reparar
  ENTREGADO_SIN_COBRO: [], // Estado terminal - entregado sin cobrar
  CANCELADO: ["RECIBIDO"], // Puede reactivarse
  SIN_REPARACION: ["RECIBIDO", "ENTREGADO_SIN_REPARACION", "ENTREGADO_SIN_COBRO"], // Puede reactivarse o retirarse
  SIN_FALLA_DETECTADA: ["RECIBIDO", "ENTREGADO", "ENTREGADO_SIN_COBRO"], // Reactivar, entregar con cobro (revisión) o sin cobro
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
  // EN_REPARACION no exige costo_final: se puede empezar a reparar sin un precio
  // definido (p. ej. reparaciones express que se cotizan al final). El costo se
  // vuelve obligatorio recién en REPARADO, y el cobro se auto-bloquea hasta que
  // exista un costo cargado.
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
// ENTREGA: derivación del estado terminal
// ============================================

/**
 * Estados terminales que solo se alcanzan por el flujo de entrega
 * (POST /api/ordenes/[id]/entregar), nunca por el PUT genérico: además del
 * cambio de estado registran fecha de entrega, firmas, cargo a cuenta corriente
 * y consumo de reservas.
 */
export const ESTADOS_ENTREGA: EstadoOrden[] = [
  "ENTREGADO",
  "ENTREGADO_SIN_REPARACION",
  "ENTREGADO_SIN_COBRO",
]

/**
 * Estados en los que costo_final ya cruzó el gate de CAMPOS_REQUERIDOS_POR_ESTADO
 * (ver REPARADO más arriba: exige costo_final > 0 para entrar) y por lo tanto no
 * puede volver a quedar en null/0: la comisión del técnico (monto_comision =
 * (costo_final - repuestos) * pct/100, migración 119), la cuenta corriente y la
 * entrega ya asumen que hay un precio cargado. REPARADO es el propio gate;
 * ESTADOS_ENTREGA son los estados terminales de entrega, siempre al mismo nivel
 * o más allá en el flujo de reparación.
 *
 * ESPECIFICACIÓN NORMATIVA de esta lista: supabase/migrations/301_servicios_orden_atomico.sql
 * hardcodea los mismos cuatro valores ('REPARADO', 'ENTREGADO', 'ENTREGADO_SIN_REPARACION',
 * 'ENTREGADO_SIN_COBRO') en el bloque "STATE GUARD" de agregar_servicio_orden y
 * eliminar_servicio_orden, porque esa migración corre en plpgsql y no puede importar
 * esta constante de TypeScript. CUALQUIER cambio acá DEBE reflejarse también ahí.
 */
export const ESTADOS_COSTO_FINAL_BLOQUEADO: EstadoOrden[] = ["REPARADO", ...ESTADOS_ENTREGA]

/**
 * El gemelo de ESTADOS_COSTO_FINAL_BLOQUEADO, del lado del presupuesto.
 *
 * PRESUPUESTADO exige `presupuesto > 0` para entrar (ver CAMPOS_REQUERIDOS_POR_ESTADO
 * más arriba), pero esa validación corre SOLO en la transición: nada impide que
 * una orden ya presupuestada se quede después sin presupuesto. Borrar la última
 * línea de servicio es justamente ese caso, y dejaría al cliente mirando un
 * presupuesto vacío en el portal público.
 *
 * ESPECIFICACIÓN NORMATIVA de esta lista: la migración que reimplementa la regla
 * de sincronización en plpgsql hardcodea el mismo valor en su bloque "STATE GUARD".
 * CUALQUIER cambio acá DEBE reflejarse también ahí.
 */
export const ESTADOS_PRESUPUESTO_BLOQUEADO: EstadoOrden[] = ["PRESUPUESTADO"]

/**
 * Deriva el estado de entrega a partir del estado actual y si la entrega es sin
 * cobro. Es la única fuente que traduce (estado, sinCobro) -> estado de entrega:
 * - sin cobro -> ENTREGADO_SIN_COBRO (tiene prioridad sobre el retiro)
 * - retiro (SIN_REPARACION con cobro) -> ENTREGADO_SIN_REPARACION
 * - resto -> ENTREGADO
 *
 * El estado derivado DEBE validarse con esTransicionValida() antes de aplicarlo:
 * la máquina de estados es la autoridad sobre qué orígenes pueden entregar, para
 * que backend, UI (dropdown) y esta derivación no diverjan.
 */
export function resolverEstadoEntrega(estadoActual: EstadoOrden, sinCobro: boolean): EstadoOrden {
  if (sinCobro) return "ENTREGADO_SIN_COBRO"
  if (estadoActual === "SIN_REPARACION") return "ENTREGADO_SIN_REPARACION"
  return "ENTREGADO"
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
  ENTREGADO_SIN_REPARACION: "Retirado sin Reparación",
  ENTREGADO_SIN_COBRO: "Entregado sin Cobro",
  CANCELADO: "Cancelado",
  SIN_REPARACION: "Sin Reparación",
  SIN_FALLA_DETECTADA: "Sin Falla Detectada",
}
