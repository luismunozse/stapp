import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { getOrderByPublicToken } from "@/lib/public-token"
import { getDeviceTypeLabel } from "@/lib/device-types"
import { resolvePlantilla } from "@/lib/whatsapp/plantillas-catalog"
import { parseRecepcionTerminos } from "@/lib/terminos"
import { resolveTerminologia } from "@/lib/terminologia"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    const { orden, error } = await getOrderByPublicToken(token, `
        id,
        numero_orden,
        codigo_orden,
        dispositivo,
        tipo_dispositivo,
        marca,
        color,
        estado,
        motivo_sin_cobro,
        fecha_ingreso,
        fecha_prometida,
        fecha_completado,
        fecha_entrega,
        accesorios,
        problema_reportado,
        diagnostico,
        presupuesto,
        presupuesto_aprobado_portal,
        public_token,
        tipos_dispositivo:tipo_dispositivo_id (
          nombre
        ),
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
          zona_horaria,
          plantillas_whatsapp,
          recepcion_terminos,
          terminologia
        )
      `)
    if (error) return error

    const org = orden.organizations as any
    const cliente = orden.clientes as any
    const tipoDisp = orden.tipos_dispositivo as any

    // Fetch cotizaciones linked to this order (only ENVIADA or ACEPTADA)
    let cotizaciones: any[] = []
    const { data: cotizacionesData } = await supabaseAdmin
      .from("cotizaciones")
      .select(`
        id, numero_cotizacion, estado, fecha_vencimiento, notas,
        subtotal, iva, total, created_at, public_token,
        firma_aprobacion, firma_mime, fecha_aprobacion,
        motivo_rechazo, fecha_rechazo,
        descuento_global_tipo, descuento_global_valor, iva_porcentaje, terminos,
        items_cotizacion (
          id, descripcion, cantidad, precio_unitario, subtotal,
          unidad, descuento_tipo, descuento_valor
        )
      `)
      .eq("orden_id", orden.id)
      .in("estado", ["ENVIADA", "ACEPTADA", "RECHAZADA"])
      .order("created_at", { ascending: false })

    if (cotizacionesData && cotizacionesData.length > 0) {
      cotizaciones = cotizacionesData.map((c: any) => ({
        id: c.id,
        numeroCotizacion: c.numero_cotizacion,
        estado: c.estado,
        fechaVencimiento: c.fecha_vencimiento,
        notas: c.notas,
        subtotal: c.subtotal,
        iva: c.iva,
        total: c.total,
        createdAt: c.created_at,
        publicToken: c.public_token,
        firmaAprobacion: c.firma_aprobacion,
        firmaMime: c.firma_mime,
        fechaAprobacion: c.fecha_aprobacion,
        motivoRechazo: c.motivo_rechazo,
        fechaRechazo: c.fecha_rechazo,
        descuentoGlobalTipo: c.descuento_global_tipo,
        descuentoGlobalValor: c.descuento_global_valor,
        ivaPorcentaje: c.iva_porcentaje,
        terminos: c.terminos,
        items: (c.items_cotizacion || []).map((i: any) => ({
          id: i.id,
          descripcion: i.descripcion,
          cantidad: i.cantidad,
          precioUnitario: i.precio_unitario,
          subtotal: i.subtotal,
          unidad: i.unidad,
          descuentoTipo: i.descuento_tipo,
          descuentoValor: i.descuento_valor,
        })),
      }))
    }

    // Plantilla pre-rellenada para el botón de WhatsApp ("Coordinar retiro" /
    // "Consultar"). Si el taller customizó "seguimiento_consulta_cliente" en
    // /configuracion/plantillas-whatsapp, se usa esa; si no, el default.
    const codigoOrdenDisplay = orden.codigo_orden || `#${orden.numero_orden}`
    const whatsappMensajeConsulta = resolvePlantilla(
      "seguimiento_consulta_cliente",
      {
        cliente: cliente?.nombre || "",
        codigo_orden: codigoOrdenDisplay,
        dispositivo: orden.dispositivo || "",
      },
      (org?.plantillas_whatsapp as Record<string, string>) || null,
    )

    return NextResponse.json({
      id: orden.id,
      numeroOrden: orden.numero_orden,
      codigoOrden: orden.codigo_orden,
      dispositivo: orden.dispositivo,
      tipoDispositivo: orden.tipo_dispositivo,
      tipoDispositivoNombre: getDeviceTypeLabel(orden.tipo_dispositivo, tipoDisp?.nombre),
      marca: orden.marca,
      color: orden.color,
      estado: orden.estado,
      motivoSinCobro: orden.motivo_sin_cobro || null,
      problemaReportado: orden.problema_reportado,
      diagnostico: orden.diagnostico || null,
      accesorios: orden.accesorios,
      fechaIngreso: orden.fecha_ingreso,
      fechaPrometida: orden.fecha_prometida,
      fechaCompletado: orden.fecha_completado,
      fechaEntrega: orden.fecha_entrega,
      presupuesto: orden.presupuesto || null,
      presupuestoAprobadoPortal: orden.presupuesto_aprobado_portal || false,
      publicToken: orden.public_token,
      cotizaciones,
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
      whatsappMensajeConsulta,
      recepcionTerminos: parseRecepcionTerminos(org?.recepcion_terminos),
      terminologia: resolveTerminologia(org?.terminologia ?? null),
    })
  } catch (error) {
    console.error("Error fetching public order:", error)
    return NextResponse.json(
      { error: "Error interno" },
      { status: 500 }
    )
  }
}
