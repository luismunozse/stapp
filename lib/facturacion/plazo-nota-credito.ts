/**
 * Plazo de la nota de crédito (RG 4540): hasta 15 días corridos desde la fecha de
 * la factura. STApp solo AVISA cuando se pasó: ni el servidor ni la pantalla
 * bloquean la anulación por antigüedad.
 *
 * Los días se cuentan con fechas de Argentina (`lib/timezone`): un servidor en UTC
 * no puede adelantar ni atrasar el día del taller. Módulo client-safe: lo usan la
 * ruta de anulación y el diálogo de confirmación.
 */

import { DEFAULT_TIMEZONE, todayInTimeZone } from "@/lib/timezone"

export const PLAZO_NOTA_CREDITO_DIAS = 15

const MS_POR_DIA = 24 * 60 * 60 * 1000

/** `AAAA-MM-DD` (con o sin hora) o `AAAAMMDD` -> instante UTC de ese día, o `null` si no existe. */
function diaUtc(fecha: string | null | undefined): number | null {
  const texto = (fecha ?? "").trim()
  const partes = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(texto) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(texto)
  if (!partes) return null

  const [anio, mes, dia] = [Number(partes[1]), Number(partes[2]), Number(partes[3])]
  const instante = Date.UTC(anio, mes - 1, dia)
  const fechado = new Date(instante)
  // `Date.UTC` normaliza el 30 de febrero al 2 de marzo: se exige que el día exista.
  if (fechado.getUTCFullYear() !== anio || fechado.getUTCMonth() !== mes - 1 || fechado.getUTCDate() !== dia) {
    return null
  }
  return instante
}

/**
 * Días corridos entre la fecha de emisión de la factura y hoy (día argentino),
 * o `null` si la fecha no se puede leer. Una fecha futura da un número negativo.
 */
export function diasDesdeEmision(fechaEmision: string | null | undefined, now: Date = new Date()): number | null {
  const emision = diaUtc(fechaEmision)
  const hoy = diaUtc(todayInTimeZone(DEFAULT_TIMEZONE, now))
  if (emision === null || hoy === null) return null
  return Math.round((hoy - emision) / MS_POR_DIA)
}

/** `true` a partir del día 16. Sin fecha legible no se afirma que venció. */
export function excedePlazoNotaCredito(dias: number | null): boolean {
  return dias !== null && dias > PLAZO_NOTA_CREDITO_DIAS
}
