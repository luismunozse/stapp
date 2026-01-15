import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { getNextSaleNumber, getNextWarrantySaleNumber } from "@/lib/counters"
import { createAuditLogger } from "@/lib/audit"
import { z } from "zod"

const itemSchema = z.object({
  inventarioId: z.string().nullable().optional(),
  descripcion: z.string().min(1, "La descripción es requerida"),
  cantidad: z.number().int().positive("La cantidad debe ser mayor a 0"),
  precioUnitario: z.number().positive("El precio debe ser mayor a 0"),
  diasGarantia: z.number().int().min(0).default(0),
})

const ventaSchema = z.object({
  clienteId: z.string().nullable().optional(),
  clienteNombre: z.string().min(1, "El nombre del cliente es requerido"),
  clienteTelefono: z.string().optional(),
  items: z.array(itemSchema).min(1, "Debe agregar al menos un item"),
  descuento: z.number().min(0).default(0),
  metodoPago: z.enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA"]),
  observaciones: z.string().optional(),
})

export async function GET(request: Request) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const estado = searchParams.get("estado") || ""
    const search = searchParams.get("search") || ""
    const fechaDesde = searchParams.get("fechaDesde") || ""
    const fechaHasta = searchParams.get("fechaHasta") || ""

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
        garantias_venta (*)
      `)
      .eq("organization_id", organizationId!)
      .order("created_at", { ascending: false })

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
      query = query.or(
        `cliente_nombre.ilike.%${search}%,numero_venta::text.ilike.%${search}%,cliente_telefono.ilike.%${search}%`
      )
    }

    const { data: ventas, error: dbError } = await query

    if (dbError) {
      throw dbError
    }

    // Transformar datos para el frontend
    const ventasFormatted = ventas?.map(venta => ({
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
    }))

    return NextResponse.json(ventasFormatted)
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
    const { error, organizationId, userId, role } = await requireAuth()
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

    // Validar stock disponible para items del inventario
    for (const item of data.items) {
      if (item.inventarioId) {
        const { data: inv, error: invError } = await supabaseAdmin
          .from("inventario")
          .select("stock, nombre")
          .eq("id", item.inventarioId)
          .eq("organization_id", organizationId!)
          .single()

        if (invError || !inv) {
          return NextResponse.json(
            { error: `Producto no encontrado: ${item.descripcion}` },
            { status: 400 }
          )
        }

        if (inv.stock < item.cantidad) {
          return NextResponse.json(
            { error: `Stock insuficiente para "${inv.nombre}". Disponible: ${inv.stock}` },
            { status: 400 }
          )
        }
      }
    }

    // Obtener siguiente número de venta
    const { numero: numeroVenta } = await getNextSaleNumber(organizationId!)

    // Calcular totales
    const subtotal = data.items.reduce(
      (sum, item) => sum + item.cantidad * item.precioUnitario,
      0
    )
    const total = subtotal - data.descuento

    // Crear venta
    const { data: venta, error: dbError } = await supabaseAdmin
      .from("ventas")
      .insert({
        numero_venta: numeroVenta,
        cliente_id: data.clienteId || null,
        cliente_nombre: data.clienteNombre,
        cliente_telefono: data.clienteTelefono || null,
        vendedor_id: userId!,
        subtotal,
        descuento: data.descuento,
        total,
        metodo_pago: data.metodoPago,
        observaciones: data.observaciones || null,
        organization_id: organizationId!,
      })
      .select()
      .single()

    if (dbError) {
      throw dbError
    }

    // Insertar items de venta
    const itemsToInsert = data.items.map(item => ({
      venta_id: venta.id,
      inventario_id: item.inventarioId || null,
      descripcion: item.descripcion,
      cantidad: item.cantidad,
      precio_unitario: item.precioUnitario,
      subtotal: item.cantidad * item.precioUnitario,
      dias_garantia: item.diasGarantia,
    }))

    const { data: itemsInserted, error: itemsError } = await supabaseAdmin
      .from("items_venta")
      .insert(itemsToInsert)
      .select()

    if (itemsError) {
      // Rollback: eliminar venta
      await supabaseAdmin.from("ventas").delete().eq("id", venta.id)
      throw itemsError
    }

    // Crear garantías para items con días > 0
    const garantiasToCreate = []
    for (const item of itemsInserted || []) {
      if (item.dias_garantia > 0) {
        const numeroGarantia = await getNextWarrantySaleNumber(organizationId!)
        const fechaInicio = new Date()
        const fechaVencimiento = new Date()
        fechaVencimiento.setDate(fechaVencimiento.getDate() + item.dias_garantia)

        garantiasToCreate.push({
          venta_id: venta.id,
          item_venta_id: item.id,
          numero_garantia: numeroGarantia,
          dias_validez: item.dias_garantia,
          fecha_inicio: fechaInicio.toISOString(),
          fecha_vencimiento: fechaVencimiento.toISOString(),
          organization_id: organizationId!,
        })
      }
    }

    if (garantiasToCreate.length > 0) {
      const { error: garantiasError } = await supabaseAdmin
        .from("garantias_venta")
        .insert(garantiasToCreate)

      if (garantiasError) {
        console.error("Error creating garantias:", garantiasError)
        // No hacemos rollback, la venta ya se creó
      }
    }

    // Registrar en auditoría
    const audit = createAuditLogger(organizationId!, userId!, request)
    await audit.create("ventas", venta.id, {
      numero_venta: venta.numero_venta,
      total: venta.total,
      items: data.items.length,
      garantias: garantiasToCreate.length,
    })

    // Obtener venta completa con relaciones
    const { data: ventaCompleta } = await supabaseAdmin
      .from("ventas")
      .select(`
        *,
        clientes (*),
        users:vendedor_id (id, nombre),
        items_venta (*, inventario (*)),
        garantias_venta (*)
      `)
      .eq("id", venta.id)
      .single()

    // Formatear respuesta
    const response = {
      id: ventaCompleta.id,
      numeroVenta: ventaCompleta.numero_venta,
      clienteId: ventaCompleta.cliente_id,
      clienteNombre: ventaCompleta.cliente_nombre,
      clienteTelefono: ventaCompleta.cliente_telefono,
      cliente: ventaCompleta.clientes,
      vendedor: ventaCompleta.users,
      items: ventaCompleta.items_venta?.map((item: any) => ({
        id: item.id,
        inventarioId: item.inventario_id,
        inventario: item.inventario,
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        precioUnitario: item.precio_unitario,
        subtotal: item.subtotal,
        diasGarantia: item.dias_garantia,
      })) || [],
      garantias: ventaCompleta.garantias_venta?.map((g: any) => ({
        id: g.id,
        numeroGarantia: g.numero_garantia,
        itemVentaId: g.item_venta_id,
        diasValidez: g.dias_validez,
        fechaInicio: g.fecha_inicio,
        fechaVencimiento: g.fecha_vencimiento,
        estado: g.estado,
      })) || [],
      subtotal: parseFloat(ventaCompleta.subtotal),
      descuento: parseFloat(ventaCompleta.descuento),
      total: parseFloat(ventaCompleta.total),
      metodoPago: ventaCompleta.metodo_pago,
      estado: ventaCompleta.estado,
      observaciones: ventaCompleta.observaciones,
      createdAt: ventaCompleta.created_at,
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
