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

// Actualizar venta (editar o anular)
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
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

      const { clienteId, clienteNombre, clienteTelefono, items, descuento, metodoPago, observaciones } = body

      // Calcular nuevos totales
      const subtotal = items.reduce(
        (sum: number, item: any) => sum + item.cantidad * item.precioUnitario,
        0
      )
      const total = subtotal - (descuento || 0)

      // 1. Restaurar stock de items anteriores
      for (const oldItem of venta.items_venta || []) {
        if (oldItem.inventario_id) {
          await supabaseAdmin.rpc("increment_stock", {
            p_inventario_id: oldItem.inventario_id,
            p_cantidad: oldItem.cantidad,
          })
        }
      }

      // 2. Eliminar items anteriores
      await supabaseAdmin
        .from("items_venta")
        .delete()
        .eq("venta_id", id)

      // 3. Eliminar garantías anteriores
      await supabaseAdmin
        .from("garantias_venta")
        .delete()
        .eq("venta_id", id)

      // 4. Actualizar venta
      const { error: updateError } = await supabaseAdmin
        .from("ventas")
        .update({
          cliente_id: clienteId || null,
          cliente_nombre: clienteNombre,
          cliente_telefono: clienteTelefono || null,
          subtotal,
          descuento: descuento || 0,
          total,
          metodo_pago: metodoPago,
          observaciones: observaciones || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)

      if (updateError) {
        throw updateError
      }

      // 5. Crear nuevos items y descontar stock
      for (const item of items) {
        const itemSubtotal = item.cantidad * item.precioUnitario

        const { data: newItem, error: itemError } = await supabaseAdmin
          .from("items_venta")
          .insert({
            venta_id: id,
            inventario_id: item.inventarioId || null,
            descripcion: item.descripcion,
            cantidad: item.cantidad,
            precio_unitario: item.precioUnitario,
            subtotal: itemSubtotal,
            dias_garantia: item.diasGarantia || 0,
          })
          .select()
          .single()

        if (itemError) {
          throw itemError
        }

        // Descontar stock
        if (item.inventarioId) {
          await supabaseAdmin.rpc("decrement_stock", {
            p_inventario_id: item.inventarioId,
            p_cantidad: item.cantidad,
          })
        }

        // Crear garantía si tiene días
        if (item.diasGarantia > 0) {
          const fechaInicio = new Date()
          const fechaVencimiento = new Date()
          fechaVencimiento.setDate(fechaVencimiento.getDate() + item.diasGarantia)

          // Obtener el último número de garantía
          const { data: lastGarantia } = await supabaseAdmin
            .from("garantias_venta")
            .select("numero_garantia")
            .eq("organization_id", organizationId!)
            .order("numero_garantia", { ascending: false })
            .limit(1)
            .single()

          const nuevoNumeroGarantia = (lastGarantia?.numero_garantia || 0) + 1

          await supabaseAdmin.from("garantias_venta").insert({
            organization_id: organizationId,
            venta_id: id,
            item_venta_id: newItem.id,
            numero_garantia: nuevoNumeroGarantia,
            dias_validez: item.diasGarantia,
            fecha_inicio: fechaInicio.toISOString(),
            fecha_vencimiento: fechaVencimiento.toISOString(),
            estado: "ACTIVA",
          })
        }
      }

      // 6. Registrar en auditoría
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

      return NextResponse.json({ success: true })
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
