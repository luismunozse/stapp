import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { createAuditLogger, diffObjects } from "@/lib/audit"
import { queueNotification } from "@/lib/notifications/queue"
import { addDaysInTimeZone, DEFAULT_TIMEZONE } from "@/lib/timezone"
import { z } from "zod"

const entregarSchema = z.object({
  firmaClienteEntrega: z.string().optional().nullable(),
  firmaClienteMime: z.string().optional().nullable(),
  firmaEncargadoEntrega: z.string().optional().nullable(),
  firmaEncargadoMime: z.string().optional().nullable(),
  notasEntrega: z.string().optional().nullable(),
  diasGarantia: z.number().int().positive().optional(),
  notasGarantia: z.string().optional().nullable(),
  sinCobro: z.boolean().optional(),
  motivoSinCobro: z
    .enum(["NO_REPARABLE", "CORTESIA", "GARANTIA", "CLIENTE_DESISTIO", "OTRO"])
    .optional()
    .nullable(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const data = entregarSchema.parse(body)

    // Obtener orden actual con cliente
    const { data: orden, error: fetchError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select(`*, clientes(*)`)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !orden) {
      return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
    }

    // Técnicos solo pueden entregar sus órdenes asignadas
    if (role === "TECNICO" && orden.tecnico_id !== userId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }

    // Verificar que no esté ya entregada
    if (["ENTREGADO", "ENTREGADO_SIN_REPARACION", "ENTREGADO_SIN_COBRO"].includes(orden.estado)) {
      return NextResponse.json({ error: "La orden ya fue entregada" }, { status: 400 })
    }

    const sinCobro = data.sinCobro === true
    const estadosPermitidos = sinCobro
      ? ["REPARADO", "SIN_REPARACION", "EN_DIAGNOSTICO", "RECIBIDO", "EN_REPARACION", "ESPERANDO_REPUESTO"]
      : ["REPARADO", "SIN_REPARACION"]

    if (!estadosPermitidos.includes(orden.estado)) {
      return NextResponse.json(
        { error: `No se puede entregar una orden en estado "${orden.estado}". Debe estar en estado "REPARADO" o "SIN_REPARACION".` },
        { status: 400 }
      )
    }

    const esRetiro = orden.estado === "SIN_REPARACION" && !sinCobro
    const nuevoEstado = sinCobro ? "ENTREGADO_SIN_COBRO" : esRetiro ? "ENTREGADO_SIN_REPARACION" : "ENTREGADO"

    // Motivo sin cobro: si vino explícito lo usamos, sino derivamos del estado origen.
    // Para entregas con cobro normal, dejamos NULL.
    let motivoSinCobro: string | null = null
    if (sinCobro) {
      if (data.motivoSinCobro) {
        motivoSinCobro = data.motivoSinCobro
      } else {
        // Sugerencia automática (mirror de defaultMotivoSinCobro)
        const e = orden.estado
        if (e === "SIN_REPARACION") motivoSinCobro = "NO_REPARABLE"
        else if (e === "REPARADO") motivoSinCobro = "CORTESIA"
        else if (e === "PRESUPUESTADO" || e === "APROBADO" || e === "EN_REPARACION" || e === "ESPERANDO_REPUESTO") {
          motivoSinCobro = "CLIENTE_DESISTIO"
        } else {
          motivoSinCobro = "OTRO"
        }
      }
    }

    // Actualizar orden con datos de entrega
    const { data: updatedOrden, error: updateError } = await supabaseAdmin
      .from("ordenes_servicio")
      .update({
        estado: nuevoEstado,
        fecha_entrega: new Date().toISOString(),
        firma_cliente_entrega: data.firmaClienteEntrega || null,
        firma_cliente_entrega_mime: data.firmaClienteMime || null,
        firma_encargado_entrega: data.firmaEncargadoEntrega || null,
        firma_encargado_entrega_mime: data.firmaEncargadoMime || null,
        entregado_por_user_id: userId,
        notas_entrega: data.notasEntrega,
        motivo_sin_cobro: motivoSinCobro,
      })
      .eq("id", id)
      .select(`*, clientes(*), users:entregado_por_user_id(id, nombre, email)`)
      .single()

    if (updateError) throw updateError

    // Fiado: si se entrega con saldo pendiente (y no es entrega sin cobro),
    // debitar la cuenta corriente del cliente.
    if (!sinCobro && orden.cliente_id) {
      const costoFinal = parseFloat(updatedOrden.costo_final || "0")
      const descuento = parseFloat(updatedOrden.descuento_cobro || "0")
      const cobrado = parseFloat(updatedOrden.total_cobrado || "0")
      const pendiente = Math.round((costoFinal - descuento - cobrado) * 100) / 100
      if (pendiente > 0) {
        const { error: fiadoError } = await supabaseAdmin.rpc("cargar_deuda_cuenta_corriente", {
          p_org_id: organizationId!,
          p_cliente_id: orden.cliente_id,
          p_monto: pendiente,
          p_referencia_tipo: "ORDEN",
          p_referencia_id: id,
          p_usuario_id: userId!,
        })
        if (fiadoError) {
          // No abortar la entrega por un error de CC; registrar y seguir
          // (mismo criterio que consumir_reservas más abajo).
          console.error("Error cargando fiado a cuenta corriente:", fiadoError)
        }
      }
    }

    // Obtener datos de organización (zona horaria necesaria para calcular el
    // vencimiento de garantía como día calendario en la tz del taller)
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("nombre, nombre_mostrar, slug, moneda, zona_horaria")
      .eq("id", organizationId!)
      .single()

    const zonaHoraria = org?.zona_horaria || DEFAULT_TIMEZONE

    // Create warranty if requested (only for normal deliveries, not returns or sin cobro)
    if (data.diasGarantia && !esRetiro && !sinCobro) {
      await supabaseAdmin
        .from("garantias")
        .insert({
          orden_id: id,
          dias_validez: data.diasGarantia,
          fecha_inicio: new Date().toISOString(),
          fecha_vencimiento: addDaysInTimeZone(data.diasGarantia, zonaHoraria),
          notas: data.notasGarantia || null,
        })
    }

    // Consume reserved stock: deduct from physical stock + release reservation
    try {
      await supabaseAdmin.rpc("consumir_reservas_orden", {
        p_orden_id: id,
        p_user_id: userId,
      })
    } catch (consumeErr) {
      console.error("Error consuming order reservations on delivery:", consumeErr)
    }

    // Registrar auditoría
    const audit = createAuditLogger(organizationId!, userId!, request)
    const changes = diffObjects(orden, updatedOrden)
    await audit.update("ordenes_servicio", id, changes.before, changes.after)

    // Encolar notificación de entrega
    const cliente = orden.clientes as any
    if (cliente) {
      queueNotification({
        organizationId: organizationId!,
        ordenId: id,
        clienteId: cliente.id,
        tipo: "CAMBIO_ESTADO",
        context: {
          organizationName: org?.nombre_mostrar || org?.nombre || "",
          organizationSlug: org?.slug,
          moneda: org?.moneda || "ARS",
          zonaHoraria: org?.zona_horaria || "America/Argentina/Buenos_Aires",
          cliente: {
            id: cliente.id,
            nombre: cliente.nombre,
            email: cliente.email,
            telefono: cliente.telefono,
          },
          orden: {
            id: id,
            numeroOrden: orden.numero_orden,
            dispositivo: orden.dispositivo,
            estado: nuevoEstado,
            estadoAnterior: orden.estado,
            publicToken: orden.public_token,
          },
        },
      }).catch(err => console.error("Error queueing notification:", err))
    }

    return NextResponse.json({
      id: updatedOrden.id,
      numeroOrden: updatedOrden.numero_orden,
      codigoOrden: updatedOrden.codigo_orden,
      estado: updatedOrden.estado,
      fechaEntrega: updatedOrden.fecha_entrega,
      notasEntrega: updatedOrden.notas_entrega,
      entregadoPor: updatedOrden.users,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    console.error("Error registering delivery:", error)
    return NextResponse.json({ error: "Error al registrar entrega" }, { status: 500 })
  }
}
