import ExcelJS from "exceljs"

export type Cell = string | number | null

export interface SheetPreview {
  name: string
  totalRows: number
  rows: Cell[][] // first N raw rows for header picker
}

function resolveCell(value: ExcelJS.CellValue): Cell {
  if (value === null || value === undefined) return null
  if (typeof value === "number" || typeof value === "string") return value
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE"
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "object" && "result" in value) {
    return resolveCell((value as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue)
  }
  if (typeof value === "object" && "richText" in value) {
    return (value as ExcelJS.CellRichTextValue).richText.map((rt) => rt.text).join("")
  }
  if (typeof value === "object" && "text" in value) {
    return String((value as ExcelJS.CellHyperlinkValue).text ?? "")
  }
  return String(value)
}

export async function loadWorkbook(base64: string): Promise<ExcelJS.Workbook> {
  const buffer = Buffer.from(base64, "base64")
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  )
  return workbook
}

export function readSheetRows(
  worksheet: ExcelJS.Worksheet,
  limit: number = Number.MAX_SAFE_INTEGER
): Cell[][] {
  const rows: Cell[][] = []
  let count = 0
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    if (count >= limit) return
    const values = (row.values as ExcelJS.CellValue[]).slice(1)
    rows.push(values.map(resolveCell))
    count++
  })
  return rows
}

export async function getSheetPreviews(base64: string, perSheetLimit = 30): Promise<SheetPreview[]> {
  const workbook = await loadWorkbook(base64)
  return workbook.worksheets.map((ws) => ({
    name: ws.name,
    totalRows: ws.rowCount,
    rows: readSheetRows(ws, perSheetLimit),
  }))
}

/**
 * Parse a price-like cell value into a number.
 * Handles: native numbers, "$1.234,56" (es-AR), "1,234.56" (en-US),
 * "1234,56", "1234.56", "$ 1234", with NBSP and stray spaces.
 * Returns null if value is empty or unparseable.
 */
export function parsePrice(raw: Cell): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === "number") {
    if (!isFinite(raw) || raw < 0) return null
    return Math.round(raw * 100) / 100
  }
  let s = String(raw).trim()
  if (!s) return null
  s = s.replace(/[$ \s]/g, "").replace(/[A-Za-z]/g, "")
  if (!s) return null

  const hasDot = s.includes(".")
  const hasComma = s.includes(",")
  let normalized = s
  if (hasDot && hasComma) {
    // last seen separator is the decimal one
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      normalized = s.replace(/\./g, "").replace(",", ".")
    } else {
      normalized = s.replace(/,/g, "")
    }
  } else if (hasComma) {
    // single comma: decimal if followed by 1-2 digits, else thousands
    const parts = s.split(",")
    const last = parts[parts.length - 1]
    if (parts.length === 2 && last.length <= 2) {
      normalized = s.replace(",", ".")
    } else {
      normalized = s.replace(/,/g, "")
    }
  } else if (hasDot) {
    // single dot or multiple dots
    const parts = s.split(".")
    const last = parts[parts.length - 1]
    if (parts.length > 2 || (parts.length === 2 && last.length === 3 && parts[0].length <= 3)) {
      // looks like thousands (e.g., 1.234 or 1.234.567)
      normalized = s.replace(/\./g, "")
    }
  }

  const n = parseFloat(normalized)
  if (!isFinite(n) || n < 0) return null
  return Math.round(n * 100) / 100
}

export function normalizeCodigo(raw: Cell): string {
  if (raw === null || raw === undefined) return ""
  return String(raw).trim()
}

export interface ColumnMapping {
  codigo?: number
  nombre?: number
  precioCompra?: number
  precioVenta?: number
}

export interface MappedRow {
  rowIndex: number // 0-based within data rows (excluding headers)
  codigo: string
  nombre: string
  precioCompra: number | null
  precioVenta: number | null
  errors: string[]
}

export function mapRows(
  rows: Cell[][],
  headerRow: number,
  mapping: ColumnMapping
): MappedRow[] {
  const dataRows = rows.slice(headerRow + 1)
  const out: MappedRow[] = []
  dataRows.forEach((row, idx) => {
    const errors: string[] = []
    const codigo = mapping.codigo != null ? normalizeCodigo(row[mapping.codigo]) : ""
    const nombre = mapping.nombre != null ? normalizeCodigo(row[mapping.nombre]) : ""
    let precioCompra: number | null = null
    let precioVenta: number | null = null
    if (mapping.precioCompra != null) {
      const v = row[mapping.precioCompra]
      if (v !== null && v !== "" && v !== undefined) {
        const p = parsePrice(v)
        if (p === null) errors.push(`precioCompra inválido: "${v}"`)
        else precioCompra = p
      }
    }
    if (mapping.precioVenta != null) {
      const v = row[mapping.precioVenta]
      if (v !== null && v !== "" && v !== undefined) {
        const p = parsePrice(v)
        if (p === null) errors.push(`precioVenta inválido: "${v}"`)
        else precioVenta = p
      }
    }

    // skip fully empty rows silently
    const isEmpty = !codigo && !nombre && precioCompra === null && precioVenta === null
    if (isEmpty) return

    if (!codigo) errors.push("código vacío")
    if (precioCompra === null && precioVenta === null) {
      errors.push("sin precio")
    }

    out.push({ rowIndex: idx, codigo, nombre, precioCompra, precioVenta, errors })
  })
  return out
}
