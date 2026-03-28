import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { createAuditLogger } from "@/lib/audit"
import { formatVenta } from "@/lib/db-utils"
import { z } from "zod"

const itemSchema = z.object({
  inventarioId: z.string().nullable().optional(),
  descripcion: z.string().min(1, "La descripción es requerida"),
  cantidad: z.number().int().positive("La cantidad debe ser mayor a 0"),
  precioUnitario: z.number().positive("El precio debe ser mayor a 0"),
  diasGarantia: z.number().int().min(0).default(0),
  descuento: z.number().min(0).default(0),
  tipoDescuento: z.enum(["MONTO", "PORCENTAJE"]).default("MONTO"),
  porcentajeDescuento: z.number().min(0).max(100).default(0),
})

const ventaSchema = z.object({
  clienteId: z.string().nullable().optional(),
  clienteNombre: z.string().min(1, "El nombre del cliente es requerido"),
  clienteTelefono: z.string().optional(),
  items: z.array(itemSchema).min(1, "Debe agregar al menos un item"),
  descuento: z.number().min(0).default(0),
  tipoDescuento: z.enum(["MONTO", "PORCENTAJE"]).default("MONTO"),
  porcentajeDescuento: z.number().min(0).max(100).default(0),
  metodoPago: z.enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA", "TARJETA_DEBITO", "TARJETA_CREDITO", "MERCADOPAGO", "CUENTA_CORRIENTE", "OTRO"]),
  observaciones: z.string().optional(),
  cuotas: z.number().int().min(1).nullable().optional(),
  recargoPorcentaje: z.number().min(0).nullable().optional(),
  montoOriginal: z.number().positive().nullable().optional(),
  numeroReferencia: z.string().optional(),
  descuentoMotivo: z.string().optional(),
  pagosParcial: z.boolean().optional(),
  pagos: z.array(z.object({
    metodo: z.string(),
    monto: z.number().positive(),
    referencia: z.string().nullable().optional(),
    cuotas: z.number().int().min(1).nullable().optional(),
    recargo: z.number().min(0).nullable().optional(),
    montoOriginal: z.number().positive().nullable().optional(),
  })).optional(),
})

export async function GET(request: Request) {
  try {
    const { error, organizationId, userId, role } = await requireAdminOrVendedor()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const estado = searchParams.get("estado") || ""
    const search = searchParams.get("search") || ""
    const fechaDesde = searchParams.get("fechaDesde") || ""
    const fechaHasta = searchParams.get("fechaHasta") || ""

    // Paginación
    const page = parseInt(searchParams.get("page") || "1")
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100)
    const offset = (page - 1) * limit

    // Sorting
    const sortByParam = searchParams.get("sortBy") || "createdAt"
    const sortMap: Record<string, string> = {
      createdAt: "created_at",
      numeroVenta: "numero_venta",
      clienteNombre: "cliente_nombre",
      total: "total",
    }
    const sortBy = sortMap[sortByParam] || "created_at"
    const sortOrder = searchParams.get("sortOrder") === "asc"

    let query = supabaseAdmin
      .from("ventas")
      .select(`
        *,
        clientes (*),
        users:vendedor_id (
          id,
          nombre
        ),
        items_venta (
          *,
          inventario (*)
        ),
        garantias_venta (*),
        pagos_venta (*),
        devoluciones_venta (*, items_devolucion(*))
      `, { count: "exact" })
      .eq("organization_id", organizationId!)
      .order(sortBy, { ascending: sortOrder })

    // Vendedores solo ven sus ventas
    if (role === "VENDEDOR") {
      query = query.eq("vendedor_id", userId!)
    }

    if (estado) {
      query = query.eq("estado", estado)
    }

    if (fechaDesde) {
      query = query.gte("created_at", fechaDesde)
    }

    if (fechaHasta) {
      query = query.lte("created_at", fechaHasta + "T23:59:59")
    }

    if (search) {
      const filters = [
        `cliente_nombre.ilike.%${search}%`,
        `cliente_telefono.ilike.%${search}%`,
        `observaciones.ilike.%${search}%`,
      ]

      // Si es numérico, buscar por numero_venta exacto
      const searchNum = parseInt(search, 10)
      if (!isNaN(searchNum)) {
        filters.push(`numero_venta.eq.${searchNum}`)
      }

      query = query.or(filters.join(","))
    }

    // Aplicar paginación
    query = query.range(offset, offset + limit - 1)

    const { data: ventas, error: dbError, count } = await query

    if (dbError) {
      throw dbError
    }

    // Transformar datos para el frontend
    const ventasFormatted = ventas?.map(formatVenta) || []

    return NextResponse.json({
      data: ventasFormatted,
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    })
  } catch (error) {
    console.error("Error fetching ventas:", error)
    return NextResponse.json(
      { error: "Error al obtener ventas" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const { error, organizationId, userId, role } = await requireAdminOrVendedor()
    if (error) return error

    // Solo ADMIN o VENDEDOR pueden crear ventas
    if (role !== "ADMIN" && role !== "VENDEDOR") {
      return NextResponse.json(
        { error: "No autorizado para crear ventas" },
        { status: 403 }
      )
    }

    const body = await request.json()
    const data = ventaSchema.parse(body)

    // Calcular totales
    const subtotal = data.items.reduce(
      (sum, item) => sum + item.cantidad * item.precioUnitario,
      0
    )

    let descuentoMonto = data.descuento
    if (data.tipoDescuento === "PORCENTAJE") {
      descuentoMonto = subtotal * (data.porcentajeDescuento / 100)
    }
    const total = subtotal - descuentoMonto

    // Preparar items para la función atómica
    const pItems = data.items.map(item => ({
      inventarioId: item.inventarioId || null,
      descripcion: item.descripcion,
      cantidad: item.cantidad,
      precioUnitario: item.precioUnitario,
      diasGarantia: item.diasGarantia,
      descuento: item.descuento,
      tipoDescuento: item.tipoDescuento,
      porcentajeDescuento: item.porcentajeDescuento,
    }))

    // Crear venta atómicamente
    const rpcParams: Record<string, any> = {
      p_org_id: organizationId!,
      p_vendedor_id: userId!,
      p_cliente_id: data.clienteId || null,
      p_cliente_nombre: data.clienteNombre,
      p_cliente_telefono: data.clienteTelefono || null,
      p_subtotal: subtotal,
      p_descuento: descuentoMonto,
      p_tipo_descuento: data.tipoDescuento,
      p_porcentaje_descuento: data.porcentajeDescuento,
      p_total: total,
      p_metodo_pago: data.metodoPago,
      p_observaciones: data.observaciones || null,
      p_numero_referencia: data.numeroReferencia || null,
      p_cuotas: data.cuotas || null,
      p_recargo_porcentaje: data.recargoPorcentaje || null,
      p_monto_original: data.montoOriginal || null,
      p_items: pItems,
    }

    // Pass multi-payment array if provided
    if (data.pagos && data.pagos.length > 0) {
      rpcParams.p_pagos = data.pagos
    } else if (data.pagosParcial) {
      // Deferred payment ("paga después"): send empty array
      // RPC distinguishes NULL (legacy full payment) vs empty array (no payments)
      rpcParams.p_pagos = []
    }

    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc("crear_venta_atomica", rpcParams)

    if (rpcError) {
      // Los errores de RAISE EXCEPTION vienen en error.message
      console.error("Error en crear_venta_atomica:", rpcError)
      return NextResponse.json(
        { error: rpcError.message || "Error al crear venta" },
        { status: 400 }
      )
    }

    const ventaId = rpcResult?.ventaId || rpcResult

    // Registrar aprobación de descuento si aplica
    if (descuentoMonto > 0) {
      await supabaseAdmin
        .from("ventas")
        .update({
          descuento_aprobado_por: userId!,
          descuento_motivo: data.descuentoMotivo || null,
        })
        .eq("id", ventaId)
    }

    // Obtener venta completa con relaciones
    const { data: ventaCompleta } = await supabaseAdmin
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
      .eq("id", ventaId)
      .single()

    // Registrar en auditoría
    const audit = createAuditLogger(organizationId!, userId!, request)
    await audit.create("ventas", ventaId, {
      numero_venta: ventaCompleta?.numero_venta,
      total: ventaCompleta?.total,
      items: data.items.length,
    })

    // Obtener nombre de la organización para el mensaje de WhatsApp
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("nombre, nombre_mostrar")
      .eq("id", organizationId!)
      .single()

    // Formatear respuesta
    const response = {
      ...formatVenta(ventaCompleta),
      organizationName: org?.nombre_mostrar || org?.nombre || null,
    }

    return NextResponse.json(response, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error creating venta:", error)
    return NextResponse.json(
      { error: "Error al crear venta" },
      { status: 500 }
    )
  }
}
