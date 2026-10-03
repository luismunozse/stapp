import { NextResponse } from "next/server"
import { requirePosAccess, soloVeSusVentas } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { createAuditLogger } from "@/lib/audit"
import { formatVenta } from "@/lib/db-utils"
import { sucursalParaLectura } from "@/lib/sucursal"
import { getIvaGeneral } from "@/lib/countries"
import { z } from "zod"
import {
  calcularTotalesVenta,
  esCobroEnEfectivo,
  round2,
  type DescuentoConfig,
  type FiscalConfig,
  type IvaRegimen,
} from "@/lib/ventas/totales"
import { RELACIONES_BLOQUEO_VENTA, mensajeBloqueoSql, motivoNoEditable } from "@/lib/ventas/bloqueos"

const METODOS_PAGO = [
  "EFECTIVO", "TRANSFERENCIA", "TARJETA", "TARJETA_DEBITO", "TARJETA_CREDITO",
  "MERCADOPAGO", "CUENTA_CORRIENTE", "OTRO",
] as const

const editItemSchema = z.object({
  inventarioId: z.string().nullable().optional(),
  descripcion: z.string().trim().min(1, "La descripción es requerida"),
  cantidad: z.number().int().positive("La cantidad debe ser mayor a 0"),
  precioUnitario: z.number().positive("El precio debe ser mayor a 0"),
  diasGarantia: z.number().int().min(0).default(0),
  descuento: z.number().min(0).default(0),
  tipoDescuento: z.enum(["MONTO", "PORCENTAJE"]).default("MONTO"),
  porcentajeDescuento: z.number().min(0).max(100).default(0),
})

const editVentaSchema = z.object({
  clienteId: z.string().nullable().optional(),
  clienteNombre: z.string().trim().min(1, "El nombre del cliente es requerido"),
  clienteTelefono: z.string().nullable().optional(),
  items: z.array(editItemSchema).min(1, "Debe agregar al menos un item"),
  descuento: z.number().min(0).default(0),
  tipoDescuento: z.enum(["MONTO", "PORCENTAJE"]).default("MONTO"),
  porcentajeDescuento: z.number().min(0).max(100).default(0),
  metodoPago: z.enum(METODOS_PAGO).optional(),
  observaciones: z.string().nullable().optional(),
  depositoId: z.string().min(1, "depositoId inválido").nullable().optional(),
})

function lista<T = any>(x: unknown): T[] {
  return Array.isArray(x) ? (x as T[]) : x ? [x as T] : []
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role, session } = await requirePosAccess()
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
    if (soloVeSusVentas(role)) {
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
    const { error, organizationId, userId, role, session } = await requirePosAccess()
    if (error) return error

    const { id } = await params
    const filtroW = await sucursalParaLectura({ role, userSucursalId: (session!.user as any).sucursalId ?? null })
    const body = await request.json()

    // Verificar que la venta existe y pertenece a la organización
    let ventaQuery = supabaseAdmin
      .from("ventas")
      .select(`*, items_venta(*), pagos_venta(metodo_pago, monto), ${RELACIONES_BLOQUEO_VENTA}`)
      .eq("id", id)
      .eq("organization_id", organizationId!)
    if (!filtroW.verTodas && filtroW.sucursalId) {
      ventaQuery = ventaQuery.eq("sucursal_id", filtroW.sucursalId)
    }
    const { data: venta, error: fetchError } = await ventaQuery.single()

    if (fetchError && fetchError.code !== "PGRST116") {
      console.error("Error cargando la venta a actualizar:", fetchError)
      return NextResponse.json({ error: "Error al cargar la venta" }, { status: 500 })
    }
    if (!venta) {
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

      const parsed = editVentaSchema.safeParse(body)
      if (!parsed.success) {
        const first = parsed.error.errors[0]
        const field = first.path.join(".")
        return NextResponse.json(
          { error: field ? `${field}: ${first.message}` : first.message },
          { status: 400 }
        )
      }
      const data = parsed.data

      // Lo mismo que controla editar_venta_atomica (mig 328), acá para dar el
      // motivo antes de tocar nada y para proteger aunque la migración no esté.
      const bloqueo = motivoNoEditable(venta)
      if (bloqueo) {
        return NextResponse.json({ error: `No se puede editar: ${bloqueo}` }, { status: 409 })
      }

      const clienteId = data.clienteId || null
      if (clienteId) {
        const { data: cliente } = await supabaseAdmin
          .from("clientes")
          .select("id")
          .eq("id", clienteId)
          .eq("organization_id", organizationId!)
          .maybeSingle()
        if (!cliente) {
          return NextResponse.json({ error: "Cliente no encontrado" }, { status: 400 })
        }
      }

      // Los cobros ya están en la caja: el método de una venta cobrada no se
      // cambia desde acá (solo cambiaría la cabecera, no los pagos).
      const pagosVenta = lista<{ metodo_pago: string; monto: string | number }>(venta.pagos_venta).map((p) => ({
        metodo: p.metodo_pago,
        monto: Number(p.monto) || 0,
      }))
      const metodoActual: string = venta.metodo_pago || "EFECTIVO"
      if (data.metodoPago && data.metodoPago !== metodoActual && pagosVenta.length > 0) {
        return NextResponse.json(
          { error: "El método de pago de una venta cobrada no se cambia desde la edición." },
          { status: 400 }
        )
      }
      const metodoPago = data.metodoPago ?? metodoActual

      // Totales con la misma función que el POS y el alta. Los precios ya
      // traen el recargo del método con el que se vendió (factor 1). El
      // redondeo aplica si lo cobrado fue todo en efectivo.
      const { data: orgFiscal } = await supabaseAdmin
        .from("organizations")
        .select("*")
        .eq("id", organizationId!)
        .single()
      const ivaRegimen: string = orgFiscal?.iva_regimen ?? "EXENTO"
      // iva_tasa en NULL significa "sin tasa propia: usar la del pais"
      // (migracion 310). Con regimen EXENTO no se aplica ninguna igual.
      const ivaTasa = Number(orgFiscal?.iva_tasa ?? getIvaGeneral(orgFiscal?.pais))
      const fiscal: FiscalConfig = {
        regimen: ivaRegimen as IvaRegimen,
        tasa: ivaTasa,
        redondeoEfectivo: Number(orgFiscal?.redondeo_efectivo ?? 0),
      }
      const descuentoGlobal: DescuentoConfig =
        data.tipoDescuento === "PORCENTAJE"
          ? { tipo: "PORCENTAJE", valor: data.porcentajeDescuento }
          : { tipo: "MONTO", valor: data.descuento }
      const totales = calcularTotalesVenta(data.items, descuentoGlobal, fiscal, esCobroEnEfectivo(pagosVenta), 1)
      const total = totales.total
      const fiscalActivo = ivaRegimen !== "EXENTO" || totales.redondeo !== 0

      // Lo cobrado no cambia: el total nuevo no puede quedar por debajo, y si
      // hay saldo en la cuenta de un cliente, el cliente no se puede cambiar.
      const abonado = Number(venta.monto_abonado) || 0
      if (total < abonado) {
        return NextResponse.json(
          {
            error: `No se puede editar: el nuevo total (${total}) es menor a lo ya cobrado (${abonado}). Para devolver dinero registrá una devolución.`,
          },
          { status: 409 }
        )
      }
      const pendienteViejo = Math.max(round2((Number(venta.total) || 0) - abonado), 0)
      const pendienteNuevo = Math.max(round2(total - abonado), 0)
      if (pendienteViejo > 0 && venta.cliente_id && clienteId !== venta.cliente_id) {
        return NextResponse.json(
          { error: "No se puede editar: la venta tiene saldo pendiente en la cuenta del cliente: no se puede cambiar el cliente." },
          { status: 409 }
        )
      }

      const pItems = data.items.map((item) => ({
        inventarioId: item.inventarioId || null,
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        precioUnitario: item.precioUnitario,
        diasGarantia: item.diasGarantia,
        descuento: item.tipoDescuento === "PORCENTAJE" ? 0 : item.descuento,
        tipoDescuento: item.tipoDescuento,
        porcentajeDescuento: item.tipoDescuento === "PORCENTAJE" ? item.porcentajeDescuento : 0,
      }))

      // Editar venta atómicamente
      const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc("editar_venta_atomica", {
        p_org_id: organizationId!,
        p_user_id: userId!,
        p_venta_id: id,
        p_cliente_id: clienteId,
        p_cliente_nombre: data.clienteNombre,
        p_cliente_telefono: data.clienteTelefono || null,
        p_subtotal: totales.subtotal,
        p_descuento: totales.descuentoTotal,
        p_tipo_descuento: data.tipoDescuento,
        p_porcentaje_descuento: data.porcentajeDescuento,
        p_total: total,
        p_metodo_pago: metodoPago,
        p_observaciones: data.observaciones || null,
        p_items: pItems,
        p_deposito_id: data.depositoId ?? null,
      })

      if (rpcError) {
        if (rpcError.code === "P0021") {
          return NextResponse.json(
            { error: `No se puede editar: ${mensajeBloqueoSql(rpcError.message)}` },
            { status: 409 }
          )
        }
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

      // Sin la migración 328 el RPC no recalcula el estado de pago ni la deuda
      // del cliente: se hace acá. Con la 328 viene en la respuesta y ya está.
      const rpcNuevo = rpcResult && typeof rpcResult === "object" && "estadoPago" in rpcResult
      const cambiosPosteriores: Record<string, unknown> = {}
      if (!rpcNuevo) {
        cambiosPosteriores.estado_pago = abonado >= total ? "PAGADO" : abonado > 0 ? "PAGADO_PARCIAL" : "PENDIENTE"
        const ajuste = !clienteId
          ? 0
          : clienteId === venta.cliente_id
            ? round2(pendienteNuevo - pendienteViejo)
            : pendienteNuevo
        if (ajuste !== 0) {
          // cargar_deuda resta p_monto del saldo: con un monto negativo lo
          // devuelve. Queda como CARGO de la venta, que la anulación revierte.
          const { error: ccError } = await supabaseAdmin.rpc("cargar_deuda_cuenta_corriente", {
            p_org_id: organizationId!,
            p_cliente_id: clienteId,
            p_monto: ajuste,
            p_referencia_tipo: "VENTA",
            p_referencia_id: id,
            p_usuario_id: userId!,
            p_sucursal_id: venta.sucursal_id ?? null,
          })
          if (ccError) console.error("Error ajustando la cuenta corriente al editar la venta:", ccError)
        }
      }

      // Snapshot fiscal recalculado. La venta ya está editada: si esto falla
      // se avisa, pero no se responde como si la edición no hubiera pasado.
      if (fiscalActivo) {
        Object.assign(cambiosPosteriores, {
          iva_neto: totales.neto,
          iva_monto: totales.iva,
          iva_tasa: ivaTasa,
          iva_regimen: ivaRegimen,
          redondeo_monto: totales.redondeo,
        })
      }
      let advertencia: string | undefined
      if (Object.keys(cambiosPosteriores).length > 0) {
        const { error: updError } = await supabaseAdmin
          .from("ventas")
          .update(cambiosPosteriores)
          .eq("id", id)
        if (updError) {
          console.error("Error actualizando la venta después de editarla:", updError)
          advertencia = "La venta se editó, pero no se pudieron guardar el IVA y el estado de pago. Volvé a abrirla para revisarla."
        }
      }

      // Registrar en auditoría
      const audit = createAuditLogger(organizationId!, userId!, request)
      await audit.update("ventas", id, {
        cliente_nombre: data.clienteNombre,
        total,
        items_count: data.items.length,
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

      return NextResponse.json({
        ...formatVenta(ventaActualizada),
        ...(advertencia ? { advertencia } : {}),
      })
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
    const { error, organizationId, userId, role, session } = await requirePosAccess()
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
