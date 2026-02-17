import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

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

    const { data: orden, error: dbError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select(`
        id,
        numero_orden,
        codigo_orden,
        dispositivo,
        tipo_dispositivo,
        marca,
        color,
        estado,
        fecha_ingreso,
        fecha_prometida,
        fecha_completado,
        fecha_entrega,
        accesorios,
        problema_reportado,
        public_token,
        clientes (
          nombre
        ),
        organizations (
          id,
          nombre,
          nombre_mostrar,
          telefono,
          direccion,
          logo_url,
          zona_horaria
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

    const org = orden.organizations as any
    const cliente = orden.clientes as any

    return NextResponse.json({
      numeroOrden: orden.numero_orden,
      codigoOrden: orden.codigo_orden,
      dispositivo: orden.dispositivo,
      tipoDispositivo: orden.tipo_dispositivo,
      marca: orden.marca,
      color: orden.color,
      estado: orden.estado,
      problemaReportado: orden.problema_reportado,
      accesorios: orden.accesorios,
      fechaIngreso: orden.fecha_ingreso,
      fechaPrometida: orden.fecha_prometida,
      fechaCompletado: orden.fecha_completado,
      fechaEntrega: orden.fecha_entrega,
      publicToken: orden.public_token,
      cliente: {
        nombre: cliente?.nombre || null,
      },
      zonaHoraria: org?.zona_horaria || "America/Argentina/Buenos_Aires",
      organizacion: {
        nombre: org?.nombre_mostrar || org?.nombre || null,
        telefono: org?.telefono || null,
        direccion: org?.direccion || null,
        logoUrl: org?.logo_url || null,
      },
    }, {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=120",
      },
    })
  } catch (error) {
    console.error("Error fetching public order:", error)
    return NextResponse.json(
      { error: "Error interno" },
      { status: 500 }
    )
  }
}
