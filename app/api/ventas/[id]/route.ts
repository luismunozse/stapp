import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { createAuditLogger } from "@/lib/audit"
import { formatVenta } from "@/lib/db-utils"
import { sucursalParaLectura } from "@/lib/sucursal"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role, session } = await requireAdminOrVendedor()
    if (error) return error

    const { id } = await params

    const filtro = await sucursalParaLectura({ role, userSucursalId: (session!.user as any).sucursalId ?? null })

    let query = supabaseAdmin
      .from("ventas")
      .select(`
        *,
        clientes (*),
        users:vendedor_id (id, nombre, email),
        items_venta (*, inventario (*)),
        garantias_venta (*),
        pagos_venta (*),
        devoluciones_venta (*, items_devolucion(*)),
        facturas (id)
      `)
      .eq("id", id)
      .eq("organization_id", organizationId!)

    // Vendedores solo pueden ver sus propias ventas
    if (role === "VENDEDOR") {
      query = query.eq("vendedor_id", userId!)
    }

    if (!filtro.verTodas && filtro.sucursalId) {
      query = query.eq("sucursal_id", filtro.sucursalId)
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
    const { error, organizationId, userId, role, session } = await requireAdminOrVendedor()
    if (error) return error

    const { id } = await params
    const filtroW = await sucursalParaLectura({ role, userSucursalId: (session!.user as any).sucursalId ?? null })
    const body = await request.json()

    // Verificar que la venta existe y pertenece a la organización
    let ventaQuery = supabaseAdmin
      .from("ventas")
      .select("*, items_venta(*)")
      .eq("id", id)
      .eq("organization_id", organizationId!)
    if (!filtroW.verTodas && filtroW.sucursalId) {
      ventaQuery = ventaQuery.eq("sucursal_id", filtroW.sucursalId)
    }
    const { data: venta, error: fetchError } = await ventaQuery.single()

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

        // Compute totals mirroring POST logic:
      // 1) accumulate per-item net after line discounts
      // 2) apply global discount clamped to [0, subtotalNeto]
      // 3) compute IVA from org fiscal config (fetched below)
      const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

      let subtotalBruto = 0
      let descuentoItems = 0
      for (const item of items) {
        const lineaBruto = (item as any).cantidad * (item as any).precioUnitario
        subtotalBruto += lineaBruto
        const tipoDesc = (item as any).tipoDescuento || "MONTO"
        const lineaDesc =
          tipoDesc === "PORCENTAJE"
            ? lineaBruto * ((item as any).porcentajeDescuento || 0) / 100
            : Math.min((item as any).descuento || 0, lineaBruto)
        descuentoItems += lineaDesc
      }
      const subtotalNeto = subtotalBruto - descuentoItems

      let descuentoGlobal = descuento || 0
      if (tipoDescuento === "PORCENTAJE") {
        descuentoGlobal = subtotalNeto * ((porcentajeDescuento || 0) / 100)
      }
      // Clamp: global discount cannot exceed net subtotal (total never negative)
      descuentoGlobal = Math.min(Math.max(descuentoGlobal, 0), subtotalNeto)

      const subtotal = round2(subtotalBruto)
      const descuentoMonto = round2(descuentoItems + descuentoGlobal)
      const base = round2(Math.max(subtotalBruto - descuentoItems - descuentoGlobal, 0))

      // Fetch org fiscal config (IVA + redondeo) — same as POST
      const { data: orgFiscal } = await supabaseAdmin
        .from("organizations")
        .select("*")
        .eq("id", organizationId!)
        .single()
      const ivaRegimen: string = orgFiscal?.iva_regimen ?? "EXENTO"
      const ivaTasa = Number(orgFiscal?.iva_tasa ?? 0)
      const redondeoUnidad = Number(orgFiscal?.redondeo_efectivo ?? 0)

      // IVA by regime (mirrors POST)
      let ivaNeto = base
      let ivaMonto = 0
      let totalConIva = base
      if (ivaRegimen === "INCLUIDO" && ivaTasa > 0) {
        ivaNeto = round2(base / (1 + ivaTasa / 100))
        ivaMonto = round2(base - ivaNeto)
        totalConIva = base
      } else if (ivaRegimen === "ADITIVO" && ivaTasa > 0) {
        ivaNeto = base
        ivaMonto = round2(base * (ivaTasa / 100))
        totalConIva = round2(base + ivaMonto)
      }

      // Cash rounding
      const isCash = metodoPago === "EFECTIVO"
      let redondeoMonto = 0
      let total = totalConIva
      if (isCash && redondeoUnidad > 0) {
        const r = Math.round(totalConIva / redondeoUnidad) * redondeoUnidad
        redondeoMonto = round2(r - totalConIva)
        total = round2(r)
      }
      const fiscalActivo = ivaRegimen !== "EXENTO" || redondeoMonto !== 0

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

      // Bug 2 fix: recompute IVA snapshot after edit, mirroring POST behavior.
      // fiscalActivo guards the write exactly like POST does.
      if (fiscalActivo) {
        const { error: ivaError } = await supabaseAdmin
          .from("ventas")
          .update({
            iva_neto: ivaNeto,
            iva_monto: ivaMonto,
            iva_tasa: ivaTasa,
            iva_regimen: ivaRegimen,
            redondeo_monto: redondeoMonto,
          })
          .eq("id", id)

        if (ivaError) {
          console.error("Error actualizando snapshot IVA en edición:", ivaError)
          return NextResponse.json(
            { error: "Error al actualizar datos fiscales de la venta" },
            { status: 500 }
          )
        }
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
    const { error, organizationId, userId, role, session } = await requireAdminOrVendedor()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden eliminar ventas" },
        { status: 403 }
      )
    }

    const { id } = await params

    const filtroD = await sucursalParaLectura({ role, userSucursalId: (session!.user as any).sucursalId ?? null })

    // Verificar que la venta existe y está anulada
    let ventaDelQuery = supabaseAdmin
      .from("ventas")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId!)
    if (!filtroD.verTodas && filtroD.sucursalId) {
      ventaDelQuery = ventaDelQuery.eq("sucursal_id", filtroD.sucursalId)
    }
    const { data: venta, error: fetchError } = await ventaDelQuery.single()

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
