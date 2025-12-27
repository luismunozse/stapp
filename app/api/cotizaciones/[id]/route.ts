import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const itemSchema = z.object({
  id: z.string().optional(),
  descripcion: z.string().min(1, "Descripción requerida"),
  cantidad: z.number().int().positive("Cantidad debe ser mayor a 0"),
  precioUnitario: z.number().positive("Precio debe ser mayor a 0"),
})

const updateCotizacionSchema = z.object({
  estado: z.enum(["BORRADOR", "ENVIADA", "ACEPTADA", "RECHAZADA"]).optional(),
  notas: z.string().optional(),
  fechaVencimiento: z.string().nullable().optional(),
  items: z.array(itemSchema).optional(),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params

    const { data: cotizacion, error: dbError } = await supabaseAdmin
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
      .eq("id", id)
      .eq("ordenes_servicio.organization_id", organizationId!)
      .single()

    if (dbError || !cotizacion) {
      return NextResponse.json(
        { error: "Cotización no encontrada" },
        { status: 404 }
      )
    }

    return NextResponse.json({
      id: cotizacion.id,
      ordenId: cotizacion.orden_id,
      numeroCotizacion: cotizacion.numero_cotizacion,
      estado: cotizacion.estado,
      fechaVencimiento: cotizacion.fecha_vencimiento,
      notas: cotizacion.notas,
      subtotal: cotizacion.subtotal,
      iva: cotizacion.iva,
      total: cotizacion.total,
      createdAt: cotizacion.created_at,
      firmaUrl: cotizacion.firma_url,
      fechaAprobacion: cotizacion.fecha_aprobacion,
      orden: {
        id: cotizacion.ordenes_servicio.id,
        numeroOrden: cotizacion.ordenes_servicio.numero_orden,
        dispositivo: cotizacion.ordenes_servicio.dispositivo,
        cliente: cotizacion.ordenes_servicio.clientes,
      },
      items: cotizacion.items_cotizacion?.map((i: any) => ({
        id: i.id,
        descripcion: i.descripcion,
        cantidad: i.cantidad,
        precioUnitario: i.precio_unitario,
        subtotal: i.subtotal,
      })),
    })
  } catch (error) {
    console.error("Error fetching cotizacion:", error)
    return NextResponse.json(
      { error: "Error al obtener cotización" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden editar cotizaciones" },
        { status: 403 }
      )
    }

    const { id } = await params
    const body = await request.json()
    const data = updateCotizacionSchema.parse(body)

    // Verificar que la cotización existe
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("cotizaciones")
      .select("id, estado, ordenes_servicio!inner(organization_id)")
      .eq("id", id)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json(
        { error: "Cotización no encontrada" },
        { status: 404 }
      )
    }

    const ordenOrgId = (existing.ordenes_servicio as any)?.organization_id
    if (ordenOrgId !== organizationId) {
      return NextResponse.json(
        { error: "No autorizado" },
        { status: 403 }
      )
    }

    // No modificar items de cotizaciones aceptadas/rechazadas
    if (["ACEPTADA", "RECHAZADA"].includes(existing.estado) && data.items) {
      return NextResponse.json(
        { error: "No se puede modificar una cotización aceptada o rechazada" },
        { status: 400 }
      )
    }

    const updateData: Record<string, any> = {}

    if (data.estado !== undefined) updateData.estado = data.estado
    if (data.notas !== undefined) updateData.notas = data.notas
    if (data.fechaVencimiento !== undefined) {
      updateData.fecha_vencimiento = data.fechaVencimiento
        ? new Date(data.fechaVencimiento).toISOString()
        : null
    }

    // Si se actualizan los items, recalcular totales (sin IVA)
    if (data.items) {
      const items = data.items.map((item) => ({
        ...item,
        subtotal: item.cantidad * item.precioUnitario,
      }))
      const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0)
      const total = subtotal

      updateData.subtotal = subtotal
      updateData.iva = 0
      updateData.total = total

      // Eliminar items existentes
      await supabaseAdmin
        .from("items_cotizacion")
        .delete()
        .eq("cotizacion_id", id)

      // Crear nuevos items
      await supabaseAdmin
        .from("items_cotizacion")
        .insert(
          items.map((item) => ({
            cotizacion_id: id,
            descripcion: item.descripcion,
            cantidad: item.cantidad,
            precio_unitario: item.precioUnitario,
            subtotal: item.subtotal,
          }))
        )
    }

    // Actualizar cotización
    const { error: updateError } = await supabaseAdmin
      .from("cotizaciones")
      .update(updateData)
      .eq("id", id)

    if (updateError) {
      throw updateError
    }

    // Obtener cotización actualizada
    const { data: cotizacion } = await supabaseAdmin
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
      .eq("id", id)
      .single()

    return NextResponse.json({
      id: cotizacion.id,
      ordenId: cotizacion.orden_id,
      numeroCotizacion: cotizacion.numero_cotizacion,
      estado: cotizacion.estado,
      subtotal: cotizacion.subtotal,
      iva: cotizacion.iva,
      total: cotizacion.total,
      orden: {
        id: cotizacion.ordenes_servicio.id,
        numeroOrden: cotizacion.ordenes_servicio.numero_orden,
        dispositivo: cotizacion.ordenes_servicio.dispositivo,
        cliente: cotizacion.ordenes_servicio.clientes,
      },
      items: cotizacion.items_cotizacion?.map((i: any) => ({
        id: i.id,
        descripcion: i.descripcion,
        cantidad: i.cantidad,
        precioUnitario: i.precio_unitario,
        subtotal: i.subtotal,
      })),
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error updating cotizacion:", error)
    return NextResponse.json(
      { error: "Error al actualizar cotización" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden eliminar cotizaciones" },
        { status: 403 }
      )
    }

    const { id } = await params

    // Verificar cotización
    const { data: cotizacion, error: fetchError } = await supabaseAdmin
      .from("cotizaciones")
      .select("id, estado, ordenes_servicio!inner(organization_id)")
      .eq("id", id)
      .single()

    if (fetchError || !cotizacion) {
      return NextResponse.json(
        { error: "Cotización no encontrada" },
        { status: 404 }
      )
    }

    const ordenOrgId = (cotizacion.ordenes_servicio as any)?.organization_id
    if (ordenOrgId !== organizationId) {
      return NextResponse.json(
        { error: "No autorizado" },
        { status: 403 }
      )
    }

    if (cotizacion.estado === "ACEPTADA") {
      return NextResponse.json(
        { error: "No se puede eliminar una cotización aceptada" },
        { status: 400 }
      )
    }

    const { error: deleteError } = await supabaseAdmin
      .from("cotizaciones")
      .delete()
      .eq("id", id)

    if (deleteError) {
      throw deleteError
    }

    return NextResponse.json({ message: "Cotización eliminada" })
  } catch (error) {
    console.error("Error deleting cotizacion:", error)
    return NextResponse.json(
      { error: "Error al eliminar cotización" },
      { status: 500 }
    )
  }
}
