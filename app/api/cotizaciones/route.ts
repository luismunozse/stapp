import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { getNextQuoteNumber } from "@/lib/counters"
import { z } from "zod"

const itemSchema = z.object({
  descripcion: z.string().min(1, "Descripción requerida"),
  cantidad: z.number().int().positive("Cantidad debe ser mayor a 0"),
  precioUnitario: z.number().positive("Precio debe ser mayor a 0"),
})

const cotizacionSchema = z.object({
  ordenId: z.string().min(1, "Orden requerida"),
  items: z.array(itemSchema).min(1, "Debe tener al menos un item"),
  notas: z.string().optional(),
  fechaVencimiento: z.string().optional(),
})

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const ordenId = searchParams.get("ordenId")
    const estado = searchParams.get("estado")

    let query = supabaseAdmin
      .from("cotizaciones")
      .select(`
        *,
        ordenes_servicio!inner (
          id,
          numero_orden,
          dispositivo,
          organization_id,
          clientes (*)
        ),
        items_cotizacion (*)
      `)
      .eq("ordenes_servicio.organization_id", organizationId!)
      .order("created_at", { ascending: false })

    if (ordenId) {
      query = query.eq("orden_id", ordenId)
    }

    if (estado) {
      query = query.eq("estado", estado)
    }

    const { data: cotizaciones, error: dbError } = await query

    if (dbError) {
      throw dbError
    }

    // Formatear respuesta
    const cotizacionesFormatted = cotizaciones?.map(c => ({
      id: c.id,
      ordenId: c.orden_id,
      numeroCotizacion: c.numero_cotizacion,
      estado: c.estado,
      fechaVencimiento: c.fecha_vencimiento,
      notas: c.notas,
      subtotal: c.subtotal,
      iva: c.iva,
      total: c.total,
      createdAt: c.created_at,
      firmaUrl: c.firma_url,
      fechaAprobacion: c.fecha_aprobacion,
      orden: {
        id: c.ordenes_servicio.id,
        numeroOrden: c.ordenes_servicio.numero_orden,
        dispositivo: c.ordenes_servicio.dispositivo,
        cliente: c.ordenes_servicio.clientes,
      },
      items: c.items_cotizacion?.map((i: any) => ({
        id: i.id,
        descripcion: i.descripcion,
        cantidad: i.cantidad,
        precioUnitario: i.precio_unitario,
        subtotal: i.subtotal,
      })),
    }))

    return NextResponse.json(cotizacionesFormatted)
  } catch (error) {
    console.error("Error fetching cotizaciones:", error)
    return NextResponse.json(
      { error: "Error al obtener cotizaciones" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden crear cotizaciones" },
        { status: 403 }
      )
    }

    const body = await request.json()
    const data = cotizacionSchema.parse(body)

    // Verificar que la orden existe y pertenece a la organización
    const { data: orden, error: ordenError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("id, organization_id, clientes(*)")
      .eq("id", data.ordenId)
      .eq("organization_id", organizationId!)
      .single()

    if (ordenError || !orden) {
      return NextResponse.json(
        { error: "Orden no encontrada" },
        { status: 404 }
      )
    }

    // Calcular totales (sin IVA)
    const items = data.items.map((item) => ({
      ...item,
      subtotal: item.cantidad * item.precioUnitario,
    }))
    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0)
    const iva = 0
    const total = subtotal

    // Obtener número de cotización atómico
    const numeroCotizacion = await getNextQuoteNumber(organizationId!)

    // Crear cotización
    const { data: cotizacion, error: createError } = await supabaseAdmin
      .from("cotizaciones")
      .insert({
        orden_id: data.ordenId,
        numero_cotizacion: numeroCotizacion,
        notas: data.notas || null,
        fecha_vencimiento: data.fechaVencimiento
          ? new Date(data.fechaVencimiento).toISOString()
          : null,
        subtotal,
        iva,
        total,
      })
      .select()
      .single()

    if (createError) {
      throw createError
    }

    // Crear items
    const { error: itemsError } = await supabaseAdmin
      .from("items_cotizacion")
      .insert(
        items.map((item) => ({
          cotizacion_id: cotizacion.id,
          descripcion: item.descripcion,
          cantidad: item.cantidad,
          precio_unitario: item.precioUnitario,
          subtotal: item.subtotal,
        }))
      )

    if (itemsError) {
      // Rollback: eliminar cotización
      await supabaseAdmin.from("cotizaciones").delete().eq("id", cotizacion.id)
      throw itemsError
    }

    // Obtener cotización completa
    const { data: cotizacionCompleta } = await supabaseAdmin
      .from("cotizaciones")
      .select(`
        *,
        ordenes_servicio (
          id,
          numero_orden,
          dispositivo,
          clientes (*)
        ),
        items_cotizacion (*)
      `)
      .eq("id", cotizacion.id)
      .single()

    return NextResponse.json({
      id: cotizacionCompleta.id,
      ordenId: cotizacionCompleta.orden_id,
      numeroCotizacion: cotizacionCompleta.numero_cotizacion,
      estado: cotizacionCompleta.estado,
      subtotal: cotizacionCompleta.subtotal,
      iva: cotizacionCompleta.iva,
      total: cotizacionCompleta.total,
      orden: {
        id: cotizacionCompleta.ordenes_servicio.id,
        numeroOrden: cotizacionCompleta.ordenes_servicio.numero_orden,
        dispositivo: cotizacionCompleta.ordenes_servicio.dispositivo,
        cliente: cotizacionCompleta.ordenes_servicio.clientes,
      },
      items: cotizacionCompleta.items_cotizacion?.map((i: any) => ({
        id: i.id,
        descripcion: i.descripcion,
        cantidad: i.cantidad,
        precioUnitario: i.precio_unitario,
        subtotal: i.subtotal,
      })),
    }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error creating cotizacion:", error)
    return NextResponse.json(
      { error: "Error al crear cotización" },
      { status: 500 }
    )
  }
}
