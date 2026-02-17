import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { generateCotizacionPDF } from "@/lib/pdf"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    if (!token || token.length !== 32) {
      return NextResponse.json(
        { error: "Token invalido" },
        { status: 400 }
      )
    }

    const { data: cotizacion, error: dbError } = await supabaseAdmin
      .from("cotizaciones")
      .select(`
        *,
        ordenes_servicio!inner (
          id, numero_orden, dispositivo, problema_reportado, organization_id,
          clientes (*),
          organizations (id, nombre_mostrar, telefono, direccion, logo_url)
        ),
        items_cotizacion (*)
      `)
      .eq("public_token", token)
      .single()

    if (dbError || !cotizacion) {
      return NextResponse.json(
        { error: "Cotizacion no encontrada" },
        { status: 404 }
      )
    }

    const org = cotizacion.ordenes_servicio.organizations

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
      firmaAprobacion: cotizacion.firma_aprobacion,
      firmaMime: cotizacion.firma_mime,
      fechaAprobacion: cotizacion.fecha_aprobacion,
    })

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${cotizacion.numero_cotizacion}.pdf"`,
        "Cache-Control": "public, max-age=3600",
      },
    })
  } catch (error) {
    console.error("Error generating public cotizacion PDF:", error)
    return NextResponse.json(
      { error: "Error al generar PDF" },
      { status: 500 }
    )
  }
}
