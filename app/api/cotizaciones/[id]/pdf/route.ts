import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { generateCotizacionPDF } from "@/lib/pdf"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params

    // Obtener cotizacion con todos los datos necesarios
    const { data: cotizacion, error: fetchError } = await supabaseAdmin
      .from("cotizaciones")
      .select(`
        *,
        ordenes_servicio!inner (
          id, numero_orden, dispositivo, problema_reportado, organization_id,
          clientes (*),
          organizations (id, nombre_mostrar, telefono, direccion, logo_url, moneda, zona_horaria)
        ),
        items_cotizacion (*)
      `)
      .eq("id", id)
      .single()

    if (fetchError || !cotizacion) {
      return NextResponse.json(
        { error: "Cotizacion no encontrada" },
        { status: 404 }
      )
    }

    // Verificar acceso a la organizacion
    if (cotizacion.ordenes_servicio.organization_id !== organizationId) {
      return NextResponse.json(
        { error: "No autorizado" },
        { status: 403 }
      )
    }

    const org = cotizacion.ordenes_servicio.organizations

    // Generar PDF con firma si existe
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
      nombreEmpresa: org?.nombre_mostrar || "STApp",
      telefonoEmpresa: org?.telefono,
      direccionEmpresa: org?.direccion,
      logoUrl: org?.logo_url,
      // Incluir firma de aprobacion si existe
      firmaAprobacion: cotizacion.firma_aprobacion,
      firmaMime: cotizacion.firma_mime,
      fechaAprobacion: cotizacion.fecha_aprobacion,
      moneda: org?.moneda || "ARS",
      zonaHoraria: org?.zona_horaria || "America/Argentina/Buenos_Aires",
    })

    // Devolver PDF como descarga
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${cotizacion.numero_cotizacion}.pdf"`,
      },
    })
  } catch (error) {
    console.error("Error generating PDF:", error)
    return NextResponse.json(
      { error: "Error al generar el PDF" },
      { status: 500 }
    )
  }
}
