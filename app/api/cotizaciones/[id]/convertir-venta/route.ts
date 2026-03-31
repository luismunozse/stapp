import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const convertSchema = z.object({
  metodoPago: z.enum([
    "EFECTIVO", "TRANSFERENCIA", "TARJETA", "TARJETA_DEBITO",
    "TARJETA_CREDITO", "MERCADOPAGO", "CUENTA_CORRIENTE", "OTRO"
  ]),
  observaciones: z.string().optional(),
  items: z.array(z.object({
    cotizacionItemId: z.string(),
    diasGarantia: z.number().int().min(0).default(0),
    inventarioId: z.string().nullable().optional(),
  })).min(1),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAdmin()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden convertir cotizaciones a venta" },
        { status: 403 }
      )
    }

    const { id } = await params
    const body = await request.json()
    const data = convertSchema.parse(body)

    // Fetch cotizacion with items
    const { data: cotizacion, error: fetchError } = await supabaseAdmin
      .from("cotizaciones")
      .select(`
        *,
        clientes (*),
        ordenes_servicio (clientes (*)),
        items_cotizacion (*)
      `)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !cotizacion) {
      return NextResponse.json(
        { error: "Cotizacion no encontrada" },
        { status: 404 }
      )
    }

    if (cotizacion.estado !== "ACEPTADA") {
      return NextResponse.json(
        { error: "Solo se pueden convertir cotizaciones aceptadas" },
        { status: 400 }
      )
    }

    // Build item map for quick lookup
    const itemMap = new Map<string, any>()
    for (const item of cotizacion.items_cotizacion || []) {
      itemMap.set(item.id, item)
    }

    // Validate all requested items exist
    for (const reqItem of data.items) {
      if (!itemMap.has(reqItem.cotizacionItemId)) {
        return NextResponse.json(
          { error: `Item de cotizacion ${reqItem.cotizacionItemId} no encontrado` },
          { status: 400 }
        )
      }
    }

    // Get client info
    const cliente = cotizacion.clientes || (cotizacion.ordenes_servicio as any)?.clientes
    const clienteNombre = cliente?.nombre || "Sin nombre"
    const clienteTelefono = cliente?.telefono || null
    const clienteId = cliente?.id || null

    // Map cotizacion items to venta items format
    const pItems = data.items.map((reqItem) => {
      const cotItem = itemMap.get(reqItem.cotizacionItemId)!
      return {
        inventarioId: reqItem.inventarioId || null,
        descripcion: cotItem.descripcion,
        cantidad: cotItem.cantidad,
        precioUnitario: Number(cotItem.precio_unitario),
        diasGarantia: reqItem.diasGarantia,
        descuento: 0,
        tipoDescuento: "MONTO" as const,
        porcentajeDescuento: 0,
      }
    })

    // Calculate totals (use cotizacion totals which already include discounts/IVA)
    const subtotal = pItems.reduce((sum, item) => sum + item.cantidad * item.precioUnitario, 0)

    // Map global discount type: cotizacion "fijo"/"porcentaje" → venta "MONTO"/"PORCENTAJE"
    const descGlobalTipo = cotizacion.descuento_global_tipo
    const descGlobalValor = Number(cotizacion.descuento_global_valor) || 0
    let tipoDescuento = "MONTO" as "MONTO" | "PORCENTAJE"
    let porcentajeDescuento = 0
    let descuentoMonto = 0

    if (descGlobalValor > 0) {
      if (descGlobalTipo === "porcentaje") {
        tipoDescuento = "PORCENTAJE"
        porcentajeDescuento = descGlobalValor
        descuentoMonto = subtotal * (descGlobalValor / 100)
      } else {
        tipoDescuento = "MONTO"
        descuentoMonto = Math.min(descGlobalValor, subtotal)
      }
    }

    const total = subtotal - descuentoMonto + Number(cotizacion.iva || 0)

    // Build observaciones with cotizacion reference
    const obsPrefix = `Convertida desde ${cotizacion.numero_cotizacion}`
    const observaciones = data.observaciones
      ? `${obsPrefix}. ${data.observaciones}`
      : obsPrefix

    // Call crear_venta_atomica RPC
    const rpcParams: Record<string, any> = {
      p_org_id: organizationId!,
      p_vendedor_id: userId!,
      p_cliente_id: clienteId,
      p_cliente_nombre: clienteNombre,
      p_cliente_telefono: clienteTelefono,
      p_subtotal: subtotal,
      p_descuento: descuentoMonto,
      p_tipo_descuento: tipoDescuento,
      p_porcentaje_descuento: porcentajeDescuento,
      p_total: total,
      p_metodo_pago: data.metodoPago,
      p_observaciones: observaciones,
      p_numero_referencia: null,
      p_cuotas: null,
      p_recargo_porcentaje: null,
      p_monto_original: null,
      p_items: pItems,
    }

    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc("crear_venta_atomica", rpcParams)

    if (rpcError) {
      console.error("Error en crear_venta_atomica:", rpcError)
      return NextResponse.json(
        { error: rpcError.message || "Error al crear venta" },
        { status: 400 }
      )
    }

    const ventaId = rpcResult?.ventaId || rpcResult

    // Get venta number for response
    const { data: venta } = await supabaseAdmin
      .from("ventas")
      .select("numero_venta")
      .eq("id", ventaId)
      .single()

    return NextResponse.json({
      ventaId,
      numeroVenta: venta?.numero_venta,
    }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error converting cotizacion to venta:", error)
    return NextResponse.json(
      { error: "Error al convertir cotizacion a venta" },
      { status: 500 }
    )
  }
}
