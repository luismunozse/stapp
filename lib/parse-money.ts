/**
 * Parsea un monto ingresado por el usuario a número, normalizando el formato
 * es-AR (coma decimal, punto de miles).
 *
 * Motivo: en inputs `type="text" inputMode="decimal"`, los teclados es-AR (sobre
 * todo Android) emiten coma como separador decimal. `parseFloat("1500,50")`
 * devuelve 1500 (trunca en la coma) y `parseFloat("1.500,50")` devuelve 1.5,
 * perdiendo plata silenciosamente. Este helper lo resuelve.
 *
 * Reglas:
 * - Si hay coma, la coma es el separador decimal; los puntos son de miles.
 * - Si sólo hay puntos (o nada), se interpreta el punto como decimal (comportamiento
 *   estándar de `parseFloat`, p.ej. escritorio "1500.50").
 *
 * Devuelve `NaN` para entradas vacías o no numéricas (igual que `parseFloat`),
 * de modo que los llamadores puedan seguir validando con `isNaN`.
 */
export function parseMoneyInput(raw: string | number | null | undefined): number {
  if (typeof raw === "number") return raw

  const s = String(raw ?? "").trim()
  if (!s) return NaN

  let normalized: string
  if (s.includes(",")) {
    // Coma = decimal → quitar puntos (miles) y convertir la coma a punto.
    normalized = s.replace(/\./g, "").replace(",", ".")
  } else {
    // Sin coma: el punto (si lo hay) se trata como decimal.
    normalized = s
  }

  return parseFloat(normalized)
}
