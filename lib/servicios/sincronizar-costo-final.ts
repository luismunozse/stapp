/**
 * Regla de sincronización entre las líneas de servicio de una orden y su costo_final.
 *
 * Principio: automático mientras nadie pagó nada; explícito cuando ya hay dinero
 * en el medio. Si el cliente ya puso plata, mover el total en silencio cambia lo
 * que debe sin que nadie lo decida, así que ahí decide el humano desde la UI.
 *
 * costo_final sigue siendo la única fuente de ingreso de la orden. Esta función
 * solo decide si se actualiza; la escritura la hace el route handler, y el
 * recálculo de estado_cobro lo cubre el trigger de la migración 277.
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
