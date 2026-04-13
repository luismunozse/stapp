import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { parseCSV, parseExcel } from "@/lib/csv-parser"
import { validateClienteRow, validateInventarioRow, validateCSVHeaders } from "@/lib/csv-validator"
import { hasPlanFeature } from "@/lib/subscriptions"
import { z } from "zod"

const previewSchema = z.object({
  file: z.string().min(1, "Archivo requerido"), // base64
  mime: z.string().min(1, "Tipo de archivo requerido"),
  entityType: z.enum(["CLIENTES", "INVENTARIO"]),
})

export async function POST(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const hasImport = await hasPlanFeature(organizationId!, "import_export")
    if (!hasImport) {
      return NextResponse.json(
        { error: "Importación requiere el plan Profesional", code: "PREMIUM_REQUIRED" },
        { status: 403 }
      )
    }

    const body = await request.json()
    const data = previewSchema.parse(body)

    // Parse file based on MIME type
    let parseResult
    if (data.mime.includes('csv')) {
      parseResult = await parseCSV(data.file)
    } else if (data.mime.includes('spreadsheet') || data.mime.includes('excel')) {
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

    // Validate headers
    const headers = Object.keys(parseResult.data[0])
    const headerValidation = validateCSVHeaders(headers, data.entityType)
    if (!headerValidation.valid) {
      return NextResponse.json(
        { error: headerValidation.error },
        { status: 400 }
      )
    }

    // Validate first 5 rows for preview
    const previewRows = parseResult.data.slice(0, 5)
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

    return NextResponse.json({
      totalRows: parseResult.totalRows,
      preview: validatedPreview,
      headers,
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
