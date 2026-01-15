import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { createAuditLogger } from "@/lib/audit"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    const { id } = await params

    let query = supabaseAdmin
      .from("ventas")
      .select(`
        *,
        clientes (*),
        users:vendedor_id (id, nombre, email),
        items_venta (*, inventario (*)),
        garantias_venta (*)
      `)
      .eq("id", id)
      .eq("organization_id", organizationId!)

    // Vendedores solo pueden ver sus propias ventas
    if (role === "VENDEDOR") {
      query = query.eq("vendedor_id", userId!)
    }

    const { data: venta, error: dbError } = await query.single()

    if (dbError) {
      if (dbError.code === "PGRST116") {
        return NextResponse.json(
          { error: "Venta no encontrada" },
          { status: 404 }
        )
      }
      throw dbError
    }

    // Formatear respuesta
    const response = {
      id: venta.id,
      numeroVenta: venta.numero_venta,
      clienteId: venta.cliente_id,
      clienteNombre: venta.cliente_nombre,
      clienteTelefono: venta.cliente_telefono,
      cliente: venta.clientes,
      vendedor: venta.users,
      vendedorId: venta.vendedor_id,
      items: venta.items_venta?.map((item: any) => ({
        id: item.id,
        inventarioId: item.inventario_id,
        inventario: item.inventario,
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        precioUnitario: item.precio_unitario,
        subtotal: item.subtotal,
        diasGarantia: item.dias_garantia,
      })) || [],
      garantias: venta.garantias_venta?.map((g: any) => ({
        id: g.id,
        numeroGarantia: g.numero_garantia,
        itemVentaId: g.item_venta_id,
        diasValidez: g.dias_validez,
        fechaInicio: g.fecha_inicio,
        fechaVencimiento: g.fecha_vencimiento,
        estado: g.estado,
      })) || [],
      subtotal: parseFloat(venta.subtotal),
      descuento: parseFloat(venta.descuento),
      total: parseFloat(venta.total),
      metodoPago: venta.metodo_pago,
      estado: venta.estado,
      observaciones: venta.observaciones,
      createdAt: venta.created_at,
      updatedAt: venta.updated_at,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error("Error fetching venta:", error)
    return NextResponse.json(
      { error: "Error al obtener venta" },
      { status: 500 }
    )
  }
}

// Anular venta (solo ADMIN)
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    // Solo ADMIN puede anular ventas
    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden anular ventas" },
        { status: 403 }
      )
    }

    const { id } = await params
    const body = await request.json()

    // Solo permitimos cambiar estado a ANULADA
    if (body.estado !== "ANULADA") {
      return NextResponse.json(
        { error: "Solo se permite anular ventas" },
        { status: 400 }
      )
    }

    // Verificar que la venta existe y pertenece a la organización
    const { data: venta, error: fetchError } = await supabaseAdmin
      .from("ventas")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !venta) {
      return NextResponse.json(
        { error: "Venta no encontrada" },
        { status: 404 }
      )
    }

    if (venta.estado === "ANULADA") {
      return NextResponse.json(
        { error: "La venta ya está anulada" },
        { status: 400 }
      )
    }

    // Anular venta (el trigger restaurará el stock)
    const { data: ventaActualizada, error: updateError } = await supabaseAdmin
      .from("ventas")
      .update({ estado: "ANULADA" })
      .eq("id", id)
      .select()
      .single()

    if (updateError) {
      throw updateError
    }

    // Registrar en auditoría
    const audit = createAuditLogger(organizationId!, userId!, request)
    await audit.update("ventas", id, { estado: "ANULADA" }, { estado: venta.estado })

    return NextResponse.json({
      ...ventaActualizada,
      numeroVenta: ventaActualizada.numero_venta,
      estado: ventaActualizada.estado,
    })
  } catch (error) {
    console.error("Error updating venta:", error)
    return NextResponse.json(
      { error: "Error al actualizar venta" },
      { status: 500 }
    )
  }
}

// Eliminar venta (solo ADMIN, solo si está anulada)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden eliminar ventas" },
        { status: 403 }
      )
    }

    const { id } = await params

    // Verificar que la venta existe y está anulada
    const { data: venta, error: fetchError } = await supabaseAdmin
      .from("ventas")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !venta) {
      return NextResponse.json(
        { error: "Venta no encontrada" },
        { status: 404 }
      )
    }

    if (venta.estado !== "ANULADA") {
      return NextResponse.json(
        { error: "Solo se pueden eliminar ventas anuladas" },
        { status: 400 }
      )
    }

    // Eliminar venta (CASCADE eliminará items y garantías)
    const { error: deleteError } = await supabaseAdmin
      .from("ventas")
      .delete()
      .eq("id", id)

    if (deleteError) {
      throw deleteError
    }

    // Registrar en auditoría
    const audit = createAuditLogger(organizationId!, userId!, request)
    await audit.delete("ventas", id, {
      numero_venta: venta.numero_venta,
      total: venta.total,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting venta:", error)
    return NextResponse.json(
      { error: "Error al eliminar venta" },
      { status: 500 }
    )
  }
}
