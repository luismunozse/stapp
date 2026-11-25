import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { getOrderByPublicToken } from "@/lib/public-token"
import { getDeviceTypeLabel } from "@/lib/device-types"
import { resolvePlantilla } from "@/lib/whatsapp/plantillas-catalog"
import { parseRecepcionTerminos } from "@/lib/terminos"
import { resolveTerminologia } from "@/lib/terminologia"
import { aplicadoNotasCreditoDeOrden, pendienteOrden } from "@/lib/ordenes/pendiente"
import { puedeInformarPago, redondearMonto } from "@/lib/ordenes/pagos-informados"
import { reportarError } from "@/lib/api-error"

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
        costo_final,
        descuento_cobro,
        total_cobrado,
        notas_credito (monto_aplicado_deuda, anulada),
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
          terminologia,
          moneda,
          cbu_alias,
          medios_pago_texto
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

    // Pago desde el seguimiento: saldo, alias del taller y el último aviso del
    // cliente. Si la tabla de avisos no responde (p. ej. la migración 419 aún
    // no se aplicó) no se ofrece pagar: mejor no mostrar la opción que dejar
    // al cliente con un formulario que falla.
    const costoFinal = Number(orden.costo_final) || 0
    const descuentoCobro = Number(orden.descuento_cobro) || 0
    const totalCobrado = Number(orden.total_cobrado) || 0
    const saldo = redondearMonto(
      Math.max(
        0,
        pendienteOrden({
          costoFinal,
          descuentoCobro,
          totalCobrado,
          aplicadoNotasCredito: aplicadoNotasCreditoDeOrden(orden as any),
        }),
      ),
    )
    let pago: Record<string, unknown> | null = null
    if (puedeInformarPago(orden.estado, saldo)) {
      const { data: avisos, error: avisosError } = await supabaseAdmin
        .from("pagos_informados")
        .select("monto, metodo, estado, motivo_rechazo, created_at, resuelto_at")
        .eq("orden_id", orden.id)
        .order("created_at", { ascending: false })
        .limit(1)
      if (!avisosError) {
        const ultimo = (avisos ?? [])[0] as any
        pago = {
          total: redondearMonto(costoFinal - descuentoCobro),
          pagado: redondearMonto(costoFinal - descuentoCobro - saldo),
          saldo,
          moneda: org?.moneda || "ARS",
          alias: (org?.cbu_alias as string | null)?.trim() || null,
          mediosPagoTexto: (org?.medios_pago_texto as string | null)?.trim() || null,
          avisoPendiente:
            ultimo?.estado === "PENDIENTE"
              ? { monto: Number(ultimo.monto), metodo: ultimo.metodo, fecha: ultimo.created_at }
              : null,
          ultimoRechazo:
            ultimo?.estado === "RECHAZADO"
              ? { monto: Number(ultimo.monto), motivo: ultimo.motivo_rechazo || null, fecha: ultimo.resuelto_at }
              : null,
        }
      }
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
      pago,
      recepcionTerminos: parseRecepcionTerminos(org?.recepcion_terminos),
      terminologia: resolveTerminologia(org?.terminologia ?? null),
    })
  } catch (error) {
    console.error("Error fetching public order:", error)
    reportarError(error, { ruta: "/api/public/ordenes/[token]" })
    return NextResponse.json(
      { error: "Error interno" },
      { status: 500 }
    )
  }
}
