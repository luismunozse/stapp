/**
 * Single number parser shared by every import path (CSV/Excel import and
 * "Actualizar precios").
 *
 * Accepts both locale conventions and resolves ambiguity with the Argentine one:
 *
 *   "1.500"      -> 1500      (a lone dot followed by exactly 3 digits is thousands)
 *   "12.000"     -> 12000
 *   "1.500,50"   -> 1500.5
 *   "1500,50"    -> 1500.5
 *   "1500.50"    -> 1500.5
 *   "1,234.56"   -> 1234.56   (the LAST separator is the decimal one)
 *   "1,234"      -> 1.234    (a lone comma is ALWAYS the decimal separator)
 *   "$ 1.500"    -> 1500
 *
 * Currency markers are accepted only as a prefix or suffix, and spaces only as
 * thousands grouping ("1 500"); "10 USD 20" or "12 34" are errors, not 1020 / 1234.
 *
 * Anything that is not unambiguously a number returns `null` ("1.5.0", "12abc",
 * "1e5", ...). Callers must turn that into an explicit per-row error: guessing
 * silently is exactly how prices used to land 1000x too small.
 *
 * Native numbers (Excel cells) pass through untouched.
 */

// Currency markers that may wrap a price (prefix or suffix only).
const CURRENCY = String.raw`u\$s|us\$|ar\$|\$|ars|usd|eur|clp|€`
const CURRENCY_PREFIX = new RegExp(String.raw`^(?:${CURRENCY})\s*`, 'i')
const CURRENCY_SUFFIX = new RegExp(String.raw`\s*(?:${CURRENCY})$`, 'i')

const THOUSANDS_DOT = /^\d{1,3}(\.\d{3})+$/
const THOUSANDS_COMMA = /^\d{1,3}(,\d{3})+$/

/** "1.500": 1-3 leading digits (not just zeros) and exactly 3 after the separator. */
function looksLikeThousands(before: string, after: string): boolean {
  return after.length === 3 && before.length >= 1 && before.length <= 3 && !/^0+$/.test(before)
}

export function parseLocalizedNumber(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null

  const cleaned = raw
    .trim()
    .replace(CURRENCY_PREFIX, '')
    .replace(CURRENCY_SUFFIX, '')
    .trim()
    // Spaces only as thousands grouping: "1 500" -> "1500", but "12 34" stays invalid.
    .replace(/(\d)\s(?=\d{3}(?:\D|$))/g, '$1')
  const match = /^([+-]?)([\d.,]*\d[\d.,]*)$/.exec(cleaned)
  if (!match) return null
  const sign = match[1] === '-' ? '-' : ''
  const body = match[2]

  const dots = body.split('.').length - 1
  const commas = body.split(',').length - 1
  let normalized: string

  if (dots > 0 && commas > 0) {
    // Both present: the last one is the decimal separator, the other one groups thousands.
    const decimalIsComma = body.lastIndexOf(',') > body.lastIndexOf('.')
    const decimalSep = decimalIsComma ? ',' : '.'
    const thousandsRe = decimalIsComma ? THOUSANDS_DOT : THOUSANDS_COMMA
    const at = body.lastIndexOf(decimalSep)
    const intPart = body.slice(0, at)
    const decPart = body.slice(at + 1)
    if (!thousandsRe.test(intPart) || !/^\d+$/.test(decPart)) return null
    normalized = `${intPart.replace(/[.,]/g, '')}.${decPart}`
  } else if (commas > 0) {
    if (commas > 1) {
      if (!THOUSANDS_COMMA.test(body)) return null
      normalized = body.replace(/,/g, '')
    } else {
      // A lone comma is the Argentine decimal separator: "1,125" = 1.125.
      const [before, after] = body.split(',')
      normalized = `${before || '0'}.${after}`
    }
  } else if (dots > 0) {
    if (dots > 1) {
      if (!THOUSANDS_DOT.test(body)) return null
      normalized = body.replace(/\./g, '')
    } else {
      const [before, after] = body.split('.')
      normalized = looksLikeThousands(before, after) ? before + after : `${before || '0'}.${after}`
    }
  } else {
    normalized = body
  }

  const n = Number.parseFloat(sign + normalized)
  return Number.isFinite(n) ? n : null
}
