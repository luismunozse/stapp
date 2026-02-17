import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { generateCotizacionPDF } from "@/lib/pdf"
import { sendCotizacionEmail } from "@/lib/email"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json({ error: "Solo administradores pueden enviar cotizaciones" }, { status: 403 })
    }

    const { id } = await params

    // Obtener cotización con todos los datos necesarios
    const { data: cotizacion, error: fetchError } = await supabaseAdmin
      .from("cotizaciones")
      .select(`
        *,
        ordenes_servicio!inner (
          id, numero_orden, dispositivo, problema_reportado, organization_id,
          clientes (*),
          organizations (id, nombre_mostrar, moneda, zona_horaria)
        ),
        items_cotizacion (*)
      `)
      .eq("id", id)
      .single()

    if (fetchError || !cotizacion) {
      return NextResponse.json({ error: "Cotización no encontrada" }, { status: 404 })
    }

    const ordenOrgId = cotizacion.ordenes_servicio.organization_id
    if (ordenOrgId !== organizationId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }

    // Verificar que el cliente tenga email
    if (!cotizacion.ordenes_servicio.clientes?.email) {
      return NextResponse.json({ error: "El cliente no tiene email registrado" }, { status: 400 })
    }

    // Generar PDF
    const pdfBuffer = await generateCotizacionPDF({
      numeroCotizacion: cotizacion.numero_cotizacion,
      fecha: cotizacion.created_at,
      fechaVencimiento: cotizacion.fecha_vencimiento,
      cliente: {
        nombre: cotizacion.ordenes_servicio.clientes.nombre,
        telefono: cotizacion.ordenes_servicio.clientes.telefono,
        email: cotizacion.ordenes_servicio.clientes.email,
        direccion: cotizacion.ordenes_servicio.clientes.direccion,
      },
      orden: {
        numeroOrden: cotizacion.ordenes_servicio.numero_orden,
        dispositivo: cotizacion.ordenes_servicio.dispositivo,
        problemaReportado: cotizacion.ordenes_servicio.problema_reportado,
      },
      items: cotizacion.items_cotizacion,
      subtotal: cotizacion.subtotal,
      iva: cotizacion.iva,
      total: cotizacion.total,
      notas: cotizacion.notas,
      nombreEmpresa: cotizacion.ordenes_servicio.organizations?.nombre_mostrar || "STApp",
      firmaAprobacion: cotizacion.firma_aprobacion,
      firmaMime: cotizacion.firma_mime,
      fechaAprobacion: cotizacion.fecha_aprobacion,
      moneda: cotizacion.ordenes_servicio.organizations?.moneda || "ARS",
      zonaHoraria: cotizacion.ordenes_servicio.organizations?.zona_horaria || "America/Argentina/Buenos_Aires",
    })

    // Enviar email
    await sendCotizacionEmail({
      email: cotizacion.ordenes_servicio.clientes.email,
      nombreCliente: cotizacion.ordenes_servicio.clientes.nombre,
      numeroCotizacion: cotizacion.numero_cotizacion,
      numeroOrden: cotizacion.ordenes_servicio.numero_orden,
      total: cotizacion.total,
      fechaVencimiento: cotizacion.fecha_vencimiento,
      pdfBuffer,
      moneda: cotizacion.ordenes_servicio.organizations?.moneda || "ARS",
      zonaHoraria: cotizacion.ordenes_servicio.organizations?.zona_horaria || "America/Argentina/Buenos_Aires",
    })

    // Actualizar estado a ENVIADA
    await supabaseAdmin.from("cotizaciones").update({ estado: "ENVIADA" }).eq("id", id)

    return NextResponse.json({
      message: "Cotización enviada exitosamente",
    })
  } catch (error) {
    console.error("Error sending cotizacion:", error)
    return NextResponse.json({ error: "Error al enviar la cotización" }, { status: 500 })
  }
}
