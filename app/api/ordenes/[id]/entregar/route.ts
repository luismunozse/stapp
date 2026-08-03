import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { createAuditLogger, diffObjects } from "@/lib/audit"
import { queueNotification } from "@/lib/notifications/queue"
import { addDaysInTimeZone, DEFAULT_TIMEZONE } from "@/lib/timezone"
import { MOTIVO_SIN_COBRO_LABELS, type MotivoSinCobro } from "@/lib/seguimiento-state"
import { resolverEstadoEntrega, esTransicionValida, ESTADO_LABELS } from "@/lib/orden-state-machine"
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
  // Confirmación del total en el momento de entregar. El operador ve el
  // resumen de repuestos e indica cuánto cobra y si ese número ya los incluye:
  // sin ese dato no se puede saber si sumarlos duplicaría el cobro, porque
  // hasta ahora el total se tipeaba a mano incluyéndolos.
  totalACobrar: z.number().min(0).optional(),
  incluyeRepuestos: z.boolean().optional(),
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
    const nuevoEstado = resolverEstadoEntrega(orden.estado, sinCobro)
    const esRetiro = nuevoEstado === "ENTREGADO_SIN_REPARACION"

    // La máquina de estados es la única autoridad sobre qué orígenes pueden
    // entregar: mismo criterio que usa el PUT genérico y el dropdown de la UI.
    // Antes este endpoint tenía su propia whitelist hardcodeada, que divergía
    // (permitía entregar sin cobro desde EN_REPARACION/ESPERANDO_REPUESTO, cosa
    // que ni la máquina de estados ni la UI habilitan).
    if (!esTransicionValida(orden.estado, nuevoEstado)) {
      return NextResponse.json(
        { error: `No se puede entregar una orden en estado "${ESTADO_LABELS[orden.estado as keyof typeof ESTADO_LABELS] ?? orden.estado}".` },
        { status: 400 }
      )
    }

    // Motivo sin cobro: si vino explícito lo usamos, sino derivamos del estado origen.
    // Para entregas con cobro normal, dejamos NULL.
    let motivoSinCobro: string | null = null
    if (sinCobro) {
      if (data.motivoSinCobro) {
        motivoSinCobro = data.motivoSinCobro
      } else {
        // Sugerencia automática (mirror de defaultMotivoSinCobro). Solo llegan
        // acá los estados que la máquina de estados habilita para entrega sin
        // cobro: RECIBIDO, EN_DIAGNOSTICO, REPARADO, SIN_REPARACION,
        // SIN_FALLA_DETECTADA. El resto queda bloqueado por esTransicionValida.
        const e = orden.estado
        if (e === "SIN_REPARACION") motivoSinCobro = "NO_REPARABLE"
        else if (e === "REPARADO") motivoSinCobro = "CORTESIA"
        else motivoSinCobro = "OTRO"
      }
    }

    // Total confirmado en la entrega. Si el operador dijo que su número NO
    // incluye los repuestos, se los sumamos a precio de VENTA (no al costo que
    // guarda precio_unitario). Se resuelve acá, antes del UPDATE, para que el
    // cargo a cuenta corriente de más abajo use el costo_final definitivo.
    let costoFinalConfirmado: number | null = null
    if (!sinCobro && data.totalACobrar !== undefined) {
      if (data.incluyeRepuestos) {
        costoFinalConfirmado = data.totalACobrar
      } else {
        const { data: repuestos } = await supabaseAdmin
          .from("repuestos_orden")
          .select("cantidad, precio_unitario, precio_venta_unitario")
          .eq("orden_id", id)

        const totalRepuestos = (repuestos || []).reduce((sum, r: any) => {
          // Fallback al costo en filas anteriores a la migración 286, que no
          // tienen precio de venta registrado.
          const precio =
            r.precio_venta_unitario !== null && r.precio_venta_unitario !== undefined
              ? parseFloat(r.precio_venta_unitario)
              : parseFloat(r.precio_unitario || "0")
          return sum + (r.cantidad || 0) * (precio || 0)
        }, 0)

        costoFinalConfirmado = data.totalACobrar + totalRepuestos
      }
      costoFinalConfirmado = Math.round(costoFinalConfirmado * 100) / 100
    }

    const { data: updatedOrden, error: updateError } = await supabaseAdmin
      .from("ordenes_servicio")
      .update({
        estado: nuevoEstado,
        fecha_entrega: new Date().toISOString(),
        ...(costoFinalConfirmado !== null ? { costo_final: costoFinalConfirmado } : {}),
        firma_cliente_entrega: data.firmaClienteEntrega || null,
        firma_cliente_entrega_mime: data.firmaClienteMime || null,
        firma_encargado_entrega: data.firmaEncargadoEntrega || null,
        firma_encargado_entrega_mime: data.firmaEncargadoMime || null,
        entregado_por_user_id: userId,
        notas_entrega: data.notasEntrega,
        motivo_sin_cobro: motivoSinCobro,
      })
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .select(`*, clientes(*), users:entregado_por_user_id(id, nombre, email)`)
      .single()

    if (updateError) throw updateError

    // Registrar evento en orden_eventos para timeline público (fire-and-forget;
    // un fallo acá no debe abortar la entrega, mismo criterio que el PUT genérico
    // de ordenes usa para esta misma tabla).
    void (async () => {
      try {
        const descripcionBase = `Estado cambiado de ${orden.estado} a ${nuevoEstado}`
        const descripcion = motivoSinCobro
          ? `${descripcionBase} · Motivo: ${MOTIVO_SIN_COBRO_LABELS[motivoSinCobro as MotivoSinCobro] || motivoSinCobro}`
          : descripcionBase
        await supabaseAdmin.from("orden_eventos").insert({
          orden_id: id,
          organization_id: organizationId!,
          tipo: "CAMBIO_ESTADO",
          estado_anterior: orden.estado,
          estado_nuevo: nuevoEstado,
          descripcion,
          created_by: userId,
          ...(motivoSinCobro ? { metadata: { motivoSinCobro } } : {}),
        })
      } catch (err) { console.error("Error inserting orden_evento:", err) }
    })()

    // Saldo que queda tras la entrega. Se devuelve en la respuesta para que la
    // UI pueda encadenar el cobro sin recalcularlo por su cuenta (el cliente no
    // conoce el costo_final que se acaba de confirmar).
    const costoFinal = parseFloat(updatedOrden.costo_final || "0")
    const descuento = parseFloat(updatedOrden.descuento_cobro || "0")
    const cobrado = parseFloat(updatedOrden.total_cobrado || "0")
    const pendienteCobro = sinCobro
      ? 0
      : Math.round((costoFinal - descuento - cobrado) * 100) / 100

    // Fiado: si se entrega con saldo pendiente (y no es entrega sin cobro),
    // debitar la cuenta corriente del cliente.
    if (!sinCobro && orden.cliente_id) {
      const pendiente = pendienteCobro
      if (pendiente > 0) {
        const { error: fiadoError } = await supabaseAdmin.rpc("cargar_deuda_cuenta_corriente", {
          p_org_id: organizationId!,
          p_cliente_id: orden.cliente_id,
          p_monto: pendiente,
          p_referencia_tipo: "ORDEN",
          p_referencia_id: id,
          p_usuario_id: userId!,
          // Derived from the orden's own sucursal_id (parent record), not the
          // current operator's active cookie.
          p_sucursal_id: (orden as any).sucursal_id ?? null,
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

    // Consume reserved stock: deduct from physical stock + release reservation.
    //
    // supabaseAdmin.rpc() NO lanza ante un error de Postgres: resuelve con
    // { data, error }. El try/catch solo no alcanzaba — hay que leer `error`,
    // si no un fallo del consumo deja el stock reservado para siempre sin que
    // nadie se entere (era el caso cuando el descuento por deposito abortaba).
    //
    // El fallo NO cancela la entrega: el equipo ya se le dio al cliente y
    // bloquear el cierre por un problema de inventario seria peor. Se registra
    // y se devuelve como advertencia para que quede visible.
    let stockWarning: string | null = null
    try {
      const { data: consumoResult, error: consumoError } = await supabaseAdmin.rpc(
        "consumir_reservas_orden",
        { p_orden_id: id, p_user_id: userId }
      )

      if (consumoError) {
        stockWarning =
          "La orden se entregó, pero no se pudo descontar el stock de los repuestos. Revisá el inventario."
        console.error(
          `[entregar] consumir_reservas_orden falló para la orden ${id}:`,
          consumoError
        )
      } else if (consumoResult && (consumoResult as any).success !== true) {
        stockWarning =
          "La orden se entregó, pero el descuento de stock de los repuestos quedó incompleto."
        console.error(
          `[entregar] consumir_reservas_orden devolvió un resultado inesperado para la orden ${id}:`,
          consumoResult
        )
      }
    } catch (consumeErr) {
      stockWarning =
        "La orden se entregó, pero no se pudo descontar el stock de los repuestos. Revisá el inventario."
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
        sucursalId: (orden as any).sucursal_id ?? null,
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
      // Lo usa la UI para encadenar el cobro apenas se cierra la entrega.
      pendienteCobro,
      // Presente solo si el descuento de stock fallo: la entrega se completo
      // igual, pero el inventario quedo sin ajustar y hay que revisarlo.
      ...(stockWarning ? { warning: stockWarning } : {}),
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    console.error("Error registering delivery:", error)
    return NextResponse.json({ error: "Error al registrar entrega" }, { status: 500 })
  }
}
