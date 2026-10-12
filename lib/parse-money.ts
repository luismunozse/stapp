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
 * - Puntos que separan grupos de exactamente tres dígitos, sin decimales
 *   ("1.500", "12.345.678"), son de miles: así escribe un monto un cajero
 *   es-AR. Antes "1.500" se leía como 1,5 y el cobro de $1.500 quedaba en $1,50.
 * - En cualquier otro caso el punto es decimal (escritorio "1500.50", "1.5").
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
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    // Solo puntos de miles: "1.500" → 1500
    normalized = s.replace(/\./g, "")
  } else {
    // Sin coma: el punto (si lo hay) se trata como decimal.
    normalized = s
  }

  return parseFloat(normalized)
}
