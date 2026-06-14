import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { createAuditLogger } from "@/lib/audit"
import { formatVenta } from "@/lib/db-utils"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAdminOrVendedor()
    if (error) return error

    const { id } = await params

    let query = supabaseAdmin
      .from("ventas")
      .select(`
        *,
        clientes (*),
        users:vendedor_id (id, nombre, email),
        items_venta (*, inventario (*)),
        garantias_venta (*),
        pagos_venta (*),
        devoluciones_venta (*, items_devolucion(*))
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

    return NextResponse.json(formatVenta(venta))
  } catch (error) {
    console.error("Error fetching venta:", error)
    return NextResponse.json(
      { error: "Error al obtener venta" },
      { status: 500 }
    )
  }
}

// Actualizar venta (editar o anular)
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAdminOrVendedor()
    if (error) return error

    const { id } = await params
    const body = await request.json()

    // Verificar que la venta existe y pertenece a la organización
    const { data: venta, error: fetchError } = await supabaseAdmin
      .from("ventas")
      .select("*, items_venta(*)")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !venta) {
      return NextResponse.json(
        { error: "Venta no encontrada" },
        { status: 404 }
      )
    }

    // CASO 1: Anular venta
    if (body.estado === "ANULADA") {
      // Solo ADMIN puede anular ventas
      if (role !== "ADMIN") {
        return NextResponse.json(
          { error: "Solo administradores pueden anular ventas" },
          { status: 403 }
        )
      }

      if (venta.estado === "ANULADA") {
        return NextResponse.json(
          { error: "La venta ya está anulada" },
          { status: 400 }
        )
      }

      // Anular venta (el trigger restaurará el stock y registrará movimientos)
      const { error: updateError } = await supabaseAdmin
        .from("ventas")
        .update({ estado: "ANULADA" })
        .eq("id", id)

      if (updateError) {
        throw updateError
      }

      // Registrar en auditoría
      const audit = createAuditLogger(organizationId!, userId!, request)
      await audit.update("ventas", id, { estado: "ANULADA" }, { estado: venta.estado })

      // Obtener venta actualizada con relaciones para respuesta
      const { data: ventaActualizada } = await supabaseAdmin
        .from("ventas")
        .select(`
          *,
          clientes (*),
          users:vendedor_id (id, nombre),
          items_venta (*, inventario (*)),
          garantias_venta (*),
          pagos_venta (*),
          devoluciones_venta (*, items_devolucion(*))
        `)
        .eq("id", id)
        .single()

      return NextResponse.json(formatVenta(ventaActualizada))
    }

    // CASO 2: Editar venta
    if (body.action === "edit") {
      // Solo ADMIN puede editar ventas
      if (role !== "ADMIN") {
        return NextResponse.json(
          { error: "Solo administradores pueden editar ventas" },
          { status: 403 }
        )
      }

      if (venta.estado === "ANULADA") {
        return NextResponse.json(
          { error: "No se puede editar una venta anulada" },
          { status: 400 }
        )
      }

      const {
        clienteId,
        clienteNombre,
        clienteTelefono,
        items,
        descuento,
        tipoDescuento,
        porcentajeDescuento,
        metodoPago,
        observaciones,
        depositoId,
      } = body

      if (depositoId !== undefined && depositoId !== null && (typeof depositoId !== "string" || depositoId.length === 0)) {
        return NextResponse.json({ error: "depositoId inválido" }, { status: 400 })
      }

      // Calcular nuevos totales
      const subtotal = items.reduce(
        (sum: number, item: any) => sum + item.cantidad * item.precioUnitario,
        0
      )

      let descuentoMonto = descuento || 0
      if (tipoDescuento === "PORCENTAJE") {
        descuentoMonto = subtotal * ((porcentajeDescuento || 0) / 100)
      }
      const total = subtotal - descuentoMonto

      // Preparar items para la función atómica
      const pItems = items.map((item: any) => ({
        inventarioId: item.inventarioId || null,
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        precioUnitario: item.precioUnitario,
        diasGarantia: item.diasGarantia || 0,
        descuento: item.descuento || 0,
        tipoDescuento: item.tipoDescuento || "MONTO",
        porcentajeDescuento: item.porcentajeDescuento || 0,
      }))

      // Editar venta atómicamente
      const { error: rpcError } = await supabaseAdmin.rpc("editar_venta_atomica", {
        p_org_id: organizationId!,
        p_user_id: userId!,
        p_venta_id: id,
        p_cliente_id: clienteId || null,
        p_cliente_nombre: clienteNombre,
        p_cliente_telefono: clienteTelefono || null,
        p_subtotal: subtotal,
        p_descuento: descuentoMonto,
        p_tipo_descuento: tipoDescuento || "MONTO",
        p_porcentaje_descuento: porcentajeDescuento || 0,
        p_total: total,
        p_metodo_pago: metodoPago,
        p_observaciones: observaciones || null,
        p_items: pItems,
        p_deposito_id: depositoId ?? null,
      })

      if (rpcError) {
        if (rpcError.code === "P0010") {
          return NextResponse.json(
            { error: "Stock insuficiente en el depósito seleccionado" },
            { status: 400 }
          )
        }
        if (rpcError.code === "P0011") {
          return NextResponse.json(
            { error: "La organización no tiene depósito principal configurado" },
            { status: 400 }
          )
        }
        console.error("Error en editar_venta_atomica:", rpcError)
        return NextResponse.json(
          { error: rpcError.message || "Error al editar venta" },
          { status: 400 }
        )
      }

      // Registrar en auditoría
      const audit = createAuditLogger(organizationId!, userId!, request)
      await audit.update("ventas", id, {
        cliente_nombre: clienteNombre,
        total,
        items_count: items.length,
      }, {
        cliente_nombre: venta.cliente_nombre,
        total: venta.total,
        items_count: venta.items_venta?.length || 0,
      })

      // Obtener venta actualizada con relaciones para respuesta
      const { data: ventaActualizada } = await supabaseAdmin
        .from("ventas")
        .select(`
          *,
          clientes (*),
          users:vendedor_id (id, nombre),
          items_venta (*, inventario (*)),
          garantias_venta (*),
          pagos_venta (*),
          devoluciones_venta (*, items_devolucion(*))
        `)
        .eq("id", id)
        .single()

      return NextResponse.json(formatVenta(ventaActualizada))
    }

    return NextResponse.json(
      { error: "Acción no válida" },
      { status: 400 }
    )
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
    const { error, organizationId, userId, role } = await requireAdminOrVendedor()
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
