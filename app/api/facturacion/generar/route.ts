import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { getNextInvoiceNumber } from "@/lib/counters"
import { toArray } from "@/lib/db-utils"
import { z } from "zod"
import { construirItemsFactura } from "@/lib/facturacion/items-factura"
import { getIvaGeneral } from "@/lib/countries"

const generarFacturaSchema = z.union([
  z.object({ ordenId: z.string().min(1, "La orden es requerida") }).strict(),
  z.object({ ventaId: z.string().min(1, "La venta es requerida") }).strict(),
])

// Returns true when the RPC error indicates the function does not exist yet.
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

export async function POST(request: Request) {
  try {
    const { error, organizationId, role } = await requireAdmin()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden generar remitos" },
        { status: 403 }
      )
    }

    const body = await request.json()
    const parsedBody = generarFacturaSchema.parse(body)

    if ("ventaId" in parsedBody) {
      return await generarFacturaDesdeVenta({
        ventaId: parsedBody.ventaId,
        organizationId: organizationId!,
      })
    }

    const { ordenId } = parsedBody

    // Verificar que la orden existe, está completada y pertenece a la org
    const { data: orden, error: ordenError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select(`
        id,
        estado,
        costo_final,
        presupuesto,
        sena,
        metodo_pago_sena,
        organization_id,
        numero_orden,
        dispositivo,
        clientes (*),
        repuestos_orden (
          cantidad,
          precio_unitario,
          nombre,
          inventario_id
        ),
        servicios_orden (
          cantidad,
          precio_unitario,
          nombre
        ),
        facturas (id),
        cotizaciones!cotizaciones_orden_id_fkey (
          id,
          estado,
          total,
          items_cotizacion (
            id,
            descripcion,
            cantidad,
            precio_unitario,
            subtotal
          )
        )
      `)
      .eq("id", ordenId)
      .eq("organization_id", organizationId!)
      .single()

    if (ordenError || !orden) {
      // PGRST116 is `.single()` reporting zero rows: the ordinary 404, not a
      // failure. Any other code means the query itself broke (missing column,
      // ambiguous embed) and would otherwise reach the user as a plain "not
      // found" - which is what kept the ambiguous cotizaciones embed
      // (PGRST201) invisible for as long as it was broken.
      if (ordenError && ordenError.code !== "PGRST116") {
        console.error("[facturacion] orden query failed", {
          ordenId,
          code: ordenError.code,
          message: ordenError.message,
        })
      }
      return NextResponse.json(
        { error: "Orden no encontrada" },
        { status: 404 }
      )
    }

    if (orden.estado !== "REPARADO" && orden.estado !== "ENTREGADO") {
      return NextResponse.json(
        { error: "La orden debe estar reparada para generar remito" },
        { status: 400 }
      )
    }

    // Verificar si ya existe una factura
    // (facturas (id) is a reverse embed over the UNIQUE orden_id FK — PostgREST
    // may return it as an object instead of an array; normalize before checking)
    if (toArray(orden.facturas).length > 0) {
      return NextResponse.json(
        { error: "Ya existe un remito para esta orden" },
        { status: 400 }
      )
    }

    // Buscar cotización aprobada si existe
    const cotizacionAprobada = (orden.cotizaciones || []).find(
      (c: any) => c.estado === "ACEPTADA"
    )

    // Detalle y subtotal: prioridad cotización aprobada > costo_final > líneas
    // cargadas > presupuesto. La regla vive en construirItemsFactura, con tests.
    const { items: itemsParaFactura, subtotal: subtotalItems } = construirItemsFactura({
      cotizacion: cotizacionAprobada
        ? { total: cotizacionAprobada.total, items: cotizacionAprobada.items_cotizacion }
        : null,
      costoFinal: orden.costo_final,
      presupuesto: orden.presupuesto,
      repuestos: orden.repuestos_orden,
      servicios: (orden as any).servicios_orden,
    })

    // Arranca en el bruto de los items y mas abajo se remapea al neto fiscal.
    let subtotal = subtotalItems

    // Config fiscal de la organización (IVA). select("*") es defensivo:
    // si las columnas no existen aún (migración 229 sin aplicar) quedan undefined
    // → régimen EXENTO, sin cambio de comportamiento.
    const { data: orgFiscal } = await supabaseAdmin
      .from("organizations")
      .select("*")
      .eq("id", organizationId!)
      .single()
    const ivaRegimen: string = orgFiscal?.iva_regimen ?? "EXENTO"
    // iva_tasa en NULL significa "sin tasa propia: usar la del pais"
    // (migracion 310). Con regimen EXENTO no se aplica ninguna igual.
    const ivaTasa = Number(orgFiscal?.iva_tasa ?? getIvaGeneral(orgFiscal?.pais))

    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

    // IVA por régimen (espeja la lógica de ventas/route.ts)
    const base = subtotal
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

    const iva = ivaMonto
    const total = totalConIva
    // Remap subtotal to the fiscal neto (items stay gross; factura footer = neto+iva+total)
    subtotal = ivaNeto

    // F-C4: when total <= 0, estado must be PENDIENTE (0 >= 0 must not yield PAGADO)
    const sena = typeof orden.sena === "number" ? orden.sena : 0
    const montoAbonado = sena
    const estadoPago =
      total > 0 && montoAbonado >= total
        ? "PAGADO"
        : montoAbonado > 0
        ? "PAGADO_PARCIAL"
        : "PENDIENTE"

    // Obtener número de factura atómico
    const numeroFactura = await getNextInvoiceNumber(organizationId!)

    // Build items JSONB for RPC
    const itemsJsonb = itemsParaFactura.map((item) => ({
      cotizacion_item_id: item.cotizacionItemId || null,
      descripcion: item.descripcion,
      cantidad: item.cantidad,
      precio_unitario: item.precioUnitario,
      subtotal: item.subtotal,
      tipo: item.tipo,
    }))

    // --- Atomic RPC path (migration 249) ---
    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
      "crear_factura_atomica",
      {
        p_orden_id: ordenId,
        p_numero_factura: numeroFactura,
        p_subtotal: subtotal,
        p_iva: iva,
        p_total: total,
        p_monto_abonado: montoAbonado,
        p_estado_pago: estadoPago,
        p_cotizacion_id: cotizacionAprobada?.id || "",
        p_items: itemsJsonb,
        p_sena_monto: sena,
        p_sena_metodo: orden.metodo_pago_sena || "EFECTIVO",
      }
    )

    if (!rpcError) {
      const facturaId = (rpcResult as { id: string }).id

      // Fetch items to build the response
      const { data: itemsFactura } = await supabaseAdmin
        .from("items_factura")
        .select("*")
        .eq("factura_id", facturaId)

      return NextResponse.json(
        {
          id: facturaId,
          ordenId: ordenId,
          numeroFactura: numeroFactura,
          fecha: null, // DB default; fetching full row not needed for creation response
          subtotal,
          iva,
          total,
          estadoPago,
          cotizacionId: cotizacionAprobada?.id || null,
          items: (itemsFactura || []).map((i: any) => ({
            id: i.id,
            descripcion: i.descripcion,
            cantidad: i.cantidad,
            precioUnitario: i.precio_unitario,
            subtotal: i.subtotal,
            tipo: i.tipo,
          })),
          orden: {
            id: orden.id,
            numeroOrden: orden.numero_orden,
            dispositivo: orden.dispositivo,
            cliente: orden.clientes,
          },
        },
        { status: 201 }
      )
    }

    if (isFunctionMissingError(rpcError)) {
      console.warn("[facturacion] crear_factura_atomica not found; falling back to JS path")
      return await crearFacturaJsFallback({
        ordenId,
        orden,
        organizationId: organizationId!,
        numeroFactura,
        subtotal,
        iva,
        total,
        montoAbonado,
        estadoPago,
        cotizacionAprobada,
        itemsParaFactura,
        sena,
      })
    }

    console.error("[facturacion] Unexpected RPC error (crear):", rpcError)
    return NextResponse.json(
      { error: "Error al generar remito" },
      { status: 500 }
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error generating factura:", error)
    return NextResponse.json(
      { error: "Error al generar remito" },
      { status: 500 }
    )
  }
}

// ---------------------------------------------------------------------------
// JS fallback — used when migration 249 is not yet applied.
// Hardened: items insert error deletes the orphaned factura and returns 500.
// ---------------------------------------------------------------------------
async function crearFacturaJsFallback(opts: {
  ordenId: string
  orden: any
  organizationId: string
  numeroFactura: string | number
  subtotal: number
  iva: number
  total: number
  montoAbonado: number
  estadoPago: string
  cotizacionAprobada: any
  itemsParaFactura: Array<{
    cotizacionItemId?: string
    descripcion: string
    cantidad: number
    precioUnitario: number
    subtotal: number
    tipo: string
  }>
  sena: number
}): Promise<NextResponse> {
  const {
    ordenId,
    orden,
    organizationId,
    numeroFactura,
    subtotal,
    iva,
    total,
    montoAbonado,
    estadoPago,
    cotizacionAprobada,
    itemsParaFactura,
    sena,
  } = opts

  // Insert factura
  const { data: factura, error: createError } = await supabaseAdmin
    .from("facturas")
    .insert({
      orden_id: ordenId,
      organization_id: organizationId,
      numero_factura: numeroFactura,
      subtotal,
      iva,
      total,
      monto_abonado: montoAbonado,
      estado_pago: estadoPago,
      cotizacion_id: cotizacionAprobada?.id || null,
    })
    .select()
    .single()

  if (createError) {
    throw createError
  }

  // Insert items — on failure, delete the orphaned factura and return 500
  if (itemsParaFactura.length > 0) {
    const { error: itemsError } = await supabaseAdmin
      .from("items_factura")
      .insert(
        itemsParaFactura.map((item) => ({
          factura_id: factura.id,
          cotizacion_item_id: item.cotizacionItemId || null,
          descripcion: item.descripcion,
          cantidad: item.cantidad,
          precio_unitario: item.precioUnitario,
          subtotal: item.subtotal,
          tipo: item.tipo,
        }))
      )

    if (itemsError) {
      console.error("[facturacion] items_factura insert failed; rolling back factura:", itemsError)
      await supabaseAdmin.from("facturas").delete().eq("id", factura.id)
      return NextResponse.json(
        { error: "Error al crear items de remito" },
        { status: 500 }
      )
    }
  }

  // Insert seña as pagos_parciales — on failure, log but do not leave partial state
  // (the factura exists with correct monto_abonado; we surface the error)
  if (sena > 0) {
    const { error: senaError } = await supabaseAdmin
      .from("pagos_parciales")
      .insert({
        factura_id: factura.id,
        monto: sena,
        metodo_pago: orden.metodo_pago_sena || "EFECTIVO",
        observaciones: "Seña abonada al momento del ingreso",
      })

    if (senaError) {
      console.error("[facturacion] pagos_parciales seña insert failed:", senaError)
      // Do not delete the factura — the amount is correct; only the log entry is missing.
      // Surface the error so the caller can retry the seña registration.
      return NextResponse.json(
        { error: "Error al registrar seña como pago parcial" },
        { status: 500 }
      )
    }
  }

  // Fetch items to return in response
  const { data: itemsFactura } = await supabaseAdmin
    .from("items_factura")
    .select("*")
    .eq("factura_id", factura.id)

  return NextResponse.json(
    {
      id: factura.id,
      ordenId: factura.orden_id,
      numeroFactura: factura.numero_factura,
      fecha: factura.fecha,
      subtotal: factura.subtotal,
      iva: factura.iva,
      total: factura.total,
      estadoPago: factura.estado_pago,
      cotizacionId: cotizacionAprobada?.id || null,
      items: (itemsFactura || []).map((i: any) => ({
        id: i.id,
        descripcion: i.descripcion,
        cantidad: i.cantidad,
        precioUnitario: i.precio_unitario,
        subtotal: i.subtotal,
        tipo: i.tipo,
      })),
      orden: {
        id: orden.id,
        numeroOrden: orden.numero_orden,
        dispositivo: orden.dispositivo,
        cliente: orden.clientes,
      },
    },
    { status: 201 }
  )
}

// ---------------------------------------------------------------------------
// Venta path — POST /api/facturacion/generar { ventaId }
// ---------------------------------------------------------------------------
async function generarFacturaDesdeVenta(opts: {
  ventaId: string
  organizationId: string
}): Promise<NextResponse> {
  const { ventaId, organizationId } = opts

  const { data: venta, error: ventaError } = await supabaseAdmin
    .from("ventas")
    .select(`
      id,
      estado,
      numero_venta,
      subtotal,
      total,
      iva_neto,
      iva_monto,
      monto_abonado,
      estado_pago,
      organization_id,
      cliente_nombre,
      items_venta (
        inventario_id,
        descripcion,
        cantidad,
        precio_unitario,
        subtotal
      ),
      facturas (id)
    `)
    .eq("id", ventaId)
    .eq("organization_id", organizationId)
    .single()

  if (ventaError || !venta) {
    return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 })
  }

  if (venta.estado === "ANULADA") {
    return NextResponse.json({ error: "La venta está anulada" }, { status: 400 })
  }

  // facturas (id) is a reverse embed over the UNIQUE venta_id FK — PostgREST
  // may return it as an object instead of an array; normalize before checking.
  if (toArray(venta.facturas).length > 0) {
    return NextResponse.json(
      { error: "Ya existe un remito para esta venta" },
      { status: 400 }
    )
  }

  const iva = Number(venta.iva_monto ?? 0)
  const subtotal = venta.iva_neto != null ? Number(venta.iva_neto) : Number(venta.subtotal)
  const total = Number(venta.total)
  const montoAbonado = Number(venta.monto_abonado ?? 0)
  const estadoPago = venta.estado_pago || "PENDIENTE"

  const itemsJsonb = (venta.items_venta || []).map((item: any) => ({
    descripcion: item.descripcion,
    cantidad: item.cantidad,
    precio_unitario: item.precio_unitario,
    subtotal: item.subtotal,
    tipo: item.inventario_id ? "REPUESTO" : "OTRO",
  }))

  const numeroFactura = await getNextInvoiceNumber(organizationId)

  const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
    "crear_factura_venta_atomica",
    {
      p_venta_id: ventaId,
      p_numero_factura: numeroFactura,
      p_subtotal: subtotal,
      p_iva: iva,
      p_total: total,
      p_monto_abonado: montoAbonado,
      p_estado_pago: estadoPago,
      p_items: itemsJsonb,
    }
  )

  if (!rpcError) {
    const facturaId = (rpcResult as { id: string }).id

    const { data: itemsFactura } = await supabaseAdmin
      .from("items_factura")
      .select("*")
      .eq("factura_id", facturaId)

    return NextResponse.json(
      {
        id: facturaId,
        ventaId,
        numeroFactura,
        fecha: null,
        subtotal,
        iva,
        total,
        estadoPago,
        items: (itemsFactura || []).map((i: any) => ({
          id: i.id,
          descripcion: i.descripcion,
          cantidad: i.cantidad,
          precioUnitario: i.precio_unitario,
          subtotal: i.subtotal,
          tipo: i.tipo,
        })),
        venta: {
          id: venta.id,
          numeroVenta: venta.numero_venta,
          cliente: { nombre: venta.cliente_nombre },
        },
      },
      { status: 201 }
    )
  }

  if (isFunctionMissingError(rpcError)) {
    console.warn("[facturacion] crear_factura_venta_atomica not found; falling back to JS path")
    return await crearFacturaVentaJsFallback({
      ventaId,
      organizationId,
      venta,
      numeroFactura,
      subtotal,
      iva,
      total,
      montoAbonado,
      estadoPago,
      itemsJsonb,
    })
  }

  console.error("[facturacion] Unexpected RPC error (crear venta):", rpcError)
  return NextResponse.json({ error: "Error al generar remito" }, { status: 500 })
}

// JS fallback — used when the schema (migration 292) is applied but the RPC
// function itself is missing (partial apply). Note this does NOT cover a
// venta pre-292: without the migration, this insert fails too, since
// `facturas.venta_id` doesn't exist yet and `orden_id` is still NOT NULL.
async function crearFacturaVentaJsFallback(opts: {
  ventaId: string
  organizationId: string
  venta: any
  numeroFactura: string | number
  subtotal: number
  iva: number
  total: number
  montoAbonado: number
  estadoPago: string
  itemsJsonb: Array<{
    descripcion: string
    cantidad: number
    precio_unitario: number
    subtotal: number
    tipo: string
  }>
}): Promise<NextResponse> {
  const {
    ventaId,
    organizationId,
    venta,
    numeroFactura,
    subtotal,
    iva,
    total,
    montoAbonado,
    estadoPago,
    itemsJsonb,
  } = opts

  const { data: factura, error: createError } = await supabaseAdmin
    .from("facturas")
    .insert({
      venta_id: ventaId,
      organization_id: organizationId,
      numero_factura: numeroFactura,
      subtotal,
      iva,
      total,
      monto_abonado: montoAbonado,
      estado_pago: estadoPago,
    })
    .select()
    .single()

  if (createError) {
    throw createError
  }

  if (itemsJsonb.length > 0) {
    const { error: itemsError } = await supabaseAdmin
      .from("items_factura")
      .insert(
        itemsJsonb.map((item) => ({
          factura_id: factura.id,
          descripcion: item.descripcion,
          cantidad: item.cantidad,
          precio_unitario: item.precio_unitario,
          subtotal: item.subtotal,
          tipo: item.tipo,
        }))
      )

    if (itemsError) {
      console.error("[facturacion] items_factura insert failed (venta); rolling back factura:", itemsError)
      await supabaseAdmin.from("facturas").delete().eq("id", factura.id)
      return NextResponse.json({ error: "Error al crear items de remito" }, { status: 500 })
    }
  }

  const { data: itemsFactura } = await supabaseAdmin
    .from("items_factura")
    .select("*")
    .eq("factura_id", factura.id)

  return NextResponse.json(
    {
      id: factura.id,
      ventaId: factura.venta_id,
      numeroFactura: factura.numero_factura,
      fecha: factura.fecha,
      subtotal: factura.subtotal,
      iva: factura.iva,
      total: factura.total,
      estadoPago: factura.estado_pago,
      items: (itemsFactura || []).map((i: any) => ({
        id: i.id,
        descripcion: i.descripcion,
        cantidad: i.cantidad,
        precioUnitario: i.precio_unitario,
        subtotal: i.subtotal,
        tipo: i.tipo,
      })),
      venta: {
        id: venta.id,
        numeroVenta: venta.numero_venta,
        cliente: { nombre: venta.cliente_nombre },
      },
    },
    { status: 201 }
  )
}
