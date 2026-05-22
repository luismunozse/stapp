import Papa from 'papaparse'
import ExcelJS from 'exceljs'

export interface ParsedRow {
  [key: string]: string | number | null
}

export interface ParseResult {
  data: ParsedRow[]
  errors: string[]
  totalRows: number
}

/**
 * Parse CSV file from base64 string
 */
export async function parseCSV(base64Data: string): Promise<ParseResult> {
  try {
    // Decode base64 to text
    const csvText = Buffer.from(base64Data, 'base64').toString('utf-8')

    return new Promise((resolve) => {
      Papa.parse(csvText, {
        header: true, // Use first row as headers
        skipEmptyLines: true,
        dynamicTyping: true, // Auto-convert numbers
        transformHeader: (header) => header.trim(), // Trim whitespace
        complete: (results) => {
          resolve({
            data: results.data as ParsedRow[],
            errors: results.errors.map(e => `Row ${e.row}: ${e.message}`),
            totalRows: results.data.length,
          })
        },
        error: (error: Error) => {
          resolve({
            data: [],
            errors: [error.message],
            totalRows: 0,
          })
        },
      })
    })
  } catch (error) {
    return {
      data: [],
      errors: [error instanceof Error ? error.message : 'Error parsing CSV'],
      totalRows: 0,
    }
  }
}

function detectHeaderRowIndex(rows: (string | number | null)[][]): number {
  // Scan primeras 10 filas. Header = fila con más celdas string no-numéricas.
  const limit = Math.min(rows.length, 10)
  let best = 0
  let bestScore = -1
  for (let i = 0; i < limit; i++) {
    const row = rows[i]
    if (!row || row.length === 0) continue
    const filled = row.filter(c => c !== null && c !== undefined && String(c).trim() !== '')
    if (filled.length < 2) continue // Banner típico (una celda merged) → skip
    const stringy = filled.filter(c => {
      const s = String(c).trim()
      if (!s) return false
      // Header cell: texto corto, no es solo número, no es fecha
      if (/^-?\d+([.,]\d+)?$/.test(s)) return false
      if (s.length > 60) return false
      return true
    }).length
    const score = stringy - (filled.length - stringy) * 0.5
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }
  return best
}

function resolveCellValue(value: ExcelJS.CellValue): string | number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return typeof value === 'boolean' ? String(value) : value
  }
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object' && 'result' in value) {
    return resolveCellValue((value as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue)
  }
  if (typeof value === 'object' && 'richText' in value) {
    return (value as ExcelJS.CellRichTextValue).richText.map(rt => rt.text).join('')
  }
  return String(value)
}

/**
 * Parse Excel file from base64 string
 */
export async function parseExcel(base64Data: string): Promise<ParseResult> {
  try {
    const buffer = Buffer.from(base64Data, 'base64')

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))

    const worksheet = workbook.worksheets[0]
    if (!worksheet) {
      return {
        data: [],
        errors: ['El archivo Excel no contiene hojas válidas. Si es formato .xls (Excel 97-2003), convertilo a .xlsx o exportá como CSV.'],
        totalRows: 0,
      }
    }

    const allRows: (string | number | null)[][] = []
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      // row.values is 1-based; index 0 is undefined
      const values = (row.values as ExcelJS.CellValue[]).slice(1)
      allRows.push(values.map(resolveCellValue))
    })

    if (allRows.length === 0) {
      return {
        data: [],
        errors: ['Excel file is empty'],
        totalRows: 0,
      }
    }

    // Auto-detectar fila de headers. Plantillas externas suelen tener
    // banner/título arriba (fila merged, logo, fecha). Header real es la
    // primera fila donde la mayoría de celdas son strings cortos no numéricos.
    const headerRowIndex = detectHeaderRowIndex(allRows)
    const headers = allRows[headerRowIndex].map(h => String(h ?? '').trim())
    const dataRows = allRows.slice(headerRowIndex + 1)

    const data: ParsedRow[] = dataRows.map((row) => {
      const obj: ParsedRow = {}
      headers.forEach((header, index) => {
        obj[header] = row[index] ?? null
      })
      return obj
    })

    return {
      data,
      errors: [],
      totalRows: data.length,
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error parsing Excel'
    const friendly = /zip|central directory|signature|end of central/i.test(msg)
      ? 'Archivo Excel inválido o corrupto. Verificá que sea formato .xlsx (no .xls antiguo) y volvé a guardarlo desde Excel/LibreOffice.'
      : msg
    return {
      data: [],
      errors: [friendly],
      totalRows: 0,
    }
  }
}

/**
 * Generate CSV template for entity type
 */
export function generateCSVTemplate(entityType: 'CLIENTES' | 'INVENTARIO'): string {
  if (entityType === 'CLIENTES') {
    const headers = ['nombre', 'telefono', 'email', 'direccion', 'dni']
    const example = ['Juan Pérez', '1123456789', 'juan@email.com', 'Calle Falsa 123', '12345678']
    return Papa.unparse([headers, example])
  } else {
    const headers = ['codigo', 'nombre', 'descripcion', 'categoria', 'tipoDispositivo', 'stock', 'precioCompra', 'precioVenta', 'proveedor']
    const example = ['PANT001', 'Pantalla iPhone 12', 'Pantalla OLED original', 'Pantallas', 'CELULAR', '10', '25000', '35000', 'Proveedor SA']
    return Papa.unparse([headers, example])
  }
}
