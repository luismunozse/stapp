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
    await workbook.xlsx.load(buffer)

    const worksheet = workbook.worksheets[0]
    if (!worksheet) {
      return {
        data: [],
        errors: ['No sheets found in Excel file'],
        totalRows: 0,
      }
    }

    const allRows: (string | number | null)[][] = []
    worksheet.eachRow((row) => {
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

    const headers = allRows[0].map(h => String(h ?? '').trim())
    const dataRows = allRows.slice(1)

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
    return {
      data: [],
      errors: [error instanceof Error ? error.message : 'Error parsing Excel'],
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
