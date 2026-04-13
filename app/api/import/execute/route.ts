import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { parseCSV, parseExcel } from "@/lib/csv-parser"
import { validateClienteRow, validateInventarioRow } from "@/lib/csv-validator"
import { uploadImportFile, base64ToBuffer } from "@/lib/storage"
import { enforcePlanLimit } from "@/lib/plan-limits"
import { hasPlanFeature } from "@/lib/subscriptions"
import { z } from "zod"

const executeSchema = z.object({
  file: z.string().min(1, "Archivo requerido"),
  mime: z.string().min(1, "Tipo de archivo requerido"),
  filename: z.string().min(1, "Nombre de archivo requerido"),
  entityType: z.enum(["CLIENTES", "INVENTARIO"]),
})

export async function POST(request: Request) {
  try {
    const { error, organizationId, userId } = await requireAuth()
    if (error) return error

    const hasImport = await hasPlanFeature(organizationId!, "import_export")
    if (!hasImport) {
      return NextResponse.json(
        { error: "Importación requiere el plan Profesional", code: "PREMIUM_REQUIRED" },
        { status: 403 }
      )
    }

    const body = await request.json()
    const data = executeSchema.parse(body)

    // Parse file
    let parseResult
    if (data.mime.includes('csv')) {
      parseResult = await parseCSV(data.file)
    } else if (data.mime.includes('spreadsheet') || data.mime.includes('excel')) {
      parseResult = await parseExcel(data.file)
    } else {
      return NextResponse.json(
        { error: "Formato de archivo no soportado" },
        { status: 400 }
      )
    }

    if (parseResult.errors.length > 0 || parseResult.data.length === 0) {
      return NextResponse.json(
        { error: "Archivo inválido o vacío" },
        { status: 400 }
      )
    }

    // Upload file to storage
    const buffer = base64ToBuffer(data.file)
    const { path: filePath } = await uploadImportFile(
      organizationId!,
      buffer,
      data.mime,
      data.filename
    )

    // Process rows
    const results = {
      success: [] as any[],
      skipped: [] as any[],
      errors: [] as any[],
    }

    for (let i = 0; i < parseResult.data.length; i++) {
      const row = parseResult.data[i]
      const rowNumber = i + 2 // +2 because of header row and 0-index

      // Validate row
      const validation = data.entityType === 'CLIENTES'
        ? validateClienteRow(row, i)
        : validateInventarioRow(row, i)

      if (!validation.valid) {
        results.errors.push({
          row: rowNumber,
          error: validation.error!,
          data: row,
        })
        continue
      }

      // Insert based on entity type
      try {
        if (data.entityType === 'CLIENTES') {
          const { data: existing } = await supabaseAdmin
            .from('clientes')
            .select('id')
            .eq('organization_id', organizationId!)
            .eq('telefono', validation.data.telefono)
            .single()

          if (existing) {
            results.skipped.push({
              row: rowNumber,
              reason: 'Ya existe un cliente con ese teléfono',
              data: row,
            })
            continue
          }

          // Check plan limit
          const limitError = await enforcePlanLimit(organizationId!, 'clientes')
          if (limitError) {
            results.errors.push({
              row: rowNumber,
              error: 'Límite de clientes alcanzado en tu plan',
              data: row,
            })
            continue
          }

          const { error: insertError } = await supabaseAdmin
            .from('clientes')
            .insert({
              nombre: validation.data.nombre,
              telefono: validation.data.telefono,
              email: validation.data.email || null,
              direccion: validation.data.direccion || null,
              dni: validation.data.dni || null,
              organization_id: organizationId!,
            })

          if (insertError) {
            throw insertError
          }

          results.success.push({ row: rowNumber, data: row })
        } else {
          // INVENTARIO
          const { data: existing } = await supabaseAdmin
            .from('inventario')
            .select('id')
            .eq('organization_id', organizationId!)
            .eq('codigo', validation.data.codigo)
            .single()

          if (existing) {
            results.skipped.push({
              row: rowNumber,
              reason: 'Ya existe un item con ese código',
              data: row,
            })
            continue
          }

          const { error: insertError } = await supabaseAdmin
            .from('inventario')
            .insert({
              codigo: validation.data.codigo,
              nombre: validation.data.nombre,
              descripcion: validation.data.descripcion || null,
              categoria: validation.data.categoria,
              tipo_dispositivo: validation.data.tipoDispositivo,
              stock: validation.data.stock,
              precio_compra: validation.data.precioCompra,
              precio_venta: validation.data.precioVenta,
              proveedor: validation.data.proveedor || null,
              organization_id: organizationId!,
            })

          if (insertError) {
            throw insertError
          }

          results.success.push({ row: rowNumber, data: row })
        }
      } catch (insertError: any) {
        results.errors.push({
          row: rowNumber,
          error: insertError.message || 'Error al insertar registro',
          data: row,
        })
      }
    }

    // Save import history
    const { data: importacion, error: historyError } = await supabaseAdmin
      .from('importaciones')
      .insert({
        organization_id: organizationId!,
        user_id: userId!,
        entity_type: data.entityType,
        filename: data.filename,
        file_path: filePath,
        file_size: buffer.length,
        total_rows: parseResult.totalRows,
        success_count: results.success.length,
        skipped_count: results.skipped.length,
        error_count: results.errors.length,
        errors_detail: [...results.errors, ...results.skipped],
      })
      .select()
      .single()

    if (historyError) {
      console.error("Error saving import history:", historyError)
    }

    return NextResponse.json({
      success: true,
      importId: importacion?.id,
      results: {
        total: parseResult.totalRows,
        success: results.success.length,
        skipped: results.skipped.length,
        errors: results.errors.length,
        errorDetails: results.errors,
        skippedDetails: results.skipped,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error executing import:", error)
    return NextResponse.json(
      { error: "Error al ejecutar importación" },
      { status: 500 }
    )
  }
}
