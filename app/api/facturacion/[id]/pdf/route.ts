import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { generateFacturaPDF } from "@/lib/pdf"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params

    // Obtener factura con relaciones
    const { data: factura, error: dbError } = await supabaseAdmin
      .from("facturas")
      .select(`
        *,
        ordenes_servicio!inner (
          id,
          numero_orden,
          codigo_orden,
          dispositivo,
          organization_id,
          clientes (nombre, telefono, email, direccion),
          organizations (
            nombre,
            nombre_mostrar,
            telefono,
            direccion,
            logo_url,
            moneda,
            zona_horaria
          )
        ),
        pagos_parciales (*)
      `)
      .eq("id", id)
      .eq("ordenes_servicio.organization_id", organizationId!)
      .single()

    if (dbError || !factura) {
      if (dbError?.code === "PGRST116") {
        return NextResponse.json(
          { error: "Factura no encontrada" },
          { status: 404 }
        )
      }
      return NextResponse.json(
        { error: "Factura no encontrada" },
        { status: 404 }
      )
    }

    const org = factura.ordenes_servicio.organizations
    const cliente = factura.ordenes_servicio.clientes

    // Preparar datos para el PDF
    const pdfData = {
      numeroFactura: factura.numero_factura,
      fecha: new Date(factura.fecha),
      estadoPago: factura.estado_pago,
      cliente: {
        nombre: cliente?.nombre || "Consumidor Final",
        telefono: cliente?.telefono,
        email: cliente?.email,
        direccion: cliente?.direccion,
      },
      orden: {
        numeroOrden: factura.ordenes_servicio.numero_orden,
        codigoOrden: factura.ordenes_servicio.codigo_orden,
        dispositivo: factura.ordenes_servicio.dispositivo,
      },
      subtotal: parseFloat(factura.subtotal),
      iva: parseFloat(factura.iva),
      total: parseFloat(factura.total),
      montoAbonado: parseFloat(factura.monto_abonado || "0"),
      pagos: (factura.pagos_parciales || [])
        .sort((a: any, b: any) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
        .map((p: any) => ({
          monto: parseFloat(p.monto),
          metodoPago: p.metodo_pago,
          fecha: new Date(p.fecha),
          referencia: p.numero_referencia,
          cuotas: p.cuotas,
          recargoPorcentaje: p.recargo_porcentaje ? parseFloat(p.recargo_porcentaje) : null,
          montoOriginal: p.monto_original ? parseFloat(p.monto_original) : null,
        })),
      nombreEmpresa: org?.nombre_mostrar || org?.nombre,
      telefonoEmpresa: org?.telefono,
      direccionEmpresa: org?.direccion,
      logoUrl: org?.logo_url,
      moneda: org?.moneda || "ARS",
      zonaHoraria: org?.zona_horaria || "America/Argentina/Buenos_Aires",
    }

    // Generar PDF
    const pdfBuffer = await generateFacturaPDF(pdfData)

    // Retornar PDF inline (para ver en navegador)
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="factura-${factura.numero_factura}.pdf"`,
        "Cache-Control": "private, max-age=3600",
      },
    })
  } catch (error) {
    console.error("Error generating factura PDF:", error)
    return NextResponse.json(
      { error: "Error al generar PDF de factura" },
      { status: 500 }
    )
  }
}
