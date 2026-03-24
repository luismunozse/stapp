import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { generateCotizacionPDF } from "@/lib/pdf"
import { sendCotizacionEmail } from "@/lib/email"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, role } = await requireAdmin()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json({ error: "Solo administradores pueden enviar cotizaciones" }, { status: 403 })
    }

    const { id } = await params

    // Obtener cotización con LEFT join (standalone support)
    const { data: cotizacion, error: fetchError } = await supabaseAdmin
      .from("cotizaciones")
      .select(`
        *,
        ordenes_servicio (
          id, numero_orden, dispositivo, problema_reportado, organization_id,
          clientes (*),
          organizations (id, nombre_mostrar, telefono, direccion, logo_url, moneda, zona_horaria)
        ),
        clientes (*),
        sectores_cliente (id, nombre),
        items_cotizacion (*)
      `)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !cotizacion) {
      return NextResponse.json({ error: "Cotización no encontrada" }, { status: 404 })
    }

    const orden = cotizacion.ordenes_servicio
    const cliente = orden?.clientes || cotizacion.clientes

    // Verificar que el cliente tenga email
    if (!cliente?.email) {
      return NextResponse.json({ error: "El cliente no tiene email registrado" }, { status: 400 })
    }

    // Get org info
    let org = orden?.organizations
    if (!org) {
      const { data: orgData } = await supabaseAdmin
        .from("organizations")
        .select("id, nombre_mostrar, telefono, direccion, logo_url, moneda, zona_horaria")
        .eq("id", organizationId!)
        .single()
      org = orgData
    }

    // Generar PDF
    const pdfBuffer = await generateCotizacionPDF({
      numeroCotizacion: cotizacion.numero_cotizacion,
      fecha: cotizacion.created_at,
      fechaVencimiento: cotizacion.fecha_vencimiento,
      cliente: {
        nombre: cliente.nombre,
        telefono: cliente.telefono,
        email: cliente.email,
        direccion: cliente.direccion,
      },
      sector: cotizacion.sectores_cliente ? {
        nombre: cotizacion.sectores_cliente.nombre,
      } : undefined,
      orden: orden ? {
        numeroOrden: orden.numero_orden,
        dispositivo: orden.dispositivo,
        problemaReportado: orden.problema_reportado,
      } : undefined,
      items: cotizacion.items_cotizacion,
      subtotal: cotizacion.subtotal,
      iva: cotizacion.iva,
      total: cotizacion.total,
      notas: cotizacion.notas,
      terminos: cotizacion.terminos,
      descuentoGlobalTipo: cotizacion.descuento_global_tipo,
      descuentoGlobalValor: cotizacion.descuento_global_valor,
      ivaPorcentaje: cotizacion.iva_porcentaje,
      nombreEmpresa: org?.nombre_mostrar || "STApp",
      telefonoEmpresa: org?.telefono,
      direccionEmpresa: org?.direccion,
      logoUrl: org?.logo_url,
      firmaAprobacion: cotizacion.firma_aprobacion,
      firmaMime: cotizacion.firma_mime,
      fechaAprobacion: cotizacion.fecha_aprobacion,
      moneda: org?.moneda || "ARS",
      zonaHoraria: org?.zona_horaria || "America/Argentina/Buenos_Aires",
    })

    // Enviar email
    await sendCotizacionEmail({
      email: cliente.email,
      nombreCliente: cliente.nombre,
      numeroCotizacion: cotizacion.numero_cotizacion,
      numeroOrden: orden?.numero_orden,
      total: cotizacion.total,
      fechaVencimiento: cotizacion.fecha_vencimiento,
      pdfBuffer,
      moneda: org?.moneda || "ARS",
      zonaHoraria: org?.zona_horaria || "America/Argentina/Buenos_Aires",
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
