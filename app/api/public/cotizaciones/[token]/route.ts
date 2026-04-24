import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
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

    // `not("public_token", "is", null)` blinda contra registros legacy
    // con token null. La query principal usa `eq("public_token", token)`
    // más abajo; ambos filtros son complementarios.
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
        descuento_global_tipo,
        descuento_global_valor,
        iva_porcentaje,
        terminos,
        motivo_rechazo,
        organization_id,
        visto_at,
        visto_count,
        tipo,
        equipo_snapshot,
        checklist_snapshot,
        ordenes_servicio!cotizaciones_orden_id_fkey (
          id,
          numero_orden,
          dispositivo,
          tipo_dispositivo,
          marca,
          problema_reportado,
          clientes (nombre, telefono, email),
          organizations (
            id, nombre, nombre_mostrar, telefono, direccion, logo_url, moneda, zona_horaria
          )
        ),
        clientes (nombre, telefono, email),
        sectores_cliente (id, nombre),
        items_cotizacion (
          id, descripcion, cantidad, precio_unitario, subtotal,
          unidad, descuento_tipo, descuento_valor
        )
      `)
      .eq("public_token", token)
      .not("public_token", "is", null)
      .is("deleted_at", null)
      .single()

    if (dbError || !cotizacion) {
      return NextResponse.json(
        { error: "Cotizacion no encontrada" },
        { status: 404 }
      )
    }

    // Fire-and-forget: track read confirmation con RPC atómico
    // para evitar race conditions cuando el link se abre concurrentemente.
    if (cotizacion.estado === "ENVIADA") {
      void supabaseAdmin.rpc("increment_cotizacion_visto", {
        p_id: cotizacion.id,
      })
    }

    const orden = cotizacion.ordenes_servicio as any
    const cliente = orden?.clientes || cotizacion.clientes as any

    // Get org: from order if available, otherwise fetch directly
    let org = orden?.organizations
    if (!org && cotizacion.organization_id) {
      const { data: orgData } = await supabaseAdmin
        .from("organizations")
        .select("id, nombre, nombre_mostrar, telefono, direccion, logo_url, moneda, zona_horaria")
        .eq("id", cotizacion.organization_id)
        .single()
      org = orgData
    }

    // Hidratar equipo + checklist (con labels) usando el mismo helper que el PDF
    const pdfExtras = await buildCotizacionPdfExtras(cotizacion)

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
      descuentoGlobalTipo: cotizacion.descuento_global_tipo,
      descuentoGlobalValor: cotizacion.descuento_global_valor,
      ivaPorcentaje: cotizacion.iva_porcentaje,
      terminos: cotizacion.terminos,
      motivoRechazo: cotizacion.motivo_rechazo || null,
      tipo: pdfExtras.tipo,
      equipo: pdfExtras.equipo,
      checklist: pdfExtras.checklist,
      orden: orden ? {
        numeroOrden: orden.numero_orden,
        dispositivo: orden.dispositivo,
        tipoDispositivo: orden.tipo_dispositivo,
        marca: orden.marca,
        problemaReportado: orden.problema_reportado,
      } : null,
      cliente: {
        nombre: cliente?.nombre || null,
        telefono: cliente?.telefono || null,
        email: cliente?.email || null,
      },
      sector: (cotizacion as any).sectores_cliente ? {
        nombre: (cotizacion as any).sectores_cliente.nombre,
      } : null,
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
        unidad: i.unidad,
        descuentoTipo: i.descuento_tipo,
        descuentoValor: i.descuento_valor,
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
