/**
 * El único parser de montos (y de números localizados en general) de la app.
 *
 * Lo usan `<MoneyInput>` (POS, caja, pagos), la importación CSV/Excel y
 * "Actualizar precios". Antes había dos: uno laxo para los inputs (con
 * `parseFloat`, que lee "12abc" como 12 y "0.500" como 500) y otro estricto
 * para las importaciones. Quedó solo el estricto.
 *
 * Acepta las dos convenciones y resuelve la ambigüedad con la argentina:
 *
 *   "1.500"      -> 1500      (un punto seguido de exactamente 3 dígitos es de miles)
 *   "12.000"     -> 12000
 *   "1.500,50"   -> 1500.5
 *   "1500,50"    -> 1500.5
 *   "1500.50"    -> 1500.5
 *   "1,234.56"   -> 1234.56   (con los dos separadores, el ÚLTIMO es el decimal)
 *   "1,234"      -> 1.234     (una coma sola es SIEMPRE decimal)
 *   "$ 1.500"    -> 1500
 *
 * Los símbolos de moneda se aceptan solo como prefijo o sufijo, y los espacios
 * solo como separador de miles ("1 500"): "10 USD 20" o "12 34" son errores, no
 * 1020 / 1234.
 *
 * Todo lo que no sea un número sin ambigüedad devuelve `null` ("1.5.0",
 * "12abc", "1e5", "-", ""). Adivinar en silencio es justamente como los
 * precios terminaban 1000 veces más chicos.
 *
 * Los números nativos (celdas de Excel) pasan tal cual si son finitos.
 */

// Marcas de moneda que pueden envolver un monto (solo prefijo o sufijo).
const CURRENCY = String.raw`u\$s|us\$|ar\$|\$|ars|usd|eur|clp|€`
const CURRENCY_PREFIX = new RegExp(String.raw`^(?:${CURRENCY})\s*`, "i")
const CURRENCY_SUFFIX = new RegExp(String.raw`\s*(?:${CURRENCY})$`, "i")

const THOUSANDS_DOT = /^\d{1,3}(\.\d{3})+$/
const THOUSANDS_COMMA = /^\d{1,3}(,\d{3})+$/

/** "1.500": 1-3 dígitos adelante (no solo ceros) y exactamente 3 después del separador. */
function looksLikeThousands(before: string, after: string): boolean {
  return after.length === 3 && before.length >= 1 && before.length <= 3 && !/^0+$/.test(before)
}

export function parseMonto(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null
  if (typeof raw !== "string") return null

  const cleaned = raw
    .trim()
    .replace(CURRENCY_PREFIX, "")
    .replace(CURRENCY_SUFFIX, "")
    .trim()
    // Espacios solo como separador de miles: "1 500" -> "1500", pero "12 34" sigue siendo inválido.
    .replace(/(\d)\s(?=\d{3}(?:\D|$))/g, "$1")
  const match = /^([+-]?)([\d.,]*\d[\d.,]*)$/.exec(cleaned)
  if (!match) return null
  const sign = match[1] === "-" ? "-" : ""
  const body = match[2]

  const dots = body.split(".").length - 1
  const commas = body.split(",").length - 1
  let normalized: string

  if (dots > 0 && commas > 0) {
    // Los dos presentes: el último es el decimal y el otro agrupa miles.
    const decimalIsComma = body.lastIndexOf(",") > body.lastIndexOf(".")
    const decimalSep = decimalIsComma ? "," : "."
    const thousandsRe = decimalIsComma ? THOUSANDS_DOT : THOUSANDS_COMMA
    const at = body.lastIndexOf(decimalSep)
    const intPart = body.slice(0, at)
    const decPart = body.slice(at + 1)
    if (!thousandsRe.test(intPart) || !/^\d*$/.test(decPart)) return null
    normalized = `${intPart.replace(/[.,]/g, "")}.${decPart}`
  } else if (commas > 0) {
    if (commas > 1) {
      if (!THOUSANDS_COMMA.test(body)) return null
      normalized = body.replace(/,/g, "")
    } else {
      // Una coma sola es el decimal argentino: "1,125" = 1.125.
      const [before, after] = body.split(",")
      normalized = `${before || "0"}.${after}`
    }
  } else if (dots > 0) {
    if (dots > 1) {
      if (!THOUSANDS_DOT.test(body)) return null
      normalized = body.replace(/\./g, "")
    } else {
      const [before, after] = body.split(".")
      normalized = looksLikeThousands(before, after) ? before + after : `${before || "0"}.${after}`
    }
  } else {
    normalized = body
  }

  const n = Number.parseFloat(sign + normalized)
  return Number.isFinite(n) ? n : null
}

/**
 * Igual que `parseMonto`, pero devuelve `NaN` en vez de `null` para lo vacío o
 * inválido (el contrato de `parseFloat`).
 *
 * @deprecated Para inputs nuevos usá `<MoneyInput>` (components/ui/money-input)
 * y para parsear, `parseMonto`. Queda para los formularios que todavía no se
 * migraron (orden, cotizaciones, inventario, onboarding).
 */
export function parseMoneyInput(raw: string | number | null | undefined): number {
  return parseMonto(raw) ?? NaN
}

const formatoMonto = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
  useGrouping: true,
})

/**
 * Texto canónico de un monto para un input: "1.234,56", "1.500", "0,5".
 * `parseMonto(formatMontoInput(n)) === n` para cualquier n con hasta 2 decimales.
 */
export function formatMontoInput(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return ""
  return formatoMonto.format(n)
}
