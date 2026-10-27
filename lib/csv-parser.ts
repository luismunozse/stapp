import Papa from 'papaparse'
import ExcelJS from 'exceljs'

export interface ParsedRow {
  [key: string]: string | number | null
}

/** A row that could not even be split into cells (extra columns, broken quotes). */
export interface RowParseError {
  /** Position in `data` of the offending row. */
  index: number
  /** Line number as the user sees it in Excel/Sheets (header = 1). */
  row: number
  message: string
}

export interface ParseResult {
  data: ParsedRow[]
  /**
   * Spreadsheet line of each `data[i]` (header = 1, first data row = 2). Blank
   * lines count, so these match what Excel/Sheets show next to the row.
   */
  rowNumbers: number[]
  /** Structural problems affecting single rows. They never abort the file. */
  rowErrors: RowParseError[]
  /** File-level problems: nothing can be read. */
  errors: string[]
  totalRows: number
}

const MSG_TOO_MANY_COLUMNS =
  'La fila tiene más columnas que el encabezado. Si usás coma como separador decimal, guardá el CSV separado por punto y coma o poné el número entre comillas. También puede haber datos en una columna sin título.'
const MSG_BAD_QUOTES =
  'La fila tiene comillas sin cerrar o mal ubicadas. Revisá que cada texto entre comillas esté bien cerrado.'

/** An unclosed quote makes Papa swallow the following lines into this one row. */
function badQuotesMessage(record: string[]): string {
  const swallowed = record.reduce((n, c) => n + (String(c ?? '').split('\n').length - 1), 0)
  return swallowed > 0
    ? `${MSG_BAD_QUOTES} Las ${swallowed} líneas siguientes quedaron dentro de esta fila y no se leyeron.`
    : MSG_BAD_QUOTES
}

function isBlankCell(cell: unknown): boolean {
  return cell === null || cell === undefined || String(cell).trim() === ''
}

/**
 * Parse CSV file from base64 string.
 *
 * Cells are kept as STRINGS on purpose (no Papa `dynamicTyping`): turning
 * "1.500" into 1.5, or "0111234567" into 111234567, happened before the
 * validators could see the original text. Number handling lives in
 * `lib/number-parse.ts`, applied by the validators.
 */
export async function parseCSV(base64Data: string): Promise<ParseResult> {
  const empty = (errors: string[]): ParseResult => ({
    data: [],
    rowNumbers: [],
    rowErrors: [],
    errors,
    totalRows: 0,
  })

  try {
    const bytes = Buffer.from(base64Data, 'base64')
    let csvText = bytes.toString('utf-8')
    // Excel in Spanish saves "CSV (delimitado por comas)" as Windows-1252: invalid
    // UTF-8 turns "Teléfono" into "Tel\uFFFDfono" and the column is never recognised.
    if (csvText.includes('\uFFFD')) csvText = new TextDecoder('windows-1252').decode(bytes)
    if (csvText.charCodeAt(0) === 0xfeff) csvText = csvText.slice(1)

    // Detect the delimiter on a small sample that ignores blank lines: with
    // skipEmptyLines off, a trailing newline (every real CSV has one) drags the
    // average field count below Papa's detection threshold on short files.
    const delimiter = Papa.parse<string[]>(csvText, { preview: 10, skipEmptyLines: true }).meta.delimiter

    // header:false and no skipEmptyLines: record N is spreadsheet line N+1, even
    // across blank lines and multi-line quoted cells.
    const parsed = Papa.parse<string[]>(csvText, { header: false, skipEmptyLines: false, delimiter })

    const records = parsed.data
    const headerIdx = records.findIndex(r => r.some(c => !isBlankCell(c)))
    if (headerIdx === -1) return empty([])

    const headerCells = records[headerIdx].map(h => String(h ?? '').trim())
    let headerLen = headerCells.length
    while (headerLen > 0 && headerCells[headerLen - 1] === '') headerLen--
    const headers = headerCells.slice(0, headerLen)

    // Papa reports broken quotes by record index.
    const quoteErrorRecords = new Set<number>()
    for (const e of parsed.errors) {
      if (e.type === 'Quotes' && typeof e.row === 'number') quoteErrorRecords.add(e.row)
    }

    const data: ParsedRow[] = []
    const rowNumbers: number[] = []
    const rowErrors: RowParseError[] = []

    for (let i = headerIdx + 1; i < records.length; i++) {
      const record = records[i]
      if (record.every(isBlankCell)) continue

      const obj: ParsedRow = {}
      headers.forEach((header, col) => {
        if (header === '') return // unnamed column: ignored
        const cell = record[col] ?? ''
        const prev = obj[header]
        // Duplicate header: first non-empty cell wins.
        if (prev === undefined || prev === '') obj[header] = cell
      })

      const extra = record.slice(headerLen).some(c => !isBlankCell(c))
      const index = data.length
      data.push(obj)
      rowNumbers.push(i + 1)
      if (extra) rowErrors.push({ index, row: i + 1, message: MSG_TOO_MANY_COLUMNS })
      else if (quoteErrorRecords.has(i)) rowErrors.push({ index, row: i + 1, message: badQuotesMessage(record) })
    }

    return { data, rowNumbers, rowErrors, errors: [], totalRows: data.length }
  } catch (error) {
    return empty([error instanceof Error ? error.message : 'Error al leer el archivo CSV'])
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
  if (typeof value === 'object' && 'text' in value && !('richText' in value)) {
    // Hyperlink cell (e.g. an auto-linked email): the visible text is the value.
    return String((value as ExcelJS.CellHyperlinkValue).text ?? '')
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
        rowNumbers: [],
        rowErrors: [],
        errors: ['El archivo Excel no contiene hojas válidas. Si es formato .xls (Excel 97-2003), convertilo a .xlsx o exportá como CSV.'],
        totalRows: 0,
      }
    }

    const allRows: (string | number | null)[][] = []
    const allRowNumbers: number[] = [] // real sheet line of each entry in allRows
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      // row.values is 1-based; index 0 is undefined
      const values = (row.values as ExcelJS.CellValue[]).slice(1)
      allRows.push(values.map(resolveCellValue))
      allRowNumbers.push(rowNumber)
    })

    if (allRows.length === 0) {
      return {
        data: [],
        rowNumbers: [],
        rowErrors: [],
        errors: ['El archivo Excel está vacío'],
        totalRows: 0,
      }
    }

    // Auto-detectar fila de headers. Plantillas externas suelen tener
    // banner/título arriba (fila merged, logo, fecha). Header real es la
    // primera fila donde la mayoría de celdas son strings cortos no numéricos.
    const headerRowIndex = detectHeaderRowIndex(allRows)
    const headers = allRows[headerRowIndex].map(h => String(h ?? '').trim())

    const data: ParsedRow[] = []
    const rowNumbers: number[] = []
    for (let i = headerRowIndex + 1; i < allRows.length; i++) {
      const row = allRows[i]
      // Rows with only blank cells (styled but empty) are not records.
      if (row.every(isBlankCell)) continue
      const obj: ParsedRow = {}
      headers.forEach((header, index) => {
        obj[header] = row[index] ?? null
      })
      data.push(obj)
      rowNumbers.push(allRowNumbers[i])
    }

    return {
      data,
      rowNumbers,
      rowErrors: [],
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
      rowNumbers: [],
      rowErrors: [],
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
