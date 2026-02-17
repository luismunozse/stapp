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

    const { data: cotizacion, error: dbError } = await supabaseAdmin
      .from("cotizaciones")
      .select(`
        id,
        numero_cotizacion,
        estado,
        fecha_vencimiento,
        notas,
        subtotal,
        iva,
        total,
        created_at,
        public_token,
        firma_aprobacion,
        firma_mime,
        fecha_aprobacion,
        ordenes_servicio!inner (
          id,
          numero_orden,
          dispositivo,
          tipo_dispositivo,
          marca,
          problema_reportado,
          clientes (nombre, telefono, email),
          organizations (
            id,
            nombre,
            nombre_mostrar,
            telefono,
            direccion,
            logo_url,
            moneda,
            zona_horaria
          )
        ),
        items_cotizacion (
          id,
          descripcion,
          cantidad,
          precio_unitario,
          subtotal
        )
      `)
      .eq("public_token", token)
      .single()

    if (dbError || !cotizacion) {
      return NextResponse.json(
        { error: "Cotizacion no encontrada" },
        { status: 404 }
      )
    }

    const orden = cotizacion.ordenes_servicio as any
    const org = orden.organizations
    const cliente = orden.clientes

    return NextResponse.json({
      id: cotizacion.id,
      numeroCotizacion: cotizacion.numero_cotizacion,
      estado: cotizacion.estado,
      fechaVencimiento: cotizacion.fecha_vencimiento,
      notas: cotizacion.notas,
      subtotal: cotizacion.subtotal,
      iva: cotizacion.iva,
      total: cotizacion.total,
      createdAt: cotizacion.created_at,
      publicToken: cotizacion.public_token,
      firmaAprobacion: cotizacion.firma_aprobacion,
      firmaMime: cotizacion.firma_mime,
      fechaAprobacion: cotizacion.fecha_aprobacion,
      orden: {
        numeroOrden: orden.numero_orden,
        dispositivo: orden.dispositivo,
        tipoDispositivo: orden.tipo_dispositivo,
        marca: orden.marca,
        problemaReportado: orden.problema_reportado,
      },
      cliente: {
        nombre: cliente?.nombre || null,
        telefono: cliente?.telefono || null,
        email: cliente?.email || null,
      },
      moneda: org?.moneda || "ARS",
      zonaHoraria: org?.zona_horaria || "America/Argentina/Buenos_Aires",
      organizacion: {
        nombre: org?.nombre_mostrar || org?.nombre || null,
        telefono: org?.telefono || null,
        direccion: org?.direccion || null,
        logoUrl: org?.logo_url || null,
      },
      items: cotizacion.items_cotizacion?.map((i: any) => ({
        id: i.id,
        descripcion: i.descripcion,
        cantidad: i.cantidad,
        precioUnitario: i.precio_unitario,
        subtotal: i.subtotal,
      })),
    }, {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=120",
      },
    })
  } catch (error) {
    console.error("Error fetching public cotizacion:", error)
    return NextResponse.json(
      { error: "Error interno" },
      { status: 500 }
    )
  }
}
