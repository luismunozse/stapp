import { NextResponse } from "next/server"
import { requireAuth, denyIfNoInventarioAccess } from "@/lib/auth-utils"
import { parseCSV, parseExcel } from "@/lib/csv-parser"
import { validateClienteRow, validateInventarioRow, validateCSVHeaders, normalizeHeaders, normalizeRow } from "@/lib/csv-validator"
import { hasPlanFeature } from "@/lib/subscriptions"
import { rejectOversizedImportBody } from "@/lib/import-limits"
import { z } from "zod"

const previewSchema = z.object({
  file: z.string().min(1, "Archivo requerido"), // base64
  mime: z.string().min(1, "Tipo de archivo requerido"),
  filename: z.string().optional(),
  entityType: z.enum(["CLIENTES", "INVENTARIO"]),
})

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export async function POST(request: Request) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    // Antes de `request.json()`, que es lo que materializa el base64 entero en
    // memoria. Ver lib/import-limits.ts.
    const toobig = rejectOversizedImportBody(request)
    if (toobig) return toobig

    const body = await request.json()
    const data = previewSchema.parse(body)

    // Mismo permiso, y en el mismo orden, que el execute que viene después (ver
    // la nota de allá sobre por qué el gate de entidad va arriba del de plan).
    //
    // El preview no revela nada de la organización —solo parsea el archivo que
    // subió quien llama—, así que esto no cierra una filtración: corta el flujo
    // en el primer paso en vez de dejar que alguien suba y mapee un archivo
    // entero para comerse un 403 al final.
    if (data.entityType === 'INVENTARIO') {
      const denied = await denyIfNoInventarioAccess(role, organizationId!)
      if (denied) return denied
    }

    const hasImport = await hasPlanFeature(organizationId!, "import_export")
    if (!hasImport) {
      return NextResponse.json(
        { error: "Importación requiere el plan Profesional", code: "PREMIUM_REQUIRED" },
        { status: 403 }
      )
    }

    // Detect by filename + mime. Excel 97-2003 (.xls) no soportado por ExcelJS.
    const lowerName = (data.filename ?? '').toLowerCase()
    const isCsv = lowerName.endsWith('.csv') || data.mime === 'text/csv' || data.mime.includes('csv')
    const isXlsx = lowerName.endsWith('.xlsx') || data.mime === XLSX_MIME || data.mime.includes('spreadsheet')
    const isLegacyXls = (lowerName.endsWith('.xls') && !lowerName.endsWith('.xlsx')) ||
      (data.mime === 'application/vnd.ms-excel' && !isCsv && !isXlsx)

    if (isLegacyXls) {
      return NextResponse.json(
        { error: "Formato .xls (Excel 97-2003) no soportado. Guardá el archivo como .xlsx o exportá a CSV." },
        { status: 400 }
      )
    }

    let parseResult
    if (isCsv) {
      parseResult = await parseCSV(data.file)
    } else if (isXlsx) {
      parseResult = await parseExcel(data.file)
    } else {
      return NextResponse.json(
        { error: "Formato de archivo no soportado. Use CSV o Excel (.xlsx)" },
        { status: 400 }
      )
    }

    if (parseResult.errors.length > 0) {
      return NextResponse.json(
        { error: `Error al parsear archivo: ${parseResult.errors[0]}` },
        { status: 400 }
      )
    }

    if (parseResult.data.length === 0) {
      return NextResponse.json(
        { error: "El archivo está vacío" },
        { status: 400 }
      )
    }

    // Normalizar headers (acepta aliases: "código"→"codigo", "precio compra"→"precioCompra", etc.)
    const originalHeaders = Object.keys(parseResult.data[0])
    const { canonicalHeaders, mapping, unmapped } = normalizeHeaders(originalHeaders, data.entityType)

    const headerValidation = validateCSVHeaders(canonicalHeaders, data.entityType)
    if (!headerValidation.valid) {
      return NextResponse.json(
        { error: headerValidation.error, unmapped },
        { status: 400 }
      )
    }

    const normalizedRows = parseResult.data.map(r => normalizeRow(r, mapping))

    // Validate first 5 rows for preview
    const previewRows = normalizedRows.slice(0, 5)
    const validatedPreview = previewRows.map((row, index) => {
      const validation = data.entityType === 'CLIENTES'
        ? validateClienteRow(row, index)
        : validateInventarioRow(row, index)

      return {
        row: index + 1,
        data: row,
        valid: validation.valid,
        error: validation.error,
      }
    })

    // Validar TODAS las filas (sync, sin I/O) para contar errores y filas sin precio.
    let invalidRows = 0
    let sinPrecio = 0
    for (let index = 0; index < normalizedRows.length; index++) {
      const validation = data.entityType === 'CLIENTES'
        ? validateClienteRow(normalizedRows[index], index)
        : validateInventarioRow(normalizedRows[index], index)
      if (!validation.valid) {
        invalidRows++
      } else if (validation.sinPrecio) {
        sinPrecio++
      }
    }

    return NextResponse.json({
      totalRows: parseResult.totalRows,
      preview: validatedPreview,
      headers: canonicalHeaders,
      unmappedColumns: unmapped,
      invalidRows,
      sinPrecio,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error in import preview:", error)
    return NextResponse.json(
      { error: "Error al procesar archivo" },
      { status: 500 }
    )
  }
}
