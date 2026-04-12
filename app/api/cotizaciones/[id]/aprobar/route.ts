import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const aprobarSchema = z.object({
  firmaAprobacion: z.string().min(1, "Firma requerida"),
  firmaMime: z.string().min(1, "Tipo de firma requerido"),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const data = aprobarSchema.parse(body)

    // Verificar cotización y acceso
    const { data: cotizacion, error: fetchError } = await supabaseAdmin
      .from("cotizaciones")
      .select(`*, ordenes_servicio!inner(organization_id)`)
      .eq("id", id)
      .is("deleted_at", null)
      .single()

    if (fetchError || !cotizacion) {
      return NextResponse.json({ error: "Cotización no encontrada" }, { status: 404 })
    }

    const ordenOrgId = (cotizacion.ordenes_servicio as any)?.organization_id
    if (ordenOrgId !== organizationId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }

    // Solo ENVIADA pueden aprobarse
    if (cotizacion.estado !== "ENVIADA") {
      return NextResponse.json({ error: "Solo se pueden aprobar cotizaciones enviadas" }, { status: 400 })
    }

    const { data: updatedCotizacion, error: updateError } = await supabaseAdmin
      .from("cotizaciones")
      .update({
        estado: "ACEPTADA",
        firma_aprobacion: data.firmaAprobacion,
        firma_mime: data.firmaMime,
        fecha_aprobacion: new Date().toISOString(),
      })
      .eq("id", id)
      .select(`
        *,
        ordenes_servicio (id, numero_orden, dispositivo, clientes(*)),
        items_cotizacion (*)
      `)
      .single()

    if (updateError) throw updateError

    // Reserve inventory for items linked to inventario
    try {
      await supabaseAdmin.rpc("reservar_items_cotizacion", {
        p_cotizacion_id: id,
        p_user_id: "system",
      })
    } catch (reserveErr) {
      console.error("Error reserving stock for cotizacion:", reserveErr)
    }

    return NextResponse.json({
      id: updatedCotizacion.id,
      ordenId: updatedCotizacion.orden_id,
      numeroCotizacion: updatedCotizacion.numero_cotizacion,
      estado: updatedCotizacion.estado,
      subtotal: updatedCotizacion.subtotal,
      iva: updatedCotizacion.iva,
      total: updatedCotizacion.total,
      firmaAprobacion: updatedCotizacion.firma_aprobacion,
      fechaAprobacion: updatedCotizacion.fecha_aprobacion,
      orden: {
        id: updatedCotizacion.ordenes_servicio.id,
        numeroOrden: updatedCotizacion.ordenes_servicio.numero_orden,
        dispositivo: updatedCotizacion.ordenes_servicio.dispositivo,
        cliente: updatedCotizacion.ordenes_servicio.clientes,
      },
      items: updatedCotizacion.items_cotizacion?.map((i: any) => ({
        id: i.id,
        descripcion: i.descripcion,
        cantidad: i.cantidad,
        precioUnitario: i.precio_unitario,
        subtotal: i.subtotal,
      })),
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    console.error("Error approving cotizacion:", error)
    return NextResponse.json({ error: "Error al aprobar cotizacion" }, { status: 500 })
  }
}
