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
 * regla. supabase/migrations/284_servicios_orden_atomico.sql la reimplementa en
 * plpgsql dentro de agregar_servicio_orden y eliminar_servicio_orden, porque el
 * lock (SELECT ... FOR UPDATE) que evita la condición de carrera solo existe
 * dentro de la transacción del RPC, así que la decisión tiene que evaluarse ahí
 * adentro y no acá. CUALQUIER cambio a esta función DEBE aplicarse también al
 * bloque "SYNC RULE" de ambas funciones en la migración 284.
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
