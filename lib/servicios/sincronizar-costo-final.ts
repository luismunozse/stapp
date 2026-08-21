import { ESTADOS_COSTO_FINAL_BLOQUEADO, ESTADOS_PRESUPUESTO_BLOQUEADO } from "@/lib/orden-state-machine"

/**
 * Regla de sincronización entre las líneas de servicio de una orden y su costo_final.
 *
 * Principio: automático mientras nadie pagó nada; explícito cuando ya hay dinero
 * en el medio. Si el cliente ya puso plata, mover el total en silencio cambia lo
 * que debe sin que nadie lo decida, así que ahí decide el humano desde la UI.
 *
 * costo_final sigue siendo la única fuente de ingreso de la orden. El recálculo
 * de estado_cobro lo cubre el trigger de la migración 277.
 *
 * ESPECIFICACIÓN NORMATIVA: esta función (junto con sus 8 tests en
 * __tests__/lib/sincronizar-costo-final.test.ts) es la fuente de verdad de la
 * regla. supabase/migrations/301_servicios_orden_atomico.sql la reimplementa en
 * plpgsql dentro de agregar_servicio_orden y eliminar_servicio_orden, porque el
 * lock (SELECT ... FOR UPDATE) que evita la condición de carrera solo existe
 * dentro de la transacción del RPC, así que la decisión tiene que evaluarse ahí
 * adentro y no acá. CUALQUIER cambio a esta función DEBE aplicarse también al
 * bloque "SYNC RULE" de ambas funciones en la migración 301.
 */

/** Tolerancia de comparación: costo_final es DECIMAL(10,2). */
const EPSILON = 0.005

function aNumero(valor: number | string | null): number {
  if (valor === null || valor === undefined) return 0
  const n = typeof valor === "string" ? parseFloat(valor) : valor
  return Number.isFinite(n) ? n : 0
}

export function calcularCostoFinalSincronizado(input: {
  costoFinalActual: number | string | null
  totalCobrado: number | string | null
  sumaAnterior: number
  sumaNueva: number
}): { debeActualizar: boolean; nuevoCostoFinal: number | null } {
  const sinActualizar = { debeActualizar: false, nuevoCostoFinal: null }

  // Ya hay dinero cobrado: no se toca el total automáticamente.
  if (aNumero(input.totalCobrado) > 0) return sinActualizar

  const costoEstabaVacio = input.costoFinalActual === null || input.costoFinalActual === undefined
  const costoSeguiaALasLineas =
    !costoEstabaVacio &&
    Math.abs(aNumero(input.costoFinalActual) - input.sumaAnterior) < EPSILON

  // El costo fue editado a mano: no se pisa.
  if (!costoEstabaVacio && !costoSeguiaALasLineas) return sinActualizar

  // Se eliminó la última línea. NULL, no 0: significa "sin precio definido",
  // igual que hace reject-budget/route.ts:41. Además deja lista la rama de
  // autocompletado para el próximo alta.
  if (input.sumaNueva <= 0) {
    return { debeActualizar: true, nuevoCostoFinal: null }
  }

  return { debeActualizar: true, nuevoCostoFinal: Math.round(input.sumaNueva * 100) / 100 }
}

/**
 * Qué monto de la orden alimentan las líneas de servicio, según el estado.
 *
 * Una orden tiene dos números y solo uno está vivo por vez. Antes de que el
 * cliente apruebe, el que importa es `presupuesto`: es lo que ve en el portal y
 * lo que exige la transición a PRESUPUESTADO. Desde APROBADO en adelante el
 * número vivo es `costo_final`, de donde salen el cobro y la comisión.
 *
 * El corte está en APROBADO y no más adelante porque ahí el presupuesto ya lo
 * aceptó el cliente: seguir moviéndolo sería alterar un número acordado.
 *
 * En los estados terminales no se sincroniza nada. Las líneas se siguen viendo y
 * el botón "Aplicar al total" sigue disponible para la corrección manual.
 *
 * ESPECIFICACIÓN NORMATIVA: igual que calcularCostoFinalSincronizado, esta
 * función se reimplementa en plpgsql dentro de los RPCs. CUALQUIER cambio acá
 * DEBE aplicarse también al bloque "SYNC RULE" de ambas funciones.
 */
export type CampoSincronizado = "presupuesto" | "costo_final"

const ESTADOS_PRESUPUESTO: string[] = ["RECIBIDO", "EN_DIAGNOSTICO", "PRESUPUESTADO"]
const ESTADOS_COSTO_FINAL: string[] = ["APROBADO", "EN_REPARACION", "ESPERANDO_REPUESTO", "REPARADO"]

/** Estados en los que el monto ya cruzó su gate y no puede volver a null/0. */
const BLOQUEADO_POR_CAMPO: Record<CampoSincronizado, string[]> = {
  presupuesto: ESTADOS_PRESUPUESTO_BLOQUEADO,
  costo_final: ESTADOS_COSTO_FINAL_BLOQUEADO,
}

export function campoSincronizadoPara(estado: string): CampoSincronizado | null {
  if (ESTADOS_PRESUPUESTO.includes(estado)) return "presupuesto"
  if (ESTADOS_COSTO_FINAL.includes(estado)) return "costo_final"
  return null
}

export function calcularMontoSincronizado(input: {
  estado: string
  presupuestoActual: number | string | null
  costoFinalActual: number | string | null
  totalCobrado: number | string | null
  sumaAnterior: number
  sumaNueva: number
}): {
  debeActualizar: boolean
  campo: CampoSincronizado | null
  nuevoMonto: number | null
  /**
   * Hasta la migración 303 la sincronización escribía SIEMPRE costo_final. Una
   * orden anterior a APROBADO puede arrastrar un costo_final de esa época que la
   * regla nueva ya no gobierna. Si nadie lo limpia queda esperando a que alguien
   * lleve la orden a REPARADO, y ahí pasa a ser lo que se le cobra al cliente:
   * el precio de una línea que quizás ya no existe.
   *
   * Solo se marca cuando ese costo_final COINCIDE con la suma de líneas
   * anterior. Esa coincidencia es la huella de la regla vieja; un número tipeado
   * por una persona no coincide y no se toca.
   */
  limpiarCostoFinalHuerfano: boolean
} {
  const sinActualizar = {
    debeActualizar: false,
    campo: null,
    nuevoMonto: null,
    limpiarCostoFinalHuerfano: false,
  }

  const campo = campoSincronizadoPara(input.estado)
  if (!campo) return sinActualizar

  // La decisión de "cobrado / editado a mano / última línea" es la misma para
  // los dos montos: se evalúa sobre el campo vivo, no sobre el otro.
  const valorActual = campo === "presupuesto" ? input.presupuestoActual : input.costoFinalActual
  const decision = calcularCostoFinalSincronizado({
    costoFinalActual: valorActual,
    totalCobrado: input.totalCobrado,
    sumaAnterior: input.sumaAnterior,
    sumaNueva: input.sumaNueva,
  })

  if (!decision.debeActualizar) return sinActualizar

  const costoFinalEsHuerfano =
    campo === "presupuesto" &&
    input.costoFinalActual !== null &&
    input.costoFinalActual !== undefined &&
    Math.abs(aNumero(input.costoFinalActual) - input.sumaAnterior) < EPSILON

  // STATE GUARD: la orden ya cruzó el gate de este campo, así que no la dejamos
  // sin monto en automático. La UI muestra el banner de "Aplicar al total".
  const vaciaElMonto = decision.nuevoCostoFinal === null || decision.nuevoCostoFinal === 0
  if (vaciaElMonto && BLOQUEADO_POR_CAMPO[campo].includes(input.estado)) return sinActualizar

  return {
    debeActualizar: true,
    campo,
    nuevoMonto: decision.nuevoCostoFinal,
    limpiarCostoFinalHuerfano: costoFinalEsHuerfano,
  }
}

/**
 * Si el botón "Aplicar al total" puede escribir la suma en el monto vivo.
 *
 * Escribir a mano no puede saltearse los gates que respeta la sincronización
 * automática: dejar en null el costo_final de una orden ya REPARADA hace que
 * `entregar` lea pendiente = 0, saltee `cargar_deuda_cuenta_corriente`, y la
 * deuda desaparezca de la orden, de la cuenta corriente, del cálculo de deuda
 * del cliente y del widget de caja.
 */
export function puedeAplicarMonto(input: {
  estado: string
  suma: number
  totalCobrado: number | string | null
}): { ok: boolean; error?: string } {
  const campo = campoSincronizadoPara(input.estado)

  if (!campo) {
    return { ok: false, error: "La orden está en un estado terminal: su monto ya no se sincroniza" }
  }

  if (input.suma <= 0 && BLOQUEADO_POR_CAMPO[campo].includes(input.estado)) {
    return {
      ok: false,
      error:
        campo === "presupuesto"
          ? "La orden ya fue presupuestada: no puede quedar sin presupuesto"
          : "La orden ya fue reparada: no puede quedar sin costo final",
    }
  }

  // Solo del lado del costo final: el presupuesto no es lo que se cobra.
  if (campo === "costo_final" && input.suma < aNumero(input.totalCobrado)) {
    return { ok: false, error: "El total de servicios es menor a lo ya cobrado en esta orden" }
  }

  return { ok: true }
}
