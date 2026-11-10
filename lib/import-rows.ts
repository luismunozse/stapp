import type { ParsedRow, ParseResult } from './csv-parser'
import { validateClienteRow, validateInventarioRow, type ValidationResult } from './csv-validator'

/** How many invalid rows the preview lists. The total is always reported. */
export const MAX_REPORTED_INVALID_ROWS = 100

const MAX_CELL_CHARS = 200

/**
 * Copy of a row safe to send back to the browser / store in history: a broken
 * quote can leave one cell holding the rest of the file.
 */
export function compactRow(row: ParsedRow): ParsedRow {
  const out: ParsedRow = {}
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === 'string' && v.length > MAX_CELL_CHARS ? `${v.slice(0, MAX_CELL_CHARS)}…` : v
  }
  return out
}

export type ImportEntity = 'CLIENTES' | 'INVENTARIO'

export interface RowValidation {
  /** Position in the parsed data. */
  index: number
  /** Spreadsheet line (header = 1), the same number the user sees in Excel/Sheets. */
  rowNumber: number
  row: ParsedRow
  validation: ValidationResult
}

/**
 * Validates every row once, with ONE numbering scheme, for both /preview and
 * /execute. Rows the parser could not even split (extra columns, broken quotes)
 * come back as invalid rows rather than aborting the file.
 */
export function validateImportRows(
  rows: ParsedRow[],
  parsed: Pick<ParseResult, 'rowNumbers' | 'rowErrors'>,
  entityType: ImportEntity,
): RowValidation[] {
  const structural = new Map(parsed.rowErrors.map(e => [e.index, e.message]))

  return rows.map((row, index) => {
    const rowNumber = parsed.rowNumbers[index] ?? index + 2
    const parseMessage = structural.get(index)
    if (parseMessage) {
      return {
        index,
        rowNumber,
        row,
        validation: { valid: false, error: `Fila ${rowNumber}: ${parseMessage}`, message: parseMessage },
      }
    }
    const validation = entityType === 'CLIENTES'
      ? validateClienteRow(row, index, rowNumber)
      : validateInventarioRow(row, index, rowNumber)
    return { index, rowNumber, row, validation }
  })
}

export interface InvalidRowDetail {
  row: number
  error: string
  column?: string
}

/** Invalid rows in file order, capped; `total` is the uncapped count. */
export function collectInvalidRows(
  checked: RowValidation[],
  cap: number = MAX_REPORTED_INVALID_ROWS,
): { total: number; details: InvalidRowDetail[] } {
  const details: InvalidRowDetail[] = []
  let total = 0
  for (const c of checked) {
    if (c.validation.valid) continue
    total++
    if (details.length < cap) {
      details.push({
        row: c.rowNumber,
        error: c.validation.message ?? c.validation.error ?? 'Error de validación',
        ...(c.validation.column ? { column: c.validation.column } : {}),
      })
    }
  }
  return { total, details }
}
