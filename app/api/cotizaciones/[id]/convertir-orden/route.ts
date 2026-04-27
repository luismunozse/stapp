import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { getNextOrderNumberByType } from "@/lib/counters"
import { createAuditLogger } from "@/lib/audit"
import { randomBytes } from "crypto"

/**
 * Convierte una cotización tipo PRESUPUESTO en una orden de servicio real.
 *
 * Flujo:
 *  1. Valida que sea PRESUPUESTO, no esté ya convertida, y tenga equipo_snapshot.
 *  2. Crea una orden de servicio usando los datos del snapshot (dispositivo, marca,
 *     problema reportado, etc.) y el presupuesto de la cotización como costo.
 *  3. Si hay checklist_snapshot, crea también el registro checklist_recepcion.
 *  4. Vincula la cotización a la orden (convertida_a_orden_id + orden_id) y cambia
 *     su tipo a ORDEN para que quede en el flujo normal.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden convertir presupuestos en órdenes" },
        { status: 403 }
      )
    }

    const { id } = await params

    const { data: cotizacion, error: fetchError } = await supabaseAdmin
      .from("cotizaciones")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .single()

    if (fetchError || !cotizacion) {
      return NextResponse.json(
        { error: "Cotización no encontrada" },
        { status: 404 }
      )
    }

    if (cotizacion.tipo !== "PRESUPUESTO") {
      return NextResponse.json(
        { error: "Solo se pueden convertir cotizaciones tipo PRESUPUESTO" },
        { status: 400 }
      )
    }

    if (cotizacion.convertida_a_orden_id) {
      return NextResponse.json(
        { error: "Este presupuesto ya fue convertido en orden" },
        { status: 400 }
      )
    }

    const equipo = cotizacion.equipo_snapshot as Record<string, any> | null
    if (!equipo || !equipo.dispositivo || !equipo.problemaReportado) {
      return NextResponse.json(
        { error: "El presupuesto no tiene datos de equipo suficientes" },
        { status: 400 }
      )
    }

    if (!cotizacion.cliente_id) {
      return NextResponse.json(
        { error: "El presupuesto no tiene cliente asociado" },
        { status: 400 }
      )
    }

    // Resolver tipo_dispositivo: puede venir como codigo directo o por id.
    let tipoDispositivoCodigo: string | null = equipo.tipoDispositivo || null
    if (!tipoDispositivoCodigo && equipo.tipoDispositivoId) {
      const { data: td } = await supabaseAdmin
        .from("tipos_dispositivo")
        .select("codigo")
        .eq("id", equipo.tipoDispositivoId)
        .eq("organization_id", organizationId!)
        .single()
      tipoDispositivoCodigo = td?.codigo || null
    }

    if (!tipoDispositivoCodigo) {
      return NextResponse.json(
        { error: "El presupuesto no tiene tipo de dispositivo definido" },
        { status: 400 }
      )
    }

    // Siguiente número/código con prefijo por tipo
    const { codigo: codigoOrden, numero: numeroOrden } = await getNextOrderNumberByType(
      organizationId!,
      tipoDispositivoCodigo
    )

    const publicToken = randomBytes(16).toString("hex")

    // Condiciones técnicas del presupuesto (si existen)
    const condiciones = (equipo.condiciones || {}) as Record<string, any>
    const diagnostico: string | null = condiciones.diagnostico || null
    const plazoEstimadoDias: number | null = typeof condiciones.plazoEstimadoDias === "number" && condiciones.plazoEstimadoDias > 0 ? condiciones.plazoEstimadoDias : null
    const garantiaDias: number = typeof condiciones.garantiaDias === "number" ? condiciones.garantiaDias : 0
    const garantiaAlcance: string = condiciones.garantiaAlcance || "NINGUNA"
    const politicaAbandonoDias: number | null = typeof condiciones.politicaAbandonoDias === "number" && condiciones.politicaAbandonoDias > 0 ? condiciones.politicaAbandonoDias : null
    const anticipoTipo: string = condiciones.anticipoTipo || "porcentaje"
    const anticipoValor: number = typeof condiciones.anticipoValor === "number" ? condiciones.anticipoValor : 0

    // Calcular fecha prometida desde plazo
    let fechaPrometida: string | null = null
    if (plazoEstimadoDias) {
      const d = new Date()
      d.setDate(d.getDate() + plazoEstimadoDias)
      fechaPrometida = d.toISOString()
    }

    // Calcular seña en moneda local desde anticipo
    const totalCotizacion = Number(cotizacion.total) || 0
    let sena = 0
    if (anticipoValor > 0 && totalCotizacion > 0) {
      sena = anticipoTipo === "fijo"
        ? Math.min(anticipoValor, totalCotizacion)
        : Math.round(totalCotizacion * (anticipoValor / 100) * 100) / 100
    }

    // Componer observaciones
    const obsLines: string[] = [`Generada desde presupuesto ${cotizacion.numero_cotizacion}`]
    if (politicaAbandonoDias) {
      obsLines.push(`Plazo de retiro: ${politicaAbandonoDias} días tras aviso de listo.`)
    }

    // Crear la orden con los datos del snapshot
    const { data: orden, error: ordenError } = await supabaseAdmin
      .from("ordenes_servicio")
      .insert({
        numero_orden: numeroOrden,
        codigo_orden: codigoOrden,
        cliente_id: cotizacion.cliente_id,
        organization_id: organizationId!,
        dispositivo: equipo.dispositivo,
        tipo_dispositivo: tipoDispositivoCodigo,
        marca: equipo.marca || null,
        color: equipo.color || null,
        imei: equipo.imei || null,
        problema_reportado: equipo.problemaReportado,
        diagnostico: diagnostico,
        presupuesto: cotizacion.total || null,
        sena: sena || 0,
        fecha_prometida: fechaPrometida,
        observaciones: obsLines.join("\n"),
        public_token: publicToken,
        estado: "RECIBIDO",
        sector_id: cotizacion.sector_id || null,
        metadata: equipo.modelo || equipo.numeroSerie
          ? { modelo: equipo.modelo, numeroSerie: equipo.numeroSerie }
          : {},
      })
      .select()
      .single()

    if (ordenError) {
      throw ordenError
    }

    // Crear garantía si corresponde
    if (garantiaAlcance !== "NINGUNA" && garantiaDias > 0) {
      const inicio = new Date()
      const vencimiento = new Date()
      vencimiento.setDate(vencimiento.getDate() + garantiaDias)
      const alcanceLabel = garantiaAlcance === "AMBOS"
        ? "Repuesto y mano de obra"
        : garantiaAlcance === "REPUESTO"
          ? "Solo repuesto"
          : "Solo mano de obra"
      await supabaseAdmin.from("garantias").insert({
        orden_id: orden.id,
        dias_validez: garantiaDias,
        fecha_inicio: inicio.toISOString(),
        fecha_vencimiento: vencimiento.toISOString(),
        notas: `Alcance: ${alcanceLabel}. Garantía generada desde presupuesto ${cotizacion.numero_cotizacion}.`,
      })
    }

    // Si hay checklist_snapshot, copiarlo a checklist_recepcion
    const checklist = cotizacion.checklist_snapshot as Record<string, any> | null
    if (checklist && checklist.templateId && checklist.valores) {
      // Verificar que el template todavía exista y pertenezca a la org
      const { data: template } = await supabaseAdmin
        .from("checklist_templates")
        .select("id")
        .eq("id", checklist.templateId)
        .eq("organization_id", organizationId!)
        .single()

      if (template) {
        await supabaseAdmin.from("checklist_recepcion").insert({
          orden_id: orden.id,
          template_id: checklist.templateId,
          valores: JSON.stringify(checklist.valores),
          notas: checklist.notas || null,
        })
      }
    }

    // Vincular la cotización a la nueva orden y cambiar su tipo a ORDEN
    // para que quede integrada en el flujo normal (firma, reservas, etc.).
    await supabaseAdmin
      .from("cotizaciones")
      .update({
        tipo: "ORDEN",
        orden_id: orden.id,
        convertida_a_orden_id: orden.id,
      })
      .eq("id", id)

    // Evento en la orden
    await supabaseAdmin.from("orden_eventos").insert({
      orden_id: orden.id,
      organization_id: organizationId,
      tipo: "CAMBIO_ESTADO",
      estado_nuevo: "RECIBIDO",
      descripcion: `Orden generada a partir del presupuesto ${cotizacion.numero_cotizacion}`,
      metadata: { cotizacionId: id, numeroCotizacion: cotizacion.numero_cotizacion },
    })

    // Audit log
    const audit = createAuditLogger(organizationId!, userId!, request)
    audit.create("ordenes_servicio", orden.id, {
      codigo_orden: codigoOrden,
      generada_desde_presupuesto: cotizacion.numero_cotizacion,
    })

    return NextResponse.json(
      {
        ordenId: orden.id,
        codigoOrden,
        numeroOrden,
      },
      { status: 201 }
    )
  } catch (err) {
    console.error("Error converting presupuesto to orden:", err)
    return NextResponse.json(
      { error: "Error al convertir presupuesto a orden" },
      { status: 500 }
    )
  }
}
