import { NextResponse } from "next/server"
import { requireAuth, requireInventarioAccess, hasInventarioAccess, resolveVendedoresHabilitados } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

// ============================================================
// /api/inventario/variantes/[varianteId]
//
// GET    - detalle
// PATCH  - actualiza nombre / atributos / precios / barcode / activo / orden
// DELETE - soft delete (?force=true para confirmar con stock)
// ============================================================

// includeCost defaults true: PATCH/DELETE call this only after requireInventarioAccess
// already granted cost access, so they don't need to pass the flag explicitly.
function formatVariante(row: any, includeCost = true) {
  return {
    id: row.id,
    inventarioId: row.inventario_id,
    nombre: row.nombre,
    atributos: row.atributos ?? {},
    codigoVariante: row.codigo_variante,
    barcode: row.barcode,
    stock: row.stock,
    stockReservado: row.stock_reservado,
    stockDisponible: Math.max(0, (row.stock ?? 0) - (row.stock_reservado ?? 0)),
    precioCompra: includeCost && row.precio_compra !== null && row.precio_compra !== undefined
      ? Number(row.precio_compra)
      : null,
    precioVenta: row.precio_venta !== null && row.precio_venta !== undefined
      ? Number(row.precio_venta)
      : null,
    imagenUrl: row.imagen_url,
    imagenPath: row.imagen_path,
    activo: row.activo,
    orden: row.orden,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const patchSchema = z.object({
  nombre: z.string().min(1).max(200).optional(),
  atributos: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  codigoVariante: z.string().min(1).max(80).optional(),
  barcode: z.string().max(80).nullable().optional(),
  precioCompra: z.number().min(0).nullable().optional(),
  precioVenta: z.number().min(0).nullable().optional(),
  imagenUrl: z.string().nullable().optional(),
  imagenPath: z.string().nullable().optional(),
  activo: z.boolean().optional(),
  orden: z.number().int().min(0).optional(),
})

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ varianteId: string }> }
) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    const { varianteId } = await params

    const { data, error: dbErr } = await supabaseAdmin
      .from("inventario_variantes")
      .select("*")
      .eq("id", varianteId)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .maybeSingle()

    if (dbErr) throw dbErr
    if (!data) {
      return NextResponse.json({ error: "Variante no encontrada" }, { status: 404 })
    }

    const vendedoresHabilitados = role === "VENDEDOR"
      ? await resolveVendedoresHabilitados(organizationId!)
      : false
    const canViewCost = hasInventarioAccess(role, vendedoresHabilitados)
    return NextResponse.json(formatVariante(data, canViewCost))
  } catch (err) {
    console.error("Error fetching variante:", err)
    return NextResponse.json({ error: "Error al obtener variante" }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ varianteId: string }> }
) {
  try {
    const { error, organizationId } = await requireInventarioAccess()
    if (error) return error

    const { varianteId } = await params
    const body = await request.json()
    const data = patchSchema.parse(body)

    const updateData: Record<string, any> = {}
    if (data.nombre !== undefined) updateData.nombre = data.nombre.trim()
    if (data.atributos !== undefined) updateData.atributos = data.atributos
    if (data.codigoVariante !== undefined) updateData.codigo_variante = data.codigoVariante.trim()
    if (data.barcode !== undefined) {
      const trimmed = (data.barcode ?? "").trim()
      updateData.barcode = trimmed.length > 0 ? trimmed : null
    }
    if (data.precioCompra !== undefined) updateData.precio_compra = data.precioCompra
    if (data.precioVenta !== undefined) updateData.precio_venta = data.precioVenta
    if (data.imagenUrl !== undefined) updateData.imagen_url = data.imagenUrl
    if (data.imagenPath !== undefined) updateData.imagen_path = data.imagenPath
    if (data.activo !== undefined) updateData.activo = data.activo
    if (data.orden !== undefined) updateData.orden = data.orden

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 })
    }

    const { data: row, error: updErr } = await supabaseAdmin
      .from("inventario_variantes")
      .update(updateData)
      .eq("id", varianteId)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .select("*")
      .maybeSingle()

    if (updErr) {
      if ((updErr as any).code === "23505") {
        return NextResponse.json(
          { error: "Código de variante o barcode duplicado" },
          { status: 409 }
        )
      }
      throw updErr
    }
    if (!row) {
      return NextResponse.json({ error: "Variante no encontrada" }, { status: 404 })
    }

    return NextResponse.json(formatVariante(row))
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error patching variante:", err)
    return NextResponse.json({ error: "Error al actualizar variante" }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ varianteId: string }> }
) {
  try {
    const { error, organizationId } = await requireInventarioAccess()
    if (error) return error

    const { varianteId } = await params
    const url = new URL(request.url)
    const force = url.searchParams.get("force") === "true"

    const { data: variante } = await supabaseAdmin
      .from("inventario_variantes")
      .select("id, nombre, stock, stock_reservado")
      .eq("id", varianteId)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .maybeSingle()

    if (!variante) {
      return NextResponse.json({ error: "Variante no encontrada" }, { status: 404 })
    }

    if (variante.stock_reservado > 0) {
      return NextResponse.json(
        {
          error: `No se puede eliminar: la variante tiene ${variante.stock_reservado} unidades reservadas.`,
          code: "HAS_RESERVATIONS",
        },
        { status: 409 }
      )
    }

    if (variante.stock > 0 && !force) {
      return NextResponse.json(
        {
          error: `La variante tiene ${variante.stock} unidades en stock. Usá ?force=true para eliminarla de todos modos.`,
          code: "HAS_STOCK",
          stock: variante.stock,
        },
        { status: 409 }
      )
    }

    const { error: updErr } = await supabaseAdmin
      .from("inventario_variantes")
      .update({
        deleted_at: new Date().toISOString(),
        activo: false,
      })
      .eq("id", varianteId)
      .eq("organization_id", organizationId!)

    if (updErr) throw updErr

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Error deleting variante:", err)
    return NextResponse.json({ error: "Error al eliminar variante" }, { status: 500 })
  }
}
