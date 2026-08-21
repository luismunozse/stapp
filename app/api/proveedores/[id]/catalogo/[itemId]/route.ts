import { NextResponse } from "next/server"
import { z } from "zod"
import {
  requireAdminOrVendedor,
  hasInventarioAccess,
  resolveVendedoresHabilitados,
} from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatProveedorCatalogoItem } from "@/lib/db-utils"

const updateSchema = z.object({
  nombre: z.string().min(1).optional(),
  codigoProveedor: z.string().optional(),
  descripcion: z.string().optional(),
  precioReferencia: z.number().min(0).optional().nullable(),
  moneda: z.string().max(8).optional(),
  unidad: z.string().max(40).optional(),
  notas: z.string().optional(),
  inventarioId: z.string().optional().nullable(),
})

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { error, organizationId, role } = await requireAdminOrVendedor()
    if (error) return error
    const { id, itemId } = await params

    const body = await request.json()
    const data = updateSchema.parse(body)

    const update: Record<string, any> = {}
    if (data.nombre !== undefined) update.nombre = data.nombre
    if (data.codigoProveedor !== undefined) update.codigo_proveedor = data.codigoProveedor || null
    if (data.descripcion !== undefined) update.descripcion = data.descripcion || null
    if (data.precioReferencia !== undefined) update.precio_referencia = data.precioReferencia ?? null
    if (data.moneda !== undefined) update.moneda = data.moneda || "ARS"
    if (data.unidad !== undefined) update.unidad = data.unidad || null
    if (data.notas !== undefined) update.notas = data.notas || null
    if (data.inventarioId !== undefined) update.inventario_id = data.inventarioId || null

    const { data: updated, error: dbErr } = await supabaseAdmin
      .from("proveedor_catalogo_items")
      .update(update)
      .eq("id", itemId)
      .eq("proveedor_id", id)
      .eq("organization_id", organizationId!)
      .select("*, inventario:inventario_id(id, codigo, nombre)")
      .single()

    if (dbErr || !updated) {
      return NextResponse.json({ error: "Item no encontrado" }, { status: 404 })
    }

    // requireAdminOrVendedor deja pasar a un VENDEDOR sin acceso a inventario.
    // Sin este gate, un PUT que sólo toca el nombre devolvía el
    // precio_referencia guardado: el mismo dato que el GET oculta.
    const vendedoresHabilitados = role === "VENDEDOR"
      ? await resolveVendedoresHabilitados(organizationId!)
      : false
    const canViewCost = hasInventarioAccess(role, vendedoresHabilitados)

    return NextResponse.json(formatProveedorCatalogoItem(updated, canViewCost))
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error updating catalogo item:", err)
    return NextResponse.json({ error: "Error al actualizar item" }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { error, organizationId } = await requireAdminOrVendedor()
    if (error) return error
    const { id, itemId } = await params

    const { error: dbErr } = await supabaseAdmin
      .from("proveedor_catalogo_items")
      .delete()
      .eq("id", itemId)
      .eq("proveedor_id", id)
      .eq("organization_id", organizationId!)

    if (dbErr) throw dbErr
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Error deleting catalogo item:", err)
    return NextResponse.json({ error: "Error al eliminar item" }, { status: 500 })
  }
}
