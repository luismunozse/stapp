import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { createAuditLogger } from "@/lib/audit"
import { hasPlanFeature } from "@/lib/subscriptions"
import { z } from "zod"

const itemSchema = z.object({
  id: z.string().optional(),
  descripcion: z.string().min(1, "Descripción requerida"),
  cantidad: z.number().int().positive("Cantidad debe ser mayor a 0"),
  precioUnitario: z.number().positive("Precio debe ser mayor a 0"),
  costoUnitario: z.number().min(0).nullable().optional(),
  unidad: z.string().optional(),
  descuentoTipo: z.enum(["porcentaje", "fijo"]).optional(),
  descuentoValor: z.number().min(0).optional(),
  inventarioId: z.string().nullable().optional(),
  tipoRepuesto: z.enum(["ORIGINAL", "ALTERNATIVO", "RECICLADO", "NO_APLICA"]).optional(),
})

const condicionesSchema = z.object({
  diagnostico: z.string().nullable().optional(),
  plazoEstimadoDias: z.number().int().min(0).nullable().optional(),
  anticipoTipo: z.enum(["porcentaje", "fijo"]).optional(),
  anticipoValor: z.number().min(0).optional(),
  garantiaDias: z.number().int().min(0).optional(),
  garantiaAlcance: z.enum(["REPUESTO", "MANO_OBRA", "AMBOS", "NINGUNA"]).optional(),
  politicaAbandonoDias: z.number().int().min(0).nullable().optional(),
}).optional().nullable()

const equipoSchema = z.object({
  dispositivo: z.string().min(1),
  tipoDispositivoId: z.string().optional().nullable(),
  tipoDispositivo: z.string().optional().nullable(),
  marca: z.string().optional().nullable(),
  modelo: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  imei: z.string().optional().nullable(),
  numeroSerie: z.string().optional().nullable(),
  problemaReportado: z.string().min(1),
  condiciones: condicionesSchema,
})

const checklistSchema = z.object({
  templateId: z.string(),
  tipoDispositivoId: z.string().optional().nullable(),
  valores: z.record(z.union([z.boolean(), z.string(), z.null()])),
  notas: z.string().optional().nullable(),
})

const updateCotizacionSchema = z.object({
  estado: z.enum(["BORRADOR", "ENVIADA", "ACEPTADA", "RECHAZADA"]).optional(),
  notas: z.string().optional(),
  fechaVencimiento: z.string().nullable().optional(),
  items: z.array(itemSchema).optional(),
  terminos: z.string().nullable().optional(),
  descuentoGlobalTipo: z.enum(["porcentaje", "fijo"]).optional(),
  descuentoGlobalValor: z.number().min(0).optional(),
  ivaPorcentaje: z.number().min(0).max(100).optional(),
  tipoCambio: z.number().positive().nullable().optional(),
  sectorId: z.string().nullable().optional(),
  ordenId: z.string().nullable().optional(),
  equipo: equipoSchema.optional(),
  checklist: checklistSchema.nullable().optional(),
})

async function recalcPresupuestoOrden(ordenId: string) {
  const { data: allCots } = await supabaseAdmin
    .from("cotizaciones")
    .select("total")
    .eq("orden_id", ordenId)
    .is("deleted_at", null)
    .neq("estado", "RECHAZADA")
  const total = (allCots || []).reduce((sum, c) => sum + Number(c.total), 0)

  if ((allCots?.length || 0) > 0) {
    await supabaseAdmin
      .from("ordenes_servicio")
      .update({ presupuesto: total, costo_final: total })
      .eq("id", ordenId)
  } else {
    const { data: orden } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("estado")
      .eq("id", ordenId)
      .single()
    if (orden && (orden.estado === "PRESUPUESTADO" || orden.estado === "APROBADO")) {
      await supabaseAdmin
        .from("ordenes_servicio")
        .update({
          estado: "EN_DIAGNOSTICO",
          presupuesto: null,
          costo_final: null,
          presupuesto_aprobado_portal: false,
          presupuesto_firma_url: null,
          presupuesto_fecha_aprobacion: null,
        })
        .eq("id", ordenId)
    } else {
      await supabaseAdmin
        .from("ordenes_servicio")
        .update({ presupuesto: null, costo_final: null })
        .eq("id", ordenId)
    }
  }
}

function calcItemNeto(item: { cantidad: number; precioUnitario: number; descuentoTipo?: string; descuentoValor?: number }) {
  const bruto = item.cantidad * item.precioUnitario
  const dv = item.descuentoValor || 0
  if (dv <= 0) return bruto
  if (item.descuentoTipo === "fijo") return Math.max(0, bruto - dv)
  return Math.max(0, bruto * (1 - dv / 100))
}

function formatCotizacion(c: any) {
  const orden = c.ordenes_servicio
  const cliente = c.clientes || orden?.clientes
  const sector = c.sectores_cliente
  return {
    id: c.id,
    ordenId: c.orden_id,
    clienteId: c.cliente_id,
    sectorId: c.sector_id,
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
    descuentoGlobalTipo: c.descuento_global_tipo,
    descuentoGlobalValor: c.descuento_global_valor,
    ivaPorcentaje: c.iva_porcentaje,
    terminos: c.terminos,
    tipo: c.tipo || "ORDEN",
    equipo: c.equipo_snapshot || null,
    checklist: c.checklist_snapshot || null,
    convertidaAOrdenId: c.convertida_a_orden_id || null,
    orden: orden ? {
      id: orden.id,
      numeroOrden: orden.numero_orden,
      dispositivo: orden.dispositivo,
      cliente: orden.clientes,
    } : null,
    cliente: cliente ? {
      id: cliente.id,
      nombre: cliente.nombre,
      email: cliente.email,
      telefono: cliente.telefono,
    } : null,
    sector: sector ? {
      id: sector.id,
      nombre: sector.nombre,
    } : null,
    items: c.items_cotizacion?.map((i: any) => ({
      id: i.id,
      descripcion: i.descripcion,
      cantidad: i.cantidad,
      precioUnitario: i.precio_unitario,
      costoUnitario: i.costo_unitario != null ? Number(i.costo_unitario) : null,
      subtotal: i.subtotal,
      unidad: i.unidad,
      descuentoTipo: i.descuento_tipo,
      descuentoValor: i.descuento_valor,
      inventarioId: i.inventario_id ?? null,
      tipoRepuesto: i.tipo_repuesto || "NO_APLICA",
    })),
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params

    // Try by organization_id first (supports both standalone and order-linked)
    const { data: cotizacion, error: dbError } = await supabaseAdmin
      .from("cotizaciones")
      .select(`
        *,
        ordenes_servicio!cotizaciones_orden_id_fkey (
          id, numero_orden, dispositivo, organization_id,
          clientes (*)
        ),
        clientes (*),
        sectores_cliente (id, nombre),
        items_cotizacion (*)
      `)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .single()

    if (dbError || !cotizacion) {
      return NextResponse.json(
        { error: "Cotización no encontrada" },
        { status: 404 }
      )
    }

    return NextResponse.json(formatCotizacion(cotizacion))
  } catch (error) {
    console.error("Error fetching cotizacion:", error)
    return NextResponse.json(
      { error: "Error al obtener cotización" },
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

    const hasCotizaciones = await hasPlanFeature(organizationId!, "cotizaciones_online")
    if (!hasCotizaciones) {
      return NextResponse.json(
        { error: "Las cotizaciones requieren el plan Profesional", code: "FEATURE_REQUIRED", feature: "cotizaciones_online" },
        { status: 403 }
      )
    }

    const { id } = await params
    const body = await request.json()
    const data = updateCotizacionSchema.parse(body)

    // Verify cotizacion exists and belongs to org
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("cotizaciones")
      .select("id, estado, tipo, organization_id, created_by, iva_porcentaje, descuento_global_tipo, descuento_global_valor, orden_id")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json(
        { error: "Cotización no encontrada" },
        { status: 404 }
      )
    }

    // TECNICO sólo puede editar cotizaciones creadas por él mismo
    if (role === "TECNICO" && existing.created_by !== userId) {
      return NextResponse.json(
        { error: "No autorizado para editar esta cotización" },
        { status: 403 }
      )
    }

    // No modificar items de cotizaciones aceptadas/rechazadas
    if (["ACEPTADA", "RECHAZADA"].includes(existing.estado) && data.items) {
      return NextResponse.json(
        { error: "No se puede modificar una cotización aceptada o rechazada" },
        { status: 400 }
      )
    }

    // Validate fecha_vencimiento is not in the past
    if (data.fechaVencimiento) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      if (new Date(data.fechaVencimiento) < today) {
        return NextResponse.json(
          { error: "La fecha de vencimiento no puede ser anterior a hoy" },
          { status: 400 }
        )
      }
    }

    const updateData: Record<string, any> = {}

    if (data.estado !== undefined) updateData.estado = data.estado
    if (data.notas !== undefined) updateData.notas = data.notas
    if (data.terminos !== undefined) updateData.terminos = data.terminos
    if (data.fechaVencimiento !== undefined) {
      updateData.fecha_vencimiento = data.fechaVencimiento
        ? new Date(data.fechaVencimiento).toISOString()
        : null
    }
    if (data.descuentoGlobalTipo !== undefined) updateData.descuento_global_tipo = data.descuentoGlobalTipo
    if (data.descuentoGlobalValor !== undefined) updateData.descuento_global_valor = data.descuentoGlobalValor
    if (data.ivaPorcentaje !== undefined) updateData.iva_porcentaje = data.ivaPorcentaje
    if (data.tipoCambio !== undefined) updateData.tipo_cambio = data.tipoCambio
    if (data.sectorId !== undefined) updateData.sector_id = data.sectorId

    // Reasignación de orden (vincular/desvincular). Solo tipo ORDEN.
    let ordenIdChanged = false
    const oldOrdenId: string | null = existing.orden_id || null
    const newOrdenId: string | null | undefined = data.ordenId === undefined
      ? undefined
      : (data.ordenId || null)
    if (newOrdenId !== undefined && newOrdenId !== oldOrdenId) {
      if (existing.tipo === "PRESUPUESTO") {
        return NextResponse.json(
          { error: "No se puede vincular un presupuesto a una orden. Convertilo a orden primero." },
          { status: 400 }
        )
      }
      if (["ACEPTADA", "RECHAZADA"].includes(existing.estado)) {
        return NextResponse.json(
          { error: "No se puede reasignar una cotización aceptada o rechazada" },
          { status: 400 }
        )
      }
      if (newOrdenId) {
        const { data: ordenTarget, error: ordenErr } = await supabaseAdmin
          .from("ordenes_servicio")
          .select("id, organization_id")
          .eq("id", newOrdenId)
          .eq("organization_id", organizationId!)
          .single()
        if (ordenErr || !ordenTarget) {
          return NextResponse.json(
            { error: "Orden destino no encontrada" },
            { status: 404 }
          )
        }
      }
      updateData.orden_id = newOrdenId
      ordenIdChanged = true
    }

    // Equipo/checklist sólo aplican a PRESUPUESTO.
    if (existing.tipo === "PRESUPUESTO") {
      if (data.equipo !== undefined) updateData.equipo_snapshot = data.equipo
      if (data.checklist !== undefined) updateData.checklist_snapshot = data.checklist
    } else if (data.equipo || data.checklist) {
      return NextResponse.json(
        { error: "No se pueden modificar equipo/checklist en cotizaciones tipo ORDEN" },
        { status: 400 }
      )
    }

    // If updating items, recalculate totals with discounts/IVA
    if (data.items) {
      const ivaPct = data.ivaPorcentaje ?? existing.iva_porcentaje ?? 0
      const descGlobalTipo = data.descuentoGlobalTipo ?? "porcentaje"
      const descGlobalValor = data.descuentoGlobalValor ?? 0

      const items = data.items.map((item) => ({
        ...item,
        subtotal: calcItemNeto(item),
      }))
      const subtotalNeto = items.reduce((sum, item) => sum + item.subtotal, 0)

      let descGlobal = 0
      if (descGlobalValor > 0) {
        descGlobal = descGlobalTipo === "fijo"
          ? Math.min(descGlobalValor, subtotalNeto)
          : subtotalNeto * (descGlobalValor / 100)
      }
      const subtotalGravable = subtotalNeto - descGlobal
      const iva = subtotalGravable * (ivaPct / 100)
      const total = subtotalGravable + iva

      updateData.subtotal = subtotalNeto
      updateData.iva = iva
      updateData.total = total

      // Delete existing items
      await supabaseAdmin
        .from("items_cotizacion")
        .delete()
        .eq("cotizacion_id", id)

      // Create new items
      await supabaseAdmin
        .from("items_cotizacion")
        .insert(
          items.map((item: any) => ({
            cotizacion_id: id,
            descripcion: item.descripcion,
            cantidad: item.cantidad,
            precio_unitario: item.precioUnitario,
            costo_unitario: item.costoUnitario ?? null,
            subtotal: item.subtotal,
            unidad: item.unidad || "Unidad",
            descuento_tipo: item.descuentoTipo || "porcentaje",
            descuento_valor: item.descuentoValor || 0,
            inventario_id: item.inventarioId || null,
            tipo_repuesto: item.tipoRepuesto || "NO_APLICA",
          }))
        )
    }

    // Update cotizacion
    const { error: updateError } = await supabaseAdmin
      .from("cotizaciones")
      .update(updateData)
      .eq("id", id)

    if (updateError) {
      throw updateError
    }

    // Recalc presupuesto en órdenes afectadas (items o reasignación de orden_id)
    const ordenesARecalcular = new Set<string>()
    if (ordenIdChanged) {
      if (oldOrdenId) ordenesARecalcular.add(oldOrdenId)
      if (newOrdenId) ordenesARecalcular.add(newOrdenId)
    }
    if (data.items && updateData.total != null) {
      const efectiva = ordenIdChanged ? newOrdenId : oldOrdenId
      if (efectiva) ordenesARecalcular.add(efectiva)
    }
    for (const oid of ordenesARecalcular) {
      await recalcPresupuestoOrden(oid)
    }

    // If changing to RECHAZADA from ACEPTADA, release reservations
    if (data.estado === "RECHAZADA" && existing.estado === "ACEPTADA") {
      try {
        await supabaseAdmin.rpc("liberar_items_cotizacion", {
          p_cotizacion_id: id,
          p_user_id: userId,
          p_motivo: "Cotización rechazada",
        })
      } catch (releaseErr) {
        console.error("Error releasing stock reservations:", releaseErr)
      }
    }

    // Si cambió a ENVIADA y está vinculada a una orden, transicionar a PRESUPUESTADO
    if (data.estado === "ENVIADA") {
      const { data: cotWithOrder } = await supabaseAdmin
        .from("cotizaciones")
        .select("orden_id, total")
        .eq("id", id)
        .single()

      if (cotWithOrder?.orden_id) {
        const validStates = ["RECIBIDO", "EN_DIAGNOSTICO"]
        const { data: ordenActual } = await supabaseAdmin
          .from("ordenes_servicio")
          .select("id, estado")
          .eq("id", cotWithOrder.orden_id)
          .single()

        if (ordenActual && validStates.includes(ordenActual.estado)) {
          const estadoAnterior = ordenActual.estado
          const { data: allCots } = await supabaseAdmin
            .from("cotizaciones")
            .select("total")
            .eq("orden_id", cotWithOrder.orden_id)
            .is("deleted_at", null)
            .neq("estado", "RECHAZADA")
          const totalPresupuesto = (allCots || []).reduce((sum, c) => sum + Number(c.total), 0)
          await supabaseAdmin
            .from("ordenes_servicio")
            .update({
              estado: "PRESUPUESTADO",
              presupuesto: totalPresupuesto,
              costo_final: totalPresupuesto,
            })
            .eq("id", ordenActual.id)

          await supabaseAdmin.from("orden_eventos").insert({
            orden_id: ordenActual.id,
            organization_id: organizationId,
            tipo: "CAMBIO_ESTADO",
            estado_anterior: estadoAnterior,
            estado_nuevo: "PRESUPUESTADO",
            descripcion: "Cotización compartida con el cliente",
            metadata: { cotizacionId: id },
          })
        }
      }
    }

    // Get updated cotizacion
    const { data: cotizacion } = await supabaseAdmin
      .from("cotizaciones")
      .select(`
        *,
        ordenes_servicio!cotizaciones_orden_id_fkey (
          id, numero_orden, dispositivo,
          clientes (*)
        ),
        clientes (*),
        sectores_cliente (id, nombre),
        items_cotizacion (*)
      `)
      .eq("id", id)
      .single()

    // Audit log
    const audit = createAuditLogger(organizationId!, userId!, request)
    audit.update("cotizaciones", id, {}, {
      estado: data.estado,
      items_updated: !!data.items,
      total: cotizacion?.total,
    })

    return NextResponse.json(formatCotizacion(cotizacion))
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error updating cotizacion:", error)
    return NextResponse.json(
      { error: "Error al actualizar cotización" },
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

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden eliminar cotizaciones" },
        { status: 403 }
      )
    }

    const { id } = await params

    // Verify cotizacion via organization_id
    const { data: cotizacion, error: fetchError } = await supabaseAdmin
      .from("cotizaciones")
      .select("id, estado, organization_id, orden_id")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !cotizacion) {
      return NextResponse.json(
        { error: "Cotización no encontrada" },
        { status: 404 }
      )
    }

    if (cotizacion.estado === "ACEPTADA") {
      return NextResponse.json(
        { error: "No se puede eliminar una cotización aceptada" },
        { status: 400 }
      )
    }

    // Soft-delete
    const { error: deleteError } = await supabaseAdmin
      .from("cotizaciones")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)

    if (deleteError) {
      throw deleteError
    }

    // Si la cotización estaba vinculada a una orden, recalcular presupuesto con cotizaciones restantes
    if (cotizacion.orden_id) {
      const { data: orden } = await supabaseAdmin
        .from("ordenes_servicio")
        .select("id, estado")
        .eq("id", cotizacion.orden_id)
        .single()

      if (orden) {
        const { data: remaining } = await supabaseAdmin
          .from("cotizaciones")
          .select("total")
          .eq("orden_id", cotizacion.orden_id)
          .is("deleted_at", null)
          .neq("estado", "RECHAZADA")

        const totalPresupuesto = (remaining || []).reduce((sum, c) => sum + Number(c.total), 0)

        if (remaining && remaining.length > 0) {
          await supabaseAdmin
            .from("ordenes_servicio")
            .update({ presupuesto: totalPresupuesto, costo_final: totalPresupuesto })
            .eq("id", cotizacion.orden_id)
        } else if (orden.estado === "PRESUPUESTADO" || orden.estado === "APROBADO") {
          // No quedan cotizaciones activas: revertir a EN_DIAGNOSTICO solo si la orden estaba en flujo de presupuesto
          await supabaseAdmin
            .from("ordenes_servicio")
            .update({
              estado: "EN_DIAGNOSTICO",
              presupuesto: null,
              costo_final: null,
              presupuesto_aprobado_portal: false,
              presupuesto_firma_url: null,
              presupuesto_fecha_aprobacion: null,
            })
            .eq("id", cotizacion.orden_id)
        } else {
          // Otros estados: solo limpiar montos
          await supabaseAdmin
            .from("ordenes_servicio")
            .update({ presupuesto: null, costo_final: null })
            .eq("id", cotizacion.orden_id)
        }
      }
    }

    // Audit log
    const audit = createAuditLogger(organizationId!, userId!, request)
    audit.delete("cotizaciones", id, {
      numero_cotizacion: cotizacion.estado,
      estado: cotizacion.estado,
    })

    return NextResponse.json({ message: "Cotización eliminada" })
  } catch (error) {
    console.error("Error deleting cotizacion:", error)
    return NextResponse.json(
      { error: "Error al eliminar cotización" },
      { status: 500 }
    )
  }
}
