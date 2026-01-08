import Papa from 'papaparse'
import * as XLSX from 'xlsx'

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

/**
 * Parse Excel file from base64 string
 */
export async function parseExcel(base64Data: string): Promise<ParseResult> {
  try {
    // Decode base64 to buffer
    const buffer = Buffer.from(base64Data, 'base64')

    // Read workbook
    const workbook = XLSX.read(buffer, { type: 'buffer' })

    // Get first sheet
    const firstSheetName = workbook.SheetNames[0]
    if (!firstSheetName) {
      return {
        data: [],
        errors: ['No sheets found in Excel file'],
        totalRows: 0,
      }
    }

    const worksheet = workbook.Sheets[firstSheetName]

    // Convert to JSON with headers
    const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, {
      header: 1, // Get as array first
      raw: false, // Get formatted values
      defval: null, // Default value for empty cells
    })

    if (jsonData.length === 0) {
      return {
        data: [],
        errors: ['Excel file is empty'],
        totalRows: 0,
      }
    }

    // First row is headers
    const headers = jsonData[0] as string[]
    const rows = jsonData.slice(1)

    // Convert to objects
    const data: ParsedRow[] = rows.map((row: any) => {
      const obj: ParsedRow = {}
      headers.forEach((header, index) => {
        obj[String(header).trim()] = row[index] ?? null
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
