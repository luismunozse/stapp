import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const aprobarSchema = z.object({
  firmaAprobacion: z.string().optional().nullable(),
  firmaMime: z.string().optional().nullable(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const data = aprobarSchema.parse(body)

    // Verificar cotización via organization_id (soporta standalone y con orden)
    const { data: cotizacion, error: fetchError } = await supabaseAdmin
      .from("cotizaciones")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .single()

    if (fetchError || !cotizacion) {
      return NextResponse.json({ error: "Cotización no encontrada" }, { status: 404 })
    }

    // TECNICO sólo puede aprobar cotizaciones creadas por él mismo
    if (role === "TECNICO" && cotizacion.created_by !== userId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }

    // Solo ENVIADA pueden aprobarse
    if (cotizacion.estado !== "ENVIADA") {
      return NextResponse.json({ error: "Solo se pueden aprobar cotizaciones enviadas" }, { status: 400 })
    }

    // Cotizaciones tipo ORDEN (ligadas a un arreglo real) requieren firma.
    // PRESUPUESTO plano no — es sólo un documento que el cliente acepta internamente.
    const esPresupuesto = cotizacion.tipo === "PRESUPUESTO"
    if (!esPresupuesto && (!data.firmaAprobacion || !data.firmaMime)) {
      return NextResponse.json({ error: "La firma es requerida para aprobar" }, { status: 400 })
    }

    const { data: updatedCotizacion, error: updateError } = await supabaseAdmin
      .from("cotizaciones")
      .update({
        estado: "ACEPTADA",
        firma_aprobacion: data.firmaAprobacion || null,
        firma_mime: data.firmaMime || null,
        fecha_aprobacion: new Date().toISOString(),
      })
      .eq("id", id)
      .select(`
        *,
        ordenes_servicio (id, numero_orden, dispositivo, clientes(*)),
        clientes (*),
        items_cotizacion (*)
      `)
      .single()

    if (updateError) throw updateError

    // Reservar stock sólo si es tipo ORDEN (el PRESUPUESTO no inmoviliza inventario).
    if (!esPresupuesto) {
      try {
        await supabaseAdmin.rpc("reservar_items_cotizacion", {
          p_cotizacion_id: id,
          p_user_id: userId || "system",
        })
      } catch (reserveErr) {
        console.error("Error reserving stock for cotizacion:", reserveErr)
      }
    }

    const orden = updatedCotizacion.ordenes_servicio as any
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
      orden: orden ? {
        id: orden.id,
        numeroOrden: orden.numero_orden,
        dispositivo: orden.dispositivo,
        cliente: orden.clientes,
      } : null,
      cliente: updatedCotizacion.clientes || orden?.clientes || null,
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
