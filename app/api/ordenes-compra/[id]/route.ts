import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const updateSchema = z.object({
  estado: z.enum(["BORRADOR", "ENVIADA", "CANCELADA"]).optional(),
  proveedorId: z.string().min(1).nullable().optional(),
  fechaRecepcionEsperada: z.string().nullable().optional(),
  notas: z.string().nullable().optional(),
})

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params

    const { data: oc, error: dbError } = await supabaseAdmin
      .from("ordenes_compra")
      .select(`
        *,
        proveedores:proveedor_id(id, nombre),
        users:created_by(id, nombre),
        items_orden_compra(
          id, inventario_id, cantidad_pedida, cantidad_recibida, precio_unitario, subtotal,
          inventario:inventario_id(id, codigo, nombre, stock, stock_reservado)
        )
      `)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (dbError || !oc) {
      return NextResponse.json({ error: "Orden de compra no encontrada" }, { status: 404 })
    }

    return NextResponse.json(formatOC(oc))
  } catch (error) {
    console.error("Error fetching OC:", error)
    return NextResponse.json({ error: "Error al obtener orden de compra" }, { status: 500 })
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const data = updateSchema.parse(body)

    // Verify OC exists
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("ordenes_compra")
      .select("id, estado")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json({ error: "Orden de compra no encontrada" }, { status: 404 })
    }

    // Validate state transitions
    if (data.estado) {
      const validTransitions: Record<string, string[]> = {
        BORRADOR: ["ENVIADA", "CANCELADA"],
        ENVIADA: ["CANCELADA"],
        RECIBIDA_PARCIAL: ["CANCELADA"],
      }
      const allowed = validTransitions[existing.estado] || []
      if (!allowed.includes(data.estado)) {
        return NextResponse.json(
          { error: `No se puede cambiar de ${existing.estado} a ${data.estado}` },
          { status: 400 }
        )
      }
    }

    const updateData: Record<string, any> = {}
    if (data.estado !== undefined) updateData.estado = data.estado
    if (data.proveedorId !== undefined) updateData.proveedor_id = data.proveedorId
    if (data.fechaRecepcionEsperada !== undefined) updateData.fecha_recepcion_esperada = data.fechaRecepcionEsperada
    if (data.notas !== undefined) updateData.notas = data.notas

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("ordenes_compra")
      .update(updateData)
      .eq("id", id)
      .select("*, proveedores:proveedor_id(id, nombre), users:created_by(id, nombre)")
      .single()

    if (updateError) throw updateError

    return NextResponse.json(formatOC(updated))
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    console.error("Error updating OC:", error)
    return NextResponse.json({ error: "Error al actualizar orden de compra" }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params

    const { data: oc, error: fetchError } = await supabaseAdmin
      .from("ordenes_compra")
      .select("id, estado")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !oc) {
      return NextResponse.json({ error: "Orden de compra no encontrada" }, { status: 404 })
    }

    if (oc.estado !== "BORRADOR" && oc.estado !== "CANCELADA") {
      return NextResponse.json(
        { error: "Solo se pueden eliminar órdenes en BORRADOR o CANCELADA" },
        { status: 400 }
      )
    }

    const { error: deleteError } = await supabaseAdmin
      .from("ordenes_compra")
      .delete()
      .eq("id", id)

    if (deleteError) throw deleteError

    return NextResponse.json({ message: "Orden de compra eliminada" })
  } catch (error) {
    console.error("Error deleting OC:", error)
    return NextResponse.json({ error: "Error al eliminar orden de compra" }, { status: 500 })
  }
}

function formatOC(oc: any) {
  return {
    id: oc.id,
    numeroOC: oc.numero_oc,
    estado: oc.estado,
    proveedorId: oc.proveedor_id,
    proveedor: oc.proveedores ? { id: oc.proveedores.id, nombre: oc.proveedores.nombre } : null,
    fechaEmision: oc.fecha_emision,
    fechaRecepcionEsperada: oc.fecha_recepcion_esperada,
    fechaRecepcionReal: oc.fecha_recepcion_real,
    subtotal: oc.subtotal,
    total: oc.total,
    notas: oc.notas,
    createdBy: oc.users ? { id: oc.users.id, nombre: oc.users.nombre } : null,
    createdAt: oc.created_at,
    updatedAt: oc.updated_at,
    items: oc.items_orden_compra?.map((i: any) => ({
      id: i.id,
      inventarioId: i.inventario_id,
      inventario: i.inventario ? {
        id: i.inventario.id,
        codigo: i.inventario.codigo,
        nombre: i.inventario.nombre,
        stock: i.inventario.stock,
        stockReservado: i.inventario.stock_reservado,
      } : null,
      cantidadPedida: i.cantidad_pedida,
      cantidadRecibida: i.cantidad_recibida,
      precioUnitario: i.precio_unitario,
      subtotal: i.subtotal,
    })),
  }
}
