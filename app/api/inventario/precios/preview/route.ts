import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { loadWorkbook, mapRows, readSheetRows } from "@/lib/precios-import"

const mappingSchema = z.object({
  codigo: z.number().int().min(0),
  nombre: z.number().int().min(0).optional(),
  precioCompra: z.number().int().min(0).optional(),
  precioVenta: z.number().int().min(0).optional(),
})

const schema = z.object({
  file: z.string().min(1),
  sheet: z.string().min(1),
  headerRow: z.number().int().min(0),
  mapping: mappingSchema,
  options: z
    .object({
      onlyIncreasePrices: z.boolean().optional(),
    })
    .optional(),
})

export async function POST(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const { file, sheet, headerRow, mapping, options } = schema.parse(body)

    if (mapping.precioCompra == null && mapping.precioVenta == null) {
      return NextResponse.json(
        { error: "Mapeá al menos una columna de precio (compra o venta)" },
        { status: 400 }
      )
    }

    const workbook = await loadWorkbook(file)
    const ws = workbook.getWorksheet(sheet)
    if (!ws) {
      return NextResponse.json({ error: `Hoja "${sheet}" no encontrada` }, { status: 400 })
    }

    const rows = readSheetRows(ws)
    const mapped = mapRows(rows, headerRow, mapping)

    const codigos = Array.from(
      new Set(mapped.filter((m) => m.codigo).map((m) => m.codigo))
    )

    type InventarioRow = {
      id: string
      codigo: string
      nombre: string
      precio_compra: string | number
      precio_venta: string | number
    }
    const found: Record<string, InventarioRow> = {}
    if (codigos.length > 0) {
      // chunk to avoid Postgres "in" limit
      const CHUNK = 500
      for (let i = 0; i < codigos.length; i += CHUNK) {
        const slice = codigos.slice(i, i + CHUNK)
        const { data, error: dbError } = await supabaseAdmin
          .from("inventario")
          .select("id, codigo, nombre, precio_compra, precio_venta")
          .eq("organization_id", organizationId!)
          .is("deleted_at", null)
          .in("codigo", slice)
        if (dbError) throw dbError
        for (const row of (data ?? []) as InventarioRow[]) {
          found[row.codigo] = row
        }
      }
    }

    const updates: Array<{
      id: string
      codigo: string
      nombre: string
      precioCompraActual: number | null
      precioVentaActual: number | null
      precioCompraNuevo: number | null
      precioVentaNuevo: number | null
      cambia: boolean
    }> = []
    const unmatched: Array<{ rowIndex: number; codigo: string; nombre: string }> = []
    const errors: Array<{ rowIndex: number; codigo: string; message: string }> = []

    for (const m of mapped) {
      if (m.errors.length > 0) {
        errors.push({ rowIndex: m.rowIndex, codigo: m.codigo, message: m.errors.join("; ") })
        continue
      }
      const inv = found[m.codigo]
      if (!inv) {
        unmatched.push({ rowIndex: m.rowIndex, codigo: m.codigo, nombre: m.nombre })
        continue
      }
      const actualCompra = inv.precio_compra != null ? Number(inv.precio_compra) : null
      const actualVenta = inv.precio_venta != null ? Number(inv.precio_venta) : null
      let nuevoCompra = m.precioCompra
      let nuevoVenta = m.precioVenta
      if (options?.onlyIncreasePrices) {
        if (nuevoCompra != null && actualCompra != null && nuevoCompra < actualCompra) nuevoCompra = null
        if (nuevoVenta != null && actualVenta != null && nuevoVenta < actualVenta) nuevoVenta = null
      }
      const cambiaCompra = nuevoCompra != null && nuevoCompra !== actualCompra
      const cambiaVenta = nuevoVenta != null && nuevoVenta !== actualVenta
      const cambia = cambiaCompra || cambiaVenta
      updates.push({
        id: inv.id,
        codigo: inv.codigo,
        nombre: inv.nombre,
        precioCompraActual: actualCompra,
        precioVentaActual: actualVenta,
        precioCompraNuevo: cambiaCompra ? nuevoCompra : null,
        precioVentaNuevo: cambiaVenta ? nuevoVenta : null,
        cambia,
      })
    }

    return NextResponse.json({
      summary: {
        totalRows: mapped.length,
        matched: updates.filter((u) => u.cambia).length,
        sinCambios: updates.filter((u) => !u.cambia).length,
        unmatched: unmatched.length,
        errors: errors.length,
      },
      updates,
      unmatched,
      errors,
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error preview precios:", err)
    return NextResponse.json({ error: "Error al generar la vista previa" }, { status: 500 })
  }
}
