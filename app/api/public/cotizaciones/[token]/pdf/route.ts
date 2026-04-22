import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { generateCotizacionPDF } from "@/lib/pdf"
import { buildCotizacionPdfExtras } from "@/lib/cotizacion-pdf"

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
        ordenes_servicio (
          id, numero_orden, dispositivo, problema_reportado, organization_id,
          clientes (*),
          organizations (id, nombre_mostrar, telefono, direccion, logo_url, moneda, zona_horaria)
        ),
        clientes (*),
        sectores_cliente (id, nombre),
        items_cotizacion (*)
      `)
      .eq("public_token", token)
      .is("deleted_at", null)
      .single()

    if (dbError || !cotizacion) {
      return NextResponse.json(
        { error: "Cotizacion no encontrada" },
        { status: 404 }
      )
    }

    const orden = cotizacion.ordenes_servicio as any
    const cliente = orden?.clientes || cotizacion.clientes as any

    let org = orden?.organizations
    if (!org && cotizacion.organization_id) {
      const { data: orgData } = await supabaseAdmin
        .from("organizations")
        .select("id, nombre_mostrar, telefono, direccion, logo_url, moneda, zona_horaria")
        .eq("id", cotizacion.organization_id)
        .single()
      org = orgData
    }

    const pdfExtras = await buildCotizacionPdfExtras(cotizacion)

    const pdfBuffer = await generateCotizacionPDF({
      ...pdfExtras,
      numeroCotizacion: cotizacion.numero_cotizacion,
      fecha: cotizacion.created_at,
      fechaVencimiento: cotizacion.fecha_vencimiento,
      cliente: cliente ? {
        nombre: cliente.nombre,
        telefono: cliente.telefono,
        email: cliente.email,
        direccion: cliente.direccion,
      } : { nombre: "Sin cliente", telefono: "" },
      sector: cotizacion.sectores_cliente ? {
        nombre: (cotizacion.sectores_cliente as any).nombre,
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
