import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { parseCSV, parseExcel } from "@/lib/csv-parser"
import { validateClienteRow, validateInventarioRow, validateCSVHeaders, normalizeHeaders, normalizeRow, resolveTipoDispositivo, generateCodigo } from "@/lib/csv-validator"
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

// Vercel default 30s. Import batch puede tomar más con archivos grandes.
// Hobby plan max = 60s, Pro = 300s.
export const maxDuration = 60

const BATCH_SIZE = 500

function buildInventarioPayload(d: any, codigo: string, organizationId: string) {
  return {
    codigo,
    nombre: d.nombre,
    descripcion: d.descripcion || null,
    categoria: d.categoria || 'GENERAL',
    tipo_dispositivo: resolveTipoDispositivo(d.tipoDispositivo),
    stock: d.stock,
    precio_compra: d.precioCompra ?? 0,
    precio_venta: d.precioVenta,
    proveedor: d.proveedor || d.marca || null,
    organization_id: organizationId,
  }
}

async function batchInsert(
  client: typeof supabaseAdmin,
  table: 'clientes' | 'inventario',
  items: Array<{ rowNumber: number; row: any; payload: any; sinPrecio?: boolean }>,
  results: { success: any[]; skipped: any[]; errors: any[]; sinPrecio: number }
) {
  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    const chunk = items.slice(start, start + BATCH_SIZE)
    const payloads = chunk.map(c => c.payload)
    const { error } = await client.from(table).insert(payloads)
    if (!error) {
      for (const c of chunk) {
        results.success.push({ row: c.rowNumber, data: c.row })
        if (c.sinPrecio) results.sinPrecio++
      }
      continue
    }
    // Insert fallido: reintentar item por item para aislar la fila mala.
    for (const c of chunk) {
      const { error: rowErr } = await client.from(table).insert(c.payload)
      if (rowErr) {
        results.errors.push({ row: c.rowNumber, error: rowErr.message, data: c.row })
      } else {
        results.success.push({ row: c.rowNumber, data: c.row })
        if (c.sinPrecio) results.sinPrecio++
      }
    }
  }
}

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

    // Detect by filename + mime. Excel 97-2003 (.xls) no soportado por ExcelJS.
    const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    const lowerName = data.filename.toLowerCase()
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
        { error: "Formato de archivo no soportado" },
        { status: 400 }
      )
    }

    if (parseResult.errors.length > 0 || parseResult.data.length === 0) {
      return NextResponse.json(
        { error: parseResult.errors[0] ?? "Archivo inválido o vacío" },
        { status: 400 }
      )
    }

    // Normalizar headers + rows (acepta aliases comunes).
    const originalHeaders = Object.keys(parseResult.data[0])
    const { canonicalHeaders, mapping } = normalizeHeaders(originalHeaders, data.entityType)
    const headerValidation = validateCSVHeaders(canonicalHeaders, data.entityType)
    if (!headerValidation.valid) {
      return NextResponse.json(
        { error: headerValidation.error },
        { status: 400 }
      )
    }
    parseResult.data = parseResult.data.map(r => normalizeRow(r, mapping))

    // Upload file to storage. Si falla (bucket sin crear / policies / cuota),
    // seguimos con import; histórico queda sin file_path.
    const buffer = base64ToBuffer(data.file)
    let filePath: string | null = null
    try {
      const upload = await uploadImportFile(organizationId!, buffer, data.mime, data.filename)
      filePath = upload.path
    } catch (uploadErr) {
      console.warn("Import upload skipped:", uploadErr instanceof Error ? uploadErr.message : uploadErr)
    }

    // Validar todas las filas primero (sync, sin I/O).
    const results = {
      success: [] as any[],
      skipped: [] as any[],
      errors: [] as any[],
      sinPrecio: 0,
    }
    const validRows: Array<{ rowNumber: number; row: any; data: any; sinPrecio?: boolean }> = []

    for (let i = 0; i < parseResult.data.length; i++) {
      const row = parseResult.data[i]
      const rowNumber = i + 2
      const validation = data.entityType === 'CLIENTES'
        ? validateClienteRow(row, i)
        : validateInventarioRow(row, i)
      if (!validation.valid) {
        results.errors.push({ row: rowNumber, error: validation.error!, data: row })
        continue
      }
      validRows.push({ rowNumber, row, data: validation.data, sinPrecio: validation.sinPrecio })
    }

    if (data.entityType === 'CLIENTES') {
      // Batch dedup por telefono
      const telefonos = Array.from(new Set(validRows.map(v => v.data.telefono)))
      const { data: existing } = await supabaseAdmin
        .from('clientes')
        .select('telefono')
        .eq('organization_id', organizationId!)
        .in('telefono', telefonos)
      const existingSet = new Set((existing ?? []).map(e => e.telefono))

      // Dedup entre filas del mismo archivo (primer ocurrencia gana)
      const seenInBatch = new Set<string>()
      const toInsert: Array<{ rowNumber: number; row: any; payload: any }> = []
      for (const v of validRows) {
        if (existingSet.has(v.data.telefono)) {
          results.skipped.push({ row: v.rowNumber, reason: 'Ya existe un cliente con ese teléfono', data: v.row })
          continue
        }
        if (seenInBatch.has(v.data.telefono)) {
          results.skipped.push({ row: v.rowNumber, reason: 'Teléfono duplicado dentro del archivo', data: v.row })
          continue
        }
        seenInBatch.add(v.data.telefono)
        toInsert.push({
          rowNumber: v.rowNumber,
          row: v.row,
          payload: {
            nombre: v.data.nombre,
            telefono: v.data.telefono,
            email: v.data.email || null,
            direccion: v.data.direccion || null,
            dni: v.data.dni || null,
            organization_id: organizationId!,
          },
        })
      }

      // Plan limit: chequeo una sola vez antes del batch insert.
      const limitError = toInsert.length > 0
        ? await enforcePlanLimit(organizationId!, 'clientes')
        : null
      if (limitError) {
        for (const item of toInsert) {
          results.errors.push({ row: item.rowNumber, error: 'Límite de clientes alcanzado en tu plan', data: item.row })
        }
      } else {
        await batchInsert(supabaseAdmin, 'clientes', toInsert, results)
      }
    } else {
      // INVENTARIO: separar items con código vs autogen
      const withCodigo: typeof validRows = []
      const autoGen: typeof validRows = []
      for (const v of validRows) {
        const codigo = (v.data.codigo || '').trim()
        if (codigo) withCodigo.push({ ...v, data: { ...v.data, codigo } })
        else autoGen.push(v)
      }

      // Batch dedup contra DB por codigo
      const codigos = Array.from(new Set(withCodigo.map(v => v.data.codigo)))
      const existingSet = new Set<string>()
      if (codigos.length > 0) {
        const { data: existing } = await supabaseAdmin
          .from('inventario')
          .select('codigo')
          .eq('organization_id', organizationId!)
          .in('codigo', codigos)
        for (const e of existing ?? []) existingSet.add(e.codigo)
      }

      const seenInBatch = new Set<string>()
      const toInsert: Array<{ rowNumber: number; row: any; payload: any; sinPrecio?: boolean }> = []

      for (const v of withCodigo) {
        if (existingSet.has(v.data.codigo)) {
          results.skipped.push({ row: v.rowNumber, reason: 'Ya existe un item con ese código', data: v.row })
          continue
        }
        if (seenInBatch.has(v.data.codigo)) {
          results.skipped.push({ row: v.rowNumber, reason: 'Código duplicado dentro del archivo', data: v.row })
          continue
        }
        seenInBatch.add(v.data.codigo)
        toInsert.push({
          rowNumber: v.rowNumber,
          row: v.row,
          payload: buildInventarioPayload(v.data, v.data.codigo, organizationId!),
          sinPrecio: v.sinPrecio,
        })
      }

      for (const v of autoGen) {
        let codigo = generateCodigo(v.data.nombre)
        while (seenInBatch.has(codigo)) codigo = generateCodigo(v.data.nombre)
        seenInBatch.add(codigo)
        toInsert.push({
          rowNumber: v.rowNumber,
          row: v.row,
          payload: buildInventarioPayload(v.data, codigo, organizationId!),
          sinPrecio: v.sinPrecio,
        })
      }

      await batchInsert(supabaseAdmin, 'inventario', toInsert, results)
    }

    // Save import history
    const { data: importacion, error: historyError } = await supabaseAdmin
      .from('importaciones')
      .insert({
        organization_id: organizationId!,
        user_id: userId!,
        entity_type: data.entityType,
        filename: data.filename,
        file_path: filePath ?? '',
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
        sinPrecio: results.sinPrecio,
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
