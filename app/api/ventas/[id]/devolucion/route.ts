import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatDevolucion } from "@/lib/db-utils"
import { getNextReturnNumber } from "@/lib/counters"
import { createAuditLogger } from "@/lib/audit"
import { sucursalParaLectura } from "@/lib/sucursal"
import { computeDevolucionMonto, effectivePaidUnitPrice, saleNetTotal, aggregateReturnItems, fullyReturnedItemIds } from "@/lib/devolucion-refund"
import { registrarEgresoCajaEfectivo } from "@/lib/caja-utils"
import { z } from "zod"

const itemDevolucionSchema = z.object({
  itemVentaId: z.string().min(1, "El ID del item de venta es requerido"),
  inventarioId: z.string().optional(),
  cantidad: z.number().int().positive("La cantidad debe ser mayor a 0"),
  precioUnitario: z.number().min(0, "El precio unitario debe ser mayor o igual a 0"),
  restaurarStock: z.boolean(),
})

const devolucionSchema = z.object({
  motivo: z.string().min(1, "El motivo es requerido"),
  observaciones: z.string().optional(),
  items: z.array(itemDevolucionSchema).min(1, "Debe incluir al menos un item"),
  metodoReembolso: z.enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA", "CREDITO_TIENDA", "CUENTA_CORRIENTE", "OTRO"]).optional(),
  reembolsoReferencia: z.string().optional(),
})

// Returns true when the RPC error indicates migration 247 has not been applied yet.
// Falls back to the JS implementation so the endpoint keeps working pre-migration.
function isFunctionMissingError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as Record<string, unknown>
  const code = String(e.code ?? "")
  const msg = String(e.message ?? "").toLowerCase()
  return (
    code === "PGRST202" ||
    code === "42883" ||
    msg.includes("could not find the function") ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  )
}

/**
 * Retira las series que la venta había entregado.
 *
 * `fecha_garantia_vence` está sobrecargado: `registrar_series_ingreso`
 * (175_lotes_series.sql:431) lo estampa en el ALTA con la garantía del
 * PROVEEDOR, y la venta solo lo pisa si la línea llevaba días de garantía
 * (`ELSE fecha_garantia_vence` en el RPC de venta). Por eso solo se limpia
 * cuando la fecha era del comprador (`limpiarGarantia`): si la línea se vendió
 * con 0 días, lo que hay ahí es del proveedor y borrarlo destruye dato bueno.
 *
 * Cuando sí era del comprador hay que limpiarla, porque `marcar_serie_vendida`
 * (175:535) la relee al revender la serie y la marca GARANTIA_ACTIVA heredando
 * una garantía que el nuevo cliente nunca compró.
 */
async function retirarSeriesDeVenta(args: {
  organizationId: string
  inventarioId: string
  ventaId: string
  cantidad: number
  vuelveAStock: boolean
  limpiarGarantia: boolean
}): Promise<void> {
  const { data: series } = await supabaseAdmin
    .from("inventario_series")
    .select("id")
    .eq("organization_id", args.organizationId)
    .eq("inventario_id", args.inventarioId)
    .eq("venta_id", args.ventaId)
    .in("estado", ["VENDIDO", "GARANTIA_ACTIVA"])
    .order("fecha_venta", { ascending: false })
    .limit(args.cantidad)

  if (!series || series.length === 0) return

  const ids = series.map((s: { id: string }) => s.id)

  // Al volver a stock se corta el vínculo con la venta (si no, una devolución
  // posterior de otra línea podría re-elegir la misma serie). Al quedar
  // DEVUELTO se conserva, que es el rastro de de dónde salió.
  const payload: Record<string, unknown> = args.vuelveAStock
    ? {
        estado: "DISPONIBLE",
        fecha_venta: null,
        venta_id: null,
        cliente_id: null,
        updated_at: new Date().toISOString(),
      }
    : {
        estado: "DEVUELTO",
        updated_at: new Date().toISOString(),
      }

  if (args.limpiarGarantia) payload.fecha_garantia_vence = null

  await supabaseAdmin.from("inventario_series").update(payload).in("id", ids)
}

/**
 * Marca ANULADA la garantía de cada línea totalmente devuelta.
 *
 * Solo toca las ACTIVA: una RECLAMADA ya tiene historia propia y una VENCIDA
 * cumplió su plazo — reescribirlas borraría por qué terminaron así.
 *
 * No propaga el error: la plata ya se movió y la mercadería ya cambió de manos;
 * un fallo de contabilidad de garantías no puede tirar abajo la devolución.
 */
async function anularGarantiasDeLineas(
  organizationId: string,
  itemVentaIds: string[]
): Promise<void> {
  if (itemVentaIds.length === 0) return

  const { error } = await supabaseAdmin
    .from("garantias_venta")
    .update({ estado: "ANULADA" })
    .eq("organization_id", organizationId)
    .eq("estado", "ACTIVA")
    .in("item_venta_id", itemVentaIds)

  if (error) {
    console.error("Error anulando garantias de venta devuelta:", error)
  }
}

// GET: Get all returns for a sale
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, role, session } = await requireAdminOrVendedor()
    if (error) return error

    const { id } = await params

    const filtro = await sucursalParaLectura({ role, userSucursalId: (session!.user as any).sucursalId ?? null })

    // Verify the sale belongs to the organization
    let ventaQuery = supabaseAdmin.from("ventas").select("id").eq("id", id).eq("organization_id", organizationId!)
    if (!filtro.verTodas && filtro.sucursalId) {
      ventaQuery = ventaQuery.eq("sucursal_id", filtro.sucursalId)
    }
    const { data: venta, error: ventaError } = await ventaQuery.single()

    if (ventaError || !venta) {
      return NextResponse.json(
        { error: "Venta no encontrada" },
        { status: 404 }
      )
    }

    // Fetch devoluciones with items
    const { data: devoluciones, error: dbError } = await supabaseAdmin
      .from("devoluciones_venta")
      .select("*, items_devolucion (*)")
      .eq("venta_id", id)
      .order("created_at", { ascending: false })

    if (dbError) {
      throw dbError
    }

    return NextResponse.json(
      (devoluciones || []).map(formatDevolucion)
    )
  } catch (error) {
    console.error("Error fetching devoluciones:", error)
    return NextResponse.json(
      { error: "Error al obtener devoluciones" },
      { status: 500 }
    )
  }
}

// POST: Create a return (only ADMIN)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role, session } = await requireAdminOrVendedor()
    if (error) return error

    // Only ADMIN can create returns
    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden crear devoluciones" },
        { status: 403 }
      )
    }

    const { id } = await params

    const filtroP = await sucursalParaLectura({ role, userSucursalId: (session!.user as any).sucursalId ?? null })
    let ventaCheckQuery = supabaseAdmin.from("ventas").select("id, sucursal_id").eq("id", id).eq("organization_id", organizationId!)
    if (!filtroP.verTodas && filtroP.sucursalId) {
      ventaCheckQuery = ventaCheckQuery.eq("sucursal_id", filtroP.sucursalId)
    }
    const { data: ventaCheck, error: ventaCheckError } = await ventaCheckQuery.single()
    if (ventaCheckError || !ventaCheck) {
      return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 })
    }

    const body = await request.json()
    const data = devolucionSchema.parse(body)

    // Agregar líneas con el mismo itemVentaId: sin esto, entradas duplicadas
    // pasan cada una la validación de máximo devolvible por separado y permiten
    // devolver (y reembolsar) más de lo vendido.
    data.items = aggregateReturnItems(data.items)

    // Get the return number before branching (both paths need it)
    const numeroDevolucion = await getNextReturnNumber(organizationId!)

    // --- Try atomic RPC (migration 247) ---
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
      "registrar_devolucion_atomica",
      {
        p_org_id: organizationId!,
        p_venta_id: id,
        p_user_id: userId!,
        p_numero_devolucion: numeroDevolucion,
        p_motivo: data.motivo,
        p_observaciones: data.observaciones ?? null,
        p_metodo_reembolso: data.metodoReembolso ?? null,
        p_reembolso_referencia: data.reembolsoReferencia ?? null,
        p_items: data.items.map((i) => ({
          itemVentaId: i.itemVentaId,
          inventarioId: i.inventarioId ?? null,
          cantidad: i.cantidad,
          restaurarStock: i.restaurarStock,
        })),
      }
    )

    if (rpcError) {
      // Pre-migration fallback: function doesn't exist yet
      if (isFunctionMissingError(rpcError)) {
        return await jsDevolucionFallback(id, organizationId!, userId!, numeroDevolucion, data, request)
      }

      // Map domain errors raised by the RPC
      const msg = rpcError.message ?? ""
      if (msg.includes("no encontrada")) {
        return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 })
      }
      if (msg.includes("completadas")) {
        return NextResponse.json(
          { error: "Solo se pueden crear devoluciones para ventas completadas" },
          { status: 400 }
        )
      }
      if (msg.includes("excede lo permitido") || msg.includes("no encontrado")) {
        return NextResponse.json({ error: msg }, { status: 400 })
      }

      throw rpcError
    }

    // RPC succeeded — rpcData = { id, tipo, montoDevolucion }
    const devolucionId = (rpcData as { id: string; tipo: string; montoDevolucion: number }).id

    // Fetch the full record in the same shape the route has always returned
    const { data: devolucionCompleta } = await supabaseAdmin
      .from("devoluciones_venta")
      .select("*, items_devolucion (*)")
      .eq("id", devolucionId)
      .single()

    // Audit log
    const audit = createAuditLogger(organizationId!, userId!, request)
    await audit.create("devoluciones_venta", devolucionId, {
      numero_devolucion: numeroDevolucion,
      venta_id: id,
      tipo: (rpcData as any).tipo,
      monto_devolucion: (rpcData as any).montoDevolucion,
      items_count: data.items.length,
    })

    // Reembolso en efectivo → egreso de caja (para que el arqueo cuadre).
    await registrarEgresoCajaEfectivo({
      organizationId: organizationId!,
      userId: userId!,
      sucursalId: (ventaCheck as any).sucursal_id ?? null,
      monto: (rpcData as any).montoDevolucion,
      metodoPago: data.metodoReembolso,
      concepto: `Devolución ${numeroDevolucion}`,
      observaciones: "Reembolso en efectivo de devolución de venta",
    })

    return NextResponse.json(formatDevolucion(devolucionCompleta), { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error creating devolucion:", error)
    return NextResponse.json(
      { error: "Error al crear devolución" },
      { status: 500 }
    )
  }
}

// ---------------------------------------------------------------------------
// JS fallback — identical to the original multi-step handler.
// Used when migration 247 (registrar_devolucion_atomica) is not yet applied.
// ---------------------------------------------------------------------------
async function jsDevolucionFallback(
  id: string,
  organizationId: string,
  userId: string,
  numeroDevolucion: string,
  data: z.infer<typeof devolucionSchema>,
  request: Request
): Promise<NextResponse> {
  // 1. Verify sale exists and is COMPLETADA
  const { data: venta, error: ventaError } = await supabaseAdmin
    .from("ventas")
    .select("*, items_venta (*)")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .single()

  if (ventaError || !venta) {
    return NextResponse.json(
      { error: "Venta no encontrada" },
      { status: 404 }
    )
  }

  if (venta.estado !== "COMPLETADA") {
    return NextResponse.json(
      { error: "Solo se pueden crear devoluciones para ventas completadas" },
      { status: 400 }
    )
  }

  // 2. Validate each item's cantidad doesn't exceed original minus already returned
  const { data: existingDevoluciones } = await supabaseAdmin
    .from("devoluciones_venta")
    .select("monto_devolucion, items_devolucion (*)")
    .eq("venta_id", id)

  const returnedMap: Record<string, number> = {}
  let priorRefunded = 0
  for (const dev of existingDevoluciones || []) {
    priorRefunded += Number((dev as any).monto_devolucion ?? 0)
    for (const item of dev.items_devolucion || []) {
      returnedMap[item.item_venta_id] = (returnedMap[item.item_venta_id] || 0) + item.cantidad
    }
  }

  const originalItemsMap: Record<string, any> = {}
  for (const item of venta.items_venta || []) {
    originalItemsMap[item.id] = item
  }

  for (const item of data.items) {
    const original = originalItemsMap[item.itemVentaId]
    if (!original) {
      return NextResponse.json(
        { error: `Item de venta no encontrado: ${item.itemVentaId}` },
        { status: 400 }
      )
    }

    const alreadyReturned = returnedMap[item.itemVentaId] || 0
    const maxReturnable = original.cantidad - alreadyReturned

    if (item.cantidad > maxReturnable) {
      return NextResponse.json(
        { error: `La cantidad a devolver excede lo permitido para "${original.descripcion}". Maximo: ${maxReturnable}` },
        { status: 400 }
      )
    }
  }

  // 3. Calculate tipo
  const newReturnedMap = { ...returnedMap }
  for (const item of data.items) {
    newReturnedMap[item.itemVentaId] = (newReturnedMap[item.itemVentaId] || 0) + item.cantidad
  }

  const allFullyReturned = (venta.items_venta || []).every(
    (original: any) => (newReturnedMap[original.id] || 0) >= original.cantidad
  )
  const tipo = allFullyReturned ? "TOTAL" : "PARCIAL"

  // 4. Calculate monto: porción de venta.total efectivamente pagada por las
  // unidades devueltas (neto de descuentos de línea + global + IVA). Nunca el
  // precio bruto. Espeja el RPC registrar_devolucion_atomica (migración 272).
  const montoDevolucion = computeDevolucionMonto(
    Number(venta.total ?? 0),
    (venta.items_venta || []) as any,
    data.items.map((i) => ({ itemVentaId: i.itemVentaId, cantidad: i.cantidad })),
    { priorRefunded, isTotal: tipo === "TOTAL" }
  )

  // 5. Insert devoluciones_venta
  const { data: devolucion, error: devError } = await supabaseAdmin
    .from("devoluciones_venta")
    .insert({
      venta_id: id,
      numero_devolucion: numeroDevolucion,
      motivo: data.motivo,
      tipo,
      monto_devolucion: montoDevolucion,
      estado: "COMPLETADA",
      observaciones: data.observaciones || null,
      procesado_por: userId,
      organization_id: organizationId,
      metodo_reembolso: data.metodoReembolso || null,
      reembolso_referencia: data.reembolsoReferencia || null,
      fecha_reembolso: data.metodoReembolso ? new Date().toISOString() : null,
      reembolso_procesado_por: data.metodoReembolso ? userId : null,
    })
    .select()
    .single()

  if (devError) {
    throw devError
  }

  // 6. Insert items_devolucion — precio pagado por unidad (pliega global/IVA)
  // para que los subtotales reconcilien con monto_devolucion.
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
  const saleNet = saleNetTotal((venta.items_venta || []) as any)
  const itemsToInsert = data.items.map((item) => {
    const original = originalItemsMap[item.itemVentaId]
    const precio = original ? effectivePaidUnitPrice(original, Number(venta.total ?? 0), saleNet) : 0
    return {
      devolucion_id: devolucion.id,
      item_venta_id: item.itemVentaId,
      inventario_id: item.inventarioId || null,
      cantidad: item.cantidad,
      precio_unitario: round2(precio),
      subtotal: round2(item.cantidad * precio),
      restaurar_stock: item.restaurarStock,
    }
  })

  const { error: itemsError } = await supabaseAdmin
    .from("items_devolucion")
    .insert(itemsToInsert)

  if (itemsError) {
    // Rollback: delete the devolucion
    await supabaseAdmin.from("devoluciones_venta").delete().eq("id", devolucion.id)
    throw itemsError
  }

  // 7. Stock restoration
  for (const item of data.items) {
    if (!item.inventarioId) continue

    if (item.restaurarStock) {
      const { error: rpcError } = await supabaseAdmin.rpc(
        "registrar_devolucion_stock",
        {
          p_inventario_id: item.inventarioId,
          p_org_id: organizationId,
          p_user_id: userId,
          p_cantidad: item.cantidad,
          p_referencia_id: devolucion.id,
          p_observaciones: `Devolución ${numeroDevolucion} - ${data.motivo}`,
          p_deposito_id: null,
          p_venta_id: id,
        }
      )

      if (rpcError) {
        if ((rpcError as { code?: string }).code === "P0002") {
          console.warn(`Devolución ${numeroDevolucion}: inventario ${item.inventarioId} no encontrado, stock no restaurado`)
          continue
        } else {
          throw rpcError
        }
      }
    }

    // Retirar las series de la venta con o sin reposición: la unidad dejó de
    // estar en manos del cliente en ambos casos, y dejarla en VENDIDO /
    // GARANTIA_ACTIVA la seguía contando como cubierta.
    await retirarSeriesDeVenta({
      organizationId,
      inventarioId: item.inventarioId,
      ventaId: id,
      cantidad: item.cantidad,
      // Sin reposición la unidad no vuelve al stock vendible: queda DEVUELTO,
      // que además evita que una devolución posterior de la misma línea la
      // vuelva a elegir.
      vuelveAStock: item.restaurarStock,
      // Solo si la fecha la puso esta venta. Con 0 días la línea nunca la pisó,
      // así que lo que hay es la garantía del proveedor.
      limpiarGarantia: Number(originalItemsMap[item.itemVentaId]?.dias_garantia ?? 0) > 0,
    })
  }

  // 7b. Retirar las garantías de las líneas que quedaron 100% devueltas.
  const lineasCerradas = fullyReturnedItemIds(
    (venta.items_venta || []) as any,
    returnedMap,
    data.items.map((i) => ({ itemVentaId: i.itemVentaId, cantidad: i.cantidad }))
  )
  await anularGarantiasDeLineas(organizationId, lineasCerradas)

  // 8b. Reembolso a cuenta corriente
  if (data.metodoReembolso === "CUENTA_CORRIENTE" && venta.cliente_id) {
    const { error: ccError } = await supabaseAdmin.rpc("devolver_cuenta_corriente", {
      p_org_id: organizationId,
      p_cliente_id: venta.cliente_id,
      p_monto: montoDevolucion,
      p_referencia_tipo: "VENTA",
      p_referencia_id: id,
      p_usuario_id: userId,
      p_observaciones: `Devolucion ${numeroDevolucion}`,
      // Derived from the venta's own sucursal_id (parent record), not the
      // current operator's active cookie.
      p_sucursal_id: venta.sucursal_id ?? null,
    })
    if (ccError) {
      console.error("Error reembolsando a cuenta corriente:", ccError)
    }
  }

  // 8c. Reembolso en efectivo → egreso de caja (arqueo).
  await registrarEgresoCajaEfectivo({
    organizationId,
    userId,
    sucursalId: venta.sucursal_id ?? null,
    monto: montoDevolucion,
    metodoPago: data.metodoReembolso,
    concepto: `Devolución ${numeroDevolucion}`,
    observaciones: "Reembolso en efectivo de devolución de venta",
  })

  // 9. Audit log
  const audit = createAuditLogger(organizationId, userId, request)
  await audit.create("devoluciones_venta", devolucion.id, {
    numero_devolucion: numeroDevolucion,
    venta_id: id,
    tipo,
    monto_devolucion: montoDevolucion,
    items_count: data.items.length,
  })

  // 10. Return formatted devolucion
  const { data: devolucionCompleta } = await supabaseAdmin
    .from("devoluciones_venta")
    .select("*, items_devolucion (*)")
    .eq("id", devolucion.id)
    .single()

  return NextResponse.json(formatDevolucion(devolucionCompleta), { status: 201 })
}
