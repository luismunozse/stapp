import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { generateCotizacionPDF } from "@/lib/pdf"
import { buildCotizacionPdfExtras } from "@/lib/cotizacion-pdf"
import { sendCotizacionEmail } from "@/lib/email"
import { hasPlanFeature } from "@/lib/subscriptions"
import { totalPresupuestoDeOrden } from "@/lib/cotizacion-presupuesto"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    const hasCotizaciones = await hasPlanFeature(organizationId!, "cotizaciones_online")
    if (!hasCotizaciones) {
      return NextResponse.json(
        { error: "Las cotizaciones requieren el plan Profesional", code: "FEATURE_REQUIRED", feature: "cotizaciones_online" },
        { status: 403 }
      )
    }

    const { id } = await params

    // Obtener cotización con LEFT join (standalone support)
    const { data: cotizacion, error: fetchError } = await supabaseAdmin
      .from("cotizaciones")
      .select(`
        *,
        ordenes_servicio!cotizaciones_orden_id_fkey (
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
      .is("deleted_at", null)
      .single()

    if (fetchError || !cotizacion) {
      return NextResponse.json({ error: "Cotización no encontrada" }, { status: 404 })
    }

    // TECNICO sólo puede enviar cotizaciones creadas por él mismo
    if (role === "TECNICO" && cotizacion.created_by !== userId) {
      return NextResponse.json({ error: "No autorizado para enviar esta cotización" }, { status: 403 })
    }

    const orden = cotizacion.ordenes_servicio
    const cliente = orden?.clientes || cotizacion.clientes

    // Verificar que el cliente tenga email
    if (!cliente?.email) {
      return NextResponse.json({ error: "El cliente no tiene email registrado" }, { status: 400 })
    }

    // Get org info
    let org = orden?.organizations
    if (!org) {
      const { data: orgData } = await supabaseAdmin
        .from("organizations")
        .select("id, nombre_mostrar, telefono, direccion, logo_url, moneda, zona_horaria")
        .eq("id", organizationId!)
        .single()
      org = orgData
    }

    // Generar PDF
    const pdfExtras = await buildCotizacionPdfExtras(cotizacion)

    const pdfBuffer = await generateCotizacionPDF({
      ...pdfExtras,
      numeroCotizacion: cotizacion.numero_cotizacion,
      fecha: cotizacion.created_at,
      fechaVencimiento: cotizacion.fecha_vencimiento,
      cliente: {
        nombre: cliente.nombre,
        telefono: cliente.telefono,
        email: cliente.email,
        direccion: cliente.direccion,
      },
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

    // Enviar email
    await sendCotizacionEmail({
      email: cliente.email,
      nombreCliente: cliente.nombre,
      numeroCotizacion: cotizacion.numero_cotizacion,
      numeroOrden: orden?.numero_orden,
      total: cotizacion.total,
      fechaVencimiento: cotizacion.fecha_vencimiento,
      pdfBuffer,
      moneda: org?.moneda || "ARS",
      zonaHoraria: org?.zona_horaria || "America/Argentina/Buenos_Aires",
    })

    // Actualizar estado a ENVIADA
    await supabaseAdmin.from("cotizaciones").update({ estado: "ENVIADA" }).eq("id", id)

    // Si la cotización está vinculada a una orden, transicionar a PRESUPUESTADO automáticamente
    if (orden && orden.id) {
      const validStates = ["RECIBIDO", "EN_DIAGNOSTICO"]
      const { data: ordenActual } = await supabaseAdmin
        .from("ordenes_servicio")
        .select("id, estado")
        .eq("id", orden.id)
        .single()

      if (ordenActual && validStates.includes(ordenActual.estado)) {
        const estadoAnterior = ordenActual.estado
        const { total: totalPresupuesto } = await totalPresupuestoDeOrden(orden.id)
        await supabaseAdmin
          .from("ordenes_servicio")
          .update({
            estado: "PRESUPUESTADO",
            presupuesto: totalPresupuesto,
            costo_final: totalPresupuesto,
          })
          .eq("id", orden.id)

        // Registrar evento
        await supabaseAdmin.from("orden_eventos").insert({
          orden_id: orden.id,
          organization_id: organizationId,
          tipo: "CAMBIO_ESTADO",
          estado_anterior: estadoAnterior,
          estado_nuevo: "PRESUPUESTADO",
          descripcion: `Cotización ${cotizacion.numero_cotizacion} enviada al cliente`,
          metadata: { cotizacionId: id },
        })
      }
    }

    return NextResponse.json({
      message: "Cotización enviada exitosamente",
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("Error sending cotizacion:", message)
    return NextResponse.json({ error: `Error al enviar la cotización: ${message}` }, { status: 500 })
  }
}
