import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { createAuditLogger, diffObjects } from "@/lib/audit"
import { emitWebhookEvent } from "@/lib/webhooks/dispatcher"
import { queueNotification } from "@/lib/notifications/queue"
import { formatOrden } from "@/lib/db-utils"
import { esTransicionValida, getMensajeTransicionInvalida, validarCamposRequeridos } from "@/lib/orden-state-machine"
import { z } from "zod"

const updateOrdenSchema = z.object({
  estado: z
    .enum([
      "RECIBIDO",
      "EN_DIAGNOSTICO",
      "PRESUPUESTADO",
      "APROBADO",
      "EN_REPARACION",
      "ESPERANDO_REPUESTO",
      "REPARADO",
      "ENTREGADO",
      "ENTREGADO_SIN_REPARACION",
      "ENTREGADO_SIN_COBRO",
      "CANCELADO",
      "SIN_REPARACION",
    ])
    .optional(),
  tecnicoId: z.string().optional().nullable(),
  presupuesto: z.number().min(0, "El presupuesto no puede ser negativo").optional().nullable(),
  costoFinal: z.number().min(0, "El costo final no puede ser negativo").optional().nullable(),
  fechaPrometida: z.string().optional().nullable(),
  observaciones: z.string().optional().nullable(),
  notasInternas: z.string().optional().nullable(),
  diagnostico: z.string().optional().nullable(),
  problemaReportado: z.string().min(1, "El problema reportado no puede estar vacío").optional(),
  telefonoContacto: z.string().optional().nullable(),
  porcentajeComision: z.number().min(0).max(100).optional().nullable(),
  horasTrabajadas: z.number().min(0).optional().nullable(),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    const { id } = await params

    const { data: orden, error: dbError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select(`
        *,
        clientes (*),
        users:tecnico_id (
          id,
          nombre,
          email
        ),
        recibido:recibido_por (
          id,
          nombre
        ),
        repuestos_orden (
          *,
          inventario (*)
        ),
        cotizaciones!cotizaciones_orden_id_fkey (
          id,
          estado,
          deleted_at,
          items_cotizacion (
            cantidad,
            inventario_id,
            inventario:inventario_id ( precio_compra )
          )
        ),
        garantias (
          id,
          dias_validez,
          fecha_vencimiento,
          estado
        ),
        organizations:organization_id (
          nombre,
          nombre_mostrar,
          logo_url,
          telefono,
          direccion,
          comprobante_terminos,
          moneda,
          zona_horaria,
          garantia_dias_default
        )
      `)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (dbError || !orden) {
      return NextResponse.json(
        { error: "Orden no encontrada" },
        { status: 404 }
      )
    }

    // Técnicos solo pueden ver sus órdenes asignadas
    if (role === "TECNICO" && orden.tecnico_id !== userId) {
      return NextResponse.json(
        { error: "No autorizado" },
        { status: 403 }
      )
    }

    // Último cambio de estado para derivar estadoAnterior (plantillas WhatsApp
    // como "seguimiento_presupuesto_rechazado" lo necesitan).
    const { data: ultimoEventoEstado } = await supabaseAdmin
      .from("orden_eventos")
      .select("estado_anterior, estado_nuevo, created_at")
      .eq("orden_id", id)
      .eq("tipo", "CAMBIO_ESTADO")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    const formatted = formatOrden(orden)
    const org = (orden as any).organizations
    return NextResponse.json({
      ...formatted,
      organizationName: org?.nombre_mostrar || org?.nombre || null,
      organizationLogoUrl: org?.logo_url || null,
      organizationTelefono: org?.telefono || null,
      organizationDireccion: org?.direccion || null,
      organizationComprobanteTerminos: org?.comprobante_terminos || null,
      organizationMoneda: org?.moneda || null,
      organizationZonaHoraria: org?.zona_horaria || null,
      organizationGarantiaDiasDefault: org?.garantia_dias_default ?? null,
      estadoAnterior: ultimoEventoEstado?.estado_anterior ?? null,
    }, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    })
  } catch (error) {
    console.error("Error fetching orden:", error)
    return NextResponse.json(
      { error: "Error al obtener orden" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const data = updateOrdenSchema.parse(body)

    // Obtener orden actual
    const { data: orden, error: fetchError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select(`
        *,
        clientes (*),
        organizations (id, nombre, nombre_mostrar, slug, moneda, zona_horaria)
      `)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !orden) {
      return NextResponse.json(
        { error: "Orden no encontrada" },
        { status: 404 }
      )
    }

    // Técnicos solo pueden actualizar sus órdenes asignadas
    if (role === "TECNICO" && orden.tecnico_id !== userId) {
      return NextResponse.json(
        { error: "No autorizado" },
        { status: 403 }
      )
    }

    // Validar transición de estado (state machine)
    if (data.estado && data.estado !== orden.estado) {
      if (!esTransicionValida(orden.estado, data.estado)) {
        return NextResponse.json(
          { error: getMensajeTransicionInvalida(orden.estado, data.estado) },
          { status: 400 }
        )
      }

      // Validar campos requeridos para el nuevo estado
      // Considerar los datos que se envían en esta misma request
      const ordenConDatosNuevos = {
        ...orden,
        ...(data.presupuesto !== undefined ? { presupuesto: data.presupuesto } : {}),
        ...(data.costoFinal !== undefined ? { costo_final: data.costoFinal } : {}),
        ...(data.tecnicoId !== undefined ? { tecnico_id: data.tecnicoId } : {}),
        ...(data.diagnostico !== undefined ? { diagnostico: data.diagnostico } : {}),
      }
      const errorCampos = validarCamposRequeridos(data.estado, ordenConDatosNuevos)
      if (errorCampos) {
        return NextResponse.json({ error: errorCampos }, { status: 400 })
      }
    }

    // Validar que el técnico exista y tenga rol TECNICO
    let porcentajeComisionFromTecnico: number | null = null
    let costoHoraFromTecnico: number = 0
    if (data.tecnicoId) {
      const { data: tecnico } = await supabaseAdmin
        .from("users")
        .select("id, rol, porcentaje_comision, costo_hora")
        .eq("id", data.tecnicoId)
        .eq("organization_id", organizationId!)
        .single()

      if (!tecnico) {
        return NextResponse.json({ error: "El técnico seleccionado no existe" }, { status: 400 })
      }
      if (tecnico.rol !== "TECNICO" && tecnico.rol !== "ADMIN") {
        return NextResponse.json({ error: "El usuario seleccionado no tiene rol de técnico" }, { status: 400 })
      }
      porcentajeComisionFromTecnico = Number(tecnico.porcentaje_comision ?? 0)
      costoHoraFromTecnico = Number(tecnico.costo_hora ?? 0)
    }

    // Preparar datos para update
    const updateData: Record<string, any> = {}

    if (data.estado !== undefined) updateData.estado = data.estado
    if (data.tecnicoId !== undefined) {
      updateData.tecnico_id = data.tecnicoId
      // Al (re)asignar técnico, copiar su % por defecto si no vino explícito
      if (data.tecnicoId && data.porcentajeComision === undefined) {
        updateData.porcentaje_comision = porcentajeComisionFromTecnico
      }
      // Al desasignar, limpiar snapshot
      if (!data.tecnicoId && data.porcentajeComision === undefined) {
        updateData.porcentaje_comision = null
      }
      // Snapshot labor rate on assign; clear on de-assign
      if (data.tecnicoId) {
        updateData.costo_hora_snapshot = costoHoraFromTecnico
      } else {
        updateData.costo_hora_snapshot = null
      }
    }
    if (data.porcentajeComision !== undefined) updateData.porcentaje_comision = data.porcentajeComision
    if (data.presupuesto !== undefined) updateData.presupuesto = data.presupuesto
    if (data.costoFinal !== undefined) updateData.costo_final = data.costoFinal
    if (data.observaciones !== undefined) updateData.observaciones = data.observaciones
    if (data.notasInternas !== undefined) updateData.notas_internas = data.notasInternas
    if (data.diagnostico !== undefined) updateData.diagnostico = data.diagnostico
    if (data.problemaReportado !== undefined) updateData.problema_reportado = data.problemaReportado
    if (data.telefonoContacto !== undefined) updateData.telefono_contacto = data.telefonoContacto
    if (data.horasTrabajadas !== undefined) {
      const h = Number(data.horasTrabajadas)
      updateData.horas_trabajadas = Number.isFinite(h) && h >= 0 ? h : 0
    }

    if (data.fechaPrometida !== undefined) {
      updateData.fecha_prometida = data.fechaPrometida
        ? new Date(`${data.fechaPrometida}T12:00:00Z`).toISOString()
        : null
    }

    // Auto-transicionar a PRESUPUESTADO cuando se define presupuesto en orden no presupuestada
    if (
      data.presupuesto != null &&
      data.presupuesto > 0 &&
      !data.estado &&
      (orden.estado === "RECIBIDO" || orden.estado === "EN_DIAGNOSTICO")
    ) {
      updateData.estado = "PRESUPUESTADO"
    }

    // Setear fecha_completado la primera vez que llega a REPARADO o ENTREGADO
    if ((data.estado === "REPARADO" || data.estado === "ENTREGADO" || data.estado === "ENTREGADO_SIN_REPARACION" || data.estado === "ENTREGADO_SIN_COBRO") && !orden.fecha_completado) {
      updateData.fecha_completado = new Date().toISOString()
    }

    const { data: updatedOrden, error: updateError } = await supabaseAdmin
      .from("ordenes_servicio")
      .update(updateData)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .select(`
        *,
        clientes (*),
        users:tecnico_id (
          id,
          nombre
        )
      `)
      .single()

    if (updateError) {
      throw updateError
    }

    // Registrar evento en orden_eventos para timeline público (fire-and-forget)
    const estadoFinal = updateData.estado
    if (estadoFinal && estadoFinal !== orden.estado) {
      void (async () => {
        try {
          await supabaseAdmin.from("orden_eventos").insert({
            orden_id: id,
            organization_id: organizationId!,
            tipo: "CAMBIO_ESTADO",
            estado_anterior: orden.estado,
            estado_nuevo: estadoFinal,
            descripcion: `Estado cambiado de ${orden.estado} a ${estadoFinal}`,
            created_by: userId,
          })
        } catch (err) { console.error("Error inserting orden_evento:", err) }
      })()

      // Release reserved stock when order is cancelled
      if (estadoFinal === "CANCELADO") {
        void (async () => {
          try {
            await supabaseAdmin.rpc("liberar_reservas_orden", {
              p_orden_id: id,
              p_user_id: userId,
            })
          } catch (err) { console.error("Error releasing order reservations:", err) }
        })()
      }
    }

    if (data.presupuesto !== undefined && data.presupuesto !== null && data.presupuesto !== orden.presupuesto) {
      void (async () => {
        try {
          await supabaseAdmin.from("orden_eventos").insert({
            orden_id: id,
            organization_id: organizationId!,
            tipo: "PRESUPUESTO_DEFINIDO",
            descripcion: `Presupuesto definido: $${data.presupuesto!.toLocaleString()}`,
            metadata: { presupuesto: data.presupuesto },
            created_by: userId,
          })
        } catch (err) { console.error("Error inserting orden_evento:", err) }
      })()
    }

    if (data.diagnostico !== undefined && data.diagnostico !== orden.diagnostico) {
      void (async () => {
        try {
          await supabaseAdmin.from("orden_eventos").insert({
            orden_id: id,
            organization_id: organizationId!,
            tipo: "NOTA",
            descripcion: `Diagnostico actualizado`,
            metadata: { diagnostico: data.diagnostico },
            created_by: userId,
          })
        } catch (err) { console.error("Error inserting orden_evento:", err) }
      })()
    }

    // Auditoría
    const audit = createAuditLogger(organizationId!, userId!, request)
    const changes = diffObjects(orden, updatedOrden)
    await audit.update("ordenes_servicio", id, changes.before, changes.after)

    // Notificaciones al cliente
    const cliente = orden.clientes as any
    const org = orden.organizations as any

    // Webhook outbound: orden.estado_cambiado (fire-and-forget)
    if (estadoFinal && estadoFinal !== orden.estado) {
      emitWebhookEvent(organizationId!, "orden.estado_cambiado", {
        id,
        numeroOrden: orden.numero_orden ?? null,
        estadoAnterior: orden.estado,
        estadoNuevo: estadoFinal,
        dispositivo: orden.dispositivo ?? null,
        clienteId: (orden.clientes as any)?.id ?? null,
      }).catch(() => {})
    }

    const presupuestoCambio =
      data.presupuesto !== undefined &&
      data.presupuesto !== null &&
      data.presupuesto !== orden.presupuesto

    // Notificación de cambio de estado
    if (estadoFinal && estadoFinal !== orden.estado && !(estadoFinal === "PRESUPUESTADO" && presupuestoCambio)) {
      queueNotification({
        organizationId: organizationId!,
        ordenId: id,
        clienteId: cliente.id,
        tipo: "CAMBIO_ESTADO",
        context: {
          organizationName: org.nombre_mostrar || org.nombre,
          organizationSlug: org.slug,
          moneda: org.moneda || "ARS",
          zonaHoraria: org.zona_horaria || "America/Argentina/Buenos_Aires",
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
            estado: estadoFinal,
            estadoAnterior: orden.estado,
            presupuesto: orden.presupuesto,
            publicToken: orden.public_token,
            // Técnico efectivo: el reasignado en este request si vino, si no el actual.
            tecnicoId: (data.tecnicoId !== undefined ? data.tecnicoId : orden.tecnico_id) ?? null,
          },
        },
      }).catch(err => console.error("Error queueing notification:", err))
    }

    // Notificación de presupuesto definido
    if (presupuestoCambio) {
      queueNotification({
        organizationId: organizationId!,
        ordenId: id,
        clienteId: cliente.id,
        tipo: "PRESUPUESTO_DEFINIDO",
        context: {
          organizationName: org.nombre_mostrar || org.nombre,
          organizationSlug: org.slug,
          moneda: org.moneda || "ARS",
          zonaHoraria: org.zona_horaria || "America/Argentina/Buenos_Aires",
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
            estado: updatedOrden.estado,
            presupuesto: data.presupuesto,
            publicToken: orden.public_token,
          },
        },
      }).catch(err => console.error("Error queueing notification:", err))
    }

    return NextResponse.json(formatOrden(updatedOrden))
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error updating orden:", error)
    return NextResponse.json(
      { error: "Error al actualizar orden" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    // Solo admins pueden eliminar órdenes
    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden eliminar órdenes" },
        { status: 403 }
      )
    }

    const { id } = await params

    // Verificar que la orden existe y pertenece a la organización
    const { data: orden, error: fetchError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("id, numero_orden, estado")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !orden) {
      return NextResponse.json(
        { error: "Orden no encontrada" },
        { status: 404 }
      )
    }

    // Eliminar la orden (las relaciones se eliminan en cascada por la DB)
    const { error: deleteError } = await supabaseAdmin
      .from("ordenes_servicio")
      .delete()
      .eq("id", id)
      .eq("organization_id", organizationId!)

    if (deleteError) {
      throw deleteError
    }

    // Auditoría
    const audit = createAuditLogger(organizationId!, userId!, request)
    await audit.delete("ordenes_servicio", id, orden)

    return NextResponse.json({
      message: `Orden #${orden.numero_orden} eliminada correctamente`
    })
  } catch (error) {
    console.error("Error deleting orden:", error)
    return NextResponse.json(
      { error: "Error al eliminar orden" },
      { status: 500 }
    )
  }
}
