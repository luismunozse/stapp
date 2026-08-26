import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaEscritura } from "@/lib/sucursal"
import { z } from "zod"

const convertSchema = z.object({
  metodoPago: z.enum([
    "EFECTIVO", "TRANSFERENCIA", "TARJETA_DEBITO",
    "TARJETA_CREDITO", "MERCADOPAGO", "CUENTA_CORRIENTE", "OTRO"
  ]),
  observaciones: z.string().optional(),
  items: z.array(z.object({
    cotizacionItemId: z.string(),
    diasGarantia: z.number().int().min(0).default(0),
    inventarioId: z.string().nullable().optional(),
  })).min(1),
})

// Returns true when the RPC error indicates the function does not exist yet
// (migration 246 not applied). Falls back to two-step JS path.
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, session, organizationId, userId, role } = await requireAuth()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden convertir cotizaciones a venta" },
        { status: 403 }
      )
    }

    const sucursalId = await sucursalParaEscritura({
      role,
      organizationId: organizationId!,
      userSucursalId: session!.user.sucursalId ?? null,
    })
    if (!sucursalId) {
      return NextResponse.json(
        { error: "La organización no tiene sucursal principal configurada" },
        { status: 500 }
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
        ordenes_servicio!cotizaciones_orden_id_fkey (sucursal_id, clientes (*)),
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

    if (cotizacion.tipo === "PRESUPUESTO") {
      return NextResponse.json(
        { error: "Los presupuestos planos deben convertirse primero a orden de servicio" },
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

    // Bug #3: sin cliente registrado, usar_cuenta_corriente no corre (el RPC lo
    // guardea por p_cliente_id) → la venta quedaría PAGADA sin debitar a nadie.
    // Mismo criterio que venta-form. Bloquear antes de crear la venta.
    if (data.metodoPago === "CUENTA_CORRIENTE" && !clienteId) {
      return NextResponse.json(
        { error: "Debe seleccionar un cliente registrado para usar cuenta corriente" },
        { status: 400 }
      )
    }

    // La venta hereda la sucursal de la orden vinculada para mantener la
    // atribución por sucursal consistente (la cotización es org-wide). Si la
    // cotización no proviene de una orden, usa la sucursal activa resuelta arriba.
    const ventaSucursalId = (cotizacion.ordenes_servicio as any)?.sucursal_id ?? sucursalId

    // Phantom-stock guard: en ACEPTAR, reservar_items_cotizacion (migration 108)
    // reserva stock para TODO item con inventario_id. Tras la venta liberamos las
    // reservas con liberar_items_cotizacion, que libera TODAS las reservas de la
    // cotización (no solo las consumidas). Por eso la conversión debe ser
    // todo-o-nada: si data.items no incluye algún item reservado, ese stock
    // quedaría liberado sin haberse consumido (fantasma). Rechazamos la conversión
    // parcial de items reservados.
    const requestedIds = new Set(data.items.map((r) => r.cotizacionItemId))
    const reservedMissing = (cotizacion.items_cotizacion || []).filter(
      (it: any) => it.inventario_id && !requestedIds.has(it.id)
    )
    if (reservedMissing.length > 0) {
      return NextResponse.json(
        {
          error:
            "La conversión a venta debe incluir todos los ítems reservados de la cotización; convertir parcialmente dejaría stock reservado sin consumir.",
        },
        { status: 400 }
      )
    }

    // Map cotizacion items to venta items format.
    // inventarioId: priorizar override del request, sino el FK guardado en el item.
    // Si null: crear_venta_atomica no descuenta stock → la reserva queda fantasma.
    // descuento por item: transferir fielmente el descuento del item de cotización
    // (descuento_tipo 'porcentaje'/'fijo' → tipoDescuento 'PORCENTAJE'/'MONTO').
    // costo: snapshot histórico (migration 182) para no perder el margen de items
    // manuales (la RPC lo ignora hoy; lo consume la migration 199).
    const pItems = data.items.map((reqItem) => {
      const cotItem = itemMap.get(reqItem.cotizacionItemId)!
      const descuentoValor = Number(cotItem.descuento_valor) || 0
      const esPorcentaje = cotItem.descuento_tipo === "porcentaje"
      return {
        inventarioId: reqItem.inventarioId ?? cotItem.inventario_id ?? null,
        descripcion: cotItem.descripcion,
        cantidad: cotItem.cantidad,
        precioUnitario: Number(cotItem.precio_unitario),
        diasGarantia: reqItem.diasGarantia,
        descuento: esPorcentaje ? 0 : descuentoValor,
        tipoDescuento: (esPorcentaje ? "PORCENTAJE" : "MONTO") as "MONTO" | "PORCENTAJE",
        porcentajeDescuento: esPorcentaje ? descuentoValor : 0,
        costo: cotItem.costo_unitario != null ? Number(cotItem.costo_unitario) : null,
      }
    })

    // Calculate totals: el subtotal de la venta debe ser la suma de los NETOS por
    // línea (igual que calcItemNeto en cotizaciones/route.ts), no el bruto. Así
    // subtotal - descuentoGlobal + IVA reproduce el total aceptado de la cotización.
    const subtotal = pItems.reduce((sum, item) => {
      const bruto = item.cantidad * item.precioUnitario
      const neto =
        item.tipoDescuento === "MONTO"
          ? Math.max(0, bruto - item.descuento)
          : Math.max(0, bruto * (1 - item.porcentajeDescuento / 100))
      return sum + neto
    }, 0)

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

    // Shared RPC params (mirrors crear_venta_atomica signature exactly)
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
      p_sucursal_id: ventaSucursalId,
      // Bug #3: registrar el pago explícito del total. Sin p_pagos el RPC marca
      // la venta PAGADA pero NO ejecuta usar_cuenta_corriente, así que una venta
      // en CUENTA_CORRIENTE nunca debitaba la cuenta del cliente. Con p_pagos, el
      // loop del RPC corre usar_cuenta_corriente para el pago en cuenta corriente.
      p_pagos: total > 0 ? [{ metodo: data.metodoPago, monto: total }] : null,
    }

    // --- Atomic RPC path (migration 246) ---
    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
      "convertir_cotizacion_venta_atomica",
      { ...rpcParams, p_cotizacion_id: id }
    )

    if (!rpcError) {
      const ventaId = rpcResult?.ventaId || rpcResult

      const { data: venta } = await supabaseAdmin
        .from("ventas")
        .select("numero_venta")
        .eq("id", ventaId)
        .single()

      return NextResponse.json(
        { ventaId, numeroVenta: venta?.numero_venta },
        { status: 201 }
      )
    }

    // Not a function-missing error → propagate
    if (!isFunctionMissingError(rpcError)) {
      console.error("Error en convertir_cotizacion_venta_atomica:", rpcError)
      return NextResponse.json(
        { error: rpcError.message || "Error al crear venta" },
        { status: 400 }
      )
    }

    // --- Two-step JS fallback (pre-migration 246) ---
    // Best-effort: sale + non-fatal liberar (cannot be atomic pre-migration)
    console.warn(
      "[convertir-venta] convertir_cotizacion_venta_atomica not found; falling back to two-step path"
    )

    const { data: fallbackResult, error: fallbackError } = await supabaseAdmin.rpc(
      "crear_venta_atomica",
      rpcParams
    )

    if (fallbackError) {
      console.error("Error en crear_venta_atomica:", fallbackError)
      return NextResponse.json(
        { error: fallbackError.message || "Error al crear venta" },
        { status: 400 }
      )
    }

    const ventaId = fallbackResult?.ventaId || fallbackResult

    // Release reservations (best-effort in fallback — cannot be atomic here)
    try {
      await supabaseAdmin.rpc("liberar_items_cotizacion", {
        p_cotizacion_id: id,
        p_user_id: userId,
        p_motivo: "Reserva consumida por conversión a venta",
      })
    } catch (releaseErr) {
      console.error("Error releasing cotizacion reservations after sale:", releaseErr)
    }

    // Cerrar la reserva del catálogo para variantes e items sin link (clases B
    // y C de la migración 314). Ahí el descuento del pedido ES el de la venta,
    // así que se cierra SIN devolver stock. Si no, la reserva queda abierta y un
    // cambio posterior a RECHAZADA dispara el trigger y acredita mercadería ya
    // despachada. La RPC atómica lo hace adentro; este camino tiene que hacerlo
    // a mano, que es justo el que corre sobre una base sin migrar.
    try {
      await supabaseAdmin.rpc("consumir_reserva_catalogo", {
        p_cotizacion_id: id,
        p_motivo: "Reserva consumida por conversión a venta",
      })
    } catch (consumeErr) {
      console.error("Error consuming catalog reservation after sale:", consumeErr)
    }

    const { data: venta } = await supabaseAdmin
      .from("ventas")
      .select("numero_venta")
      .eq("id", ventaId)
      .single()

    return NextResponse.json(
      { ventaId, numeroVenta: venta?.numero_venta },
      { status: 201 }
    )

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
