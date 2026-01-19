import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { generateOrdenPDFPuppeteer, OrdenPDFData } from "@/lib/pdf-puppeteer"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    if (!token || token.length !== 32) {
      return NextResponse.json(
        { error: "Token inválido" },
        { status: 400 }
      )
    }

    // Buscar orden por token público
    const { data: orden, error: dbError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select(`
        *,
        clientes (*),
        organizations (
          id,
          nombre,
          nombre_mostrar,
          telefono,
          direccion,
          logo_url
        )
      `)
      .eq("public_token", token)
      .single()

    if (dbError || !orden) {
      return NextResponse.json(
        { error: "Orden no encontrada" },
        { status: 404 }
      )
    }

    const cliente = orden.clientes as any
    const org = orden.organizations as any

    // Preparar datos para el PDF
    const pdfData: OrdenPDFData = {
      numeroOrden: orden.numero_orden,
      fechaIngreso: new Date(orden.fecha_ingreso),
      fechaPrometida: orden.fecha_prometida ? new Date(orden.fecha_prometida) : null,
      cliente: {
        nombre: cliente.nombre,
        telefono: cliente.telefono,
        email: cliente.email,
        direccion: cliente.direccion,
      },
      dispositivo: orden.dispositivo,
      tipoDispositivo: orden.tipo_dispositivo,
      marca: orden.marca,
      color: orden.color,
      imei: orden.imei,
      problemaReportado: orden.problema_reportado,
      accesorios: orden.accesorios,
      passwordDispositivo: orden.password_dispositivo,
      presupuesto: orden.presupuesto,
      observaciones: orden.observaciones,
      nombreEmpresa: org?.nombre_mostrar || org?.nombre,
      telefonoEmpresa: org?.telefono,
      direccionEmpresa: org?.direccion,
      logoUrl: org?.logo_url,
    }

    // Generar PDF con Puppeteer
    const pdfBuffer = await generateOrdenPDFPuppeteer(pdfData)

    // Retornar PDF (convertir Buffer a Uint8Array)
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="orden-${orden.numero_orden}.pdf"`,
        // Permitir caché por 1 hora
        "Cache-Control": "public, max-age=3600",
      },
    })
  } catch (error) {
    console.error("Error generating public orden PDF:", error)
    return NextResponse.json(
      { error: "Error al generar PDF" },
      { status: 500 }
    )
  }
}
