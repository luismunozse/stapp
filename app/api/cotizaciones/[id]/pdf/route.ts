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

    // Obtener cotizacion con LEFT join a ordenes_servicio (standalone support)
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
      return NextResponse.json(
        { error: "Cotizacion no encontrada" },
        { status: 404 }
      )
    }

    // Get org info from ordenes_servicio or directly
    const orden = cotizacion.ordenes_servicio
    let org = orden?.organizations

    // If no org from order, fetch directly
    if (!org) {
      const { data: orgData } = await supabaseAdmin
        .from("organizations")
        .select("id, nombre_mostrar, telefono, direccion, logo_url, moneda, zona_horaria")
        .eq("id", organizationId!)
        .single()
      org = orgData
    }

    // Get client from order or standalone
    const cliente = orden?.clientes || cotizacion.clientes

    const pdfBuffer = await generateCotizacionPDF({
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

    // Cache headers: immutable for ACEPTADA, no-cache for others
    const cacheControl = cotizacion.estado === "ACEPTADA"
      ? "public, max-age=86400, stale-while-revalidate=604800"
      : "no-cache, no-store"

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${cotizacion.numero_cotizacion}.pdf"`,
        "Cache-Control": cacheControl,
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
