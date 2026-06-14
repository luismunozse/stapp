import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatDevolucion } from "@/lib/db-utils"
import { getNextReturnNumber } from "@/lib/counters"
import { createAuditLogger } from "@/lib/audit"
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
  metodoReembolso: z.enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA", "CREDITO_TIENDA", "OTRO"]).optional(),
  reembolsoReferencia: z.string().optional(),
})

// GET: Get all returns for a sale
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdminOrVendedor()
    if (error) return error

    const { id } = await params

    // Verify the sale belongs to the organization
    const { data: venta, error: ventaError } = await supabaseAdmin
      .from("ventas")
      .select("id")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

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
    const { error, organizationId, userId, role } = await requireAdminOrVendedor()
    if (error) return error

    // Only ADMIN can create returns
    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden crear devoluciones" },
        { status: 403 }
      )
    }

    const { id } = await params
    const body = await request.json()
    const data = devolucionSchema.parse(body)

    // 1. Verify sale exists and is COMPLETADA
    const { data: venta, error: ventaError } = await supabaseAdmin
      .from("ventas")
      .select("*, items_venta (*)")
      .eq("id", id)
      .eq("organization_id", organizationId!)
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
    // Fetch existing devoluciones for this sale to calculate already returned quantities
    const { data: existingDevoluciones } = await supabaseAdmin
      .from("devoluciones_venta")
      .select("items_devolucion (*)")
      .eq("venta_id", id)

    // Build a map of already returned quantities per item_venta_id
    const returnedMap: Record<string, number> = {}
    for (const dev of existingDevoluciones || []) {
      for (const item of dev.items_devolucion || []) {
        returnedMap[item.item_venta_id] = (returnedMap[item.item_venta_id] || 0) + item.cantidad
      }
    }

    // Build a map of original items for quick lookup
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

    // 3. Calculate tipo (TOTAL if all items fully returned, PARCIAL otherwise)
    // Check if after this return, all items will be fully returned
    const newReturnedMap = { ...returnedMap }
    for (const item of data.items) {
      newReturnedMap[item.itemVentaId] = (newReturnedMap[item.itemVentaId] || 0) + item.cantidad
    }

    const allFullyReturned = (venta.items_venta || []).every(
      (original: any) => (newReturnedMap[original.id] || 0) >= original.cantidad
    )
    const tipo = allFullyReturned ? "TOTAL" : "PARCIAL"

    // 4. Calculate monto_devolucion
    const montoDevolucion = data.items.reduce(
      (sum, item) => sum + item.cantidad * item.precioUnitario,
      0
    )

    // 5. Get next return number
    const numeroDevolucion = await getNextReturnNumber(organizationId!)

    // 6. Insert devoluciones_venta
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
        procesado_por: userId!,
        organization_id: organizationId!,
        metodo_reembolso: data.metodoReembolso || null,
        reembolso_referencia: data.reembolsoReferencia || null,
        fecha_reembolso: data.metodoReembolso ? new Date().toISOString() : null,
        reembolso_procesado_por: data.metodoReembolso ? userId! : null,
      })
      .select()
      .single()

    if (devError) {
      throw devError
    }

    // 7. Insert items_devolucion
    const itemsToInsert = data.items.map((item) => ({
      devolucion_id: devolucion.id,
      item_venta_id: item.itemVentaId,
      inventario_id: item.inventarioId || null,
      cantidad: item.cantidad,
      precio_unitario: item.precioUnitario,
      subtotal: item.cantidad * item.precioUnitario,
      restaurar_stock: item.restaurarStock,
    }))

    const { error: itemsError } = await supabaseAdmin
      .from("items_devolucion")
      .insert(itemsToInsert)

    if (itemsError) {
      // Rollback: delete the devolucion
      await supabaseAdmin.from("devoluciones_venta").delete().eq("id", devolucion.id)
      throw itemsError
    }

    // 8. For items with restaurarStock=true and inventarioId, restore stock and create movimientos
    for (const item of data.items) {
      if (item.restaurarStock && item.inventarioId) {
        // Delegate stock restore + movimiento to the SQL RPC so that
        // per-deposit stock (inventario_depositos) is also updated.
        const { error: rpcError } = await supabaseAdmin.rpc(
          "registrar_devolucion_stock",
          {
            p_inventario_id: item.inventarioId,
            p_org_id: organizationId!,
            p_user_id: userId!,
            p_cantidad: item.cantidad,
            p_referencia_id: devolucion.id,
            p_observaciones: `Devolución ${numeroDevolucion} - ${data.motivo}`,
            p_deposito_id: null,
          }
        )

        if (rpcError) {
          if ((rpcError as { code?: string }).code === "P0002") {
            console.warn(`Devolución ${numeroDevolucion}: inventario ${item.inventarioId} no encontrado, stock no restaurado`)
            continue  // skip series reset too, matching old behavior
          } else {
            throw rpcError
          }
        }

        // For series-tracked items: reset the serials sold by this sale back
        // to DISPONIBLE so they match the aggregate stock just restored.
        // items_devolucion has no serie_id column (series were added in
        // migration 175, after items_devolucion in 043), so candidate series
        // are matched by (organization_id, inventario_id, venta_id, estado),
        // ordered deterministically and limited to item.cantidad.
        const { data: seriesToReset } = await supabaseAdmin
          .from("inventario_series")
          .select("id")
          .eq("organization_id", organizationId!)
          .eq("inventario_id", item.inventarioId)
          .eq("venta_id", id)
          .in("estado", ["VENDIDO", "GARANTIA_ACTIVA"])
          .order("fecha_venta", { ascending: false })
          .limit(item.cantidad)

        if (seriesToReset && seriesToReset.length > 0) {
          await supabaseAdmin
            .from("inventario_series")
            .update({
              estado: "DISPONIBLE",
              fecha_venta: null,
              venta_id: null,
              cliente_id: null,
              updated_at: new Date().toISOString(),
            })
            .in("id", seriesToReset.map((s: { id: string }) => s.id))
        }
      }
    }

    // 9. Audit log
    const audit = createAuditLogger(organizationId!, userId!, request)
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
