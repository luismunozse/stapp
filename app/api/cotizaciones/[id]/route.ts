import { NextResponse } from "next/server"
import { requireAuth, canViewCotizacionCosts } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { createAuditLogger } from "@/lib/audit"
import { transicionarOrden } from "@/lib/orden-transicion"
import { hasPlanFeature } from "@/lib/subscriptions"
import { dateOnlyToNoonUtcISO } from "@/lib/timezone"
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

// Revierte una orden a EN_DIAGNOSTICO cuando deja de tener un presupuesto
// activo (última cotización desvinculada o eliminada) y registra el evento
// correspondiente en el historial. Usado por recalcPresupuestoOrden (PUT) y
// por el DELETE de cotización.
async function revertirOrdenSinPresupuestoActivo(
  ordenId: string,
  organizationId: string,
  estadoAnterior: string,
  descripcion: string,
  userId?: string | null
) {
  // UPDATE atómico vía la máquina de estados: solo revierte desde PRESUPUESTADO
  // (transición válida). Si la orden ya no está en ese estado —o es APROBADO—
  // el helper devuelve no-ok y no tocamos nada: evita el regreso inválido #6a.
  const resultado = await transicionarOrden(supabaseAdmin, {
    ordenId,
    organizationId,
    esperado: "PRESUPUESTADO",
    nuevo: "EN_DIAGNOSTICO",
    camposExtra: {
      presupuesto: null,
      costo_final: null,
      presupuesto_aprobado_portal: false,
      presupuesto_firma_url: null,
      presupuesto_fecha_aprobacion: null,
    },
  })

  if (!resultado.ok) return

  // Evento en el historial de la orden (fire-and-forget: un fallo acá no
  // debe hacer fallar la actualización/eliminación de la cotización)
  void (async () => {
    try {
      await supabaseAdmin.from("orden_eventos").insert({
        orden_id: ordenId,
        organization_id: organizationId,
        tipo: "CAMBIO_ESTADO",
        estado_anterior: estadoAnterior,
        estado_nuevo: "EN_DIAGNOSTICO",
        descripcion,
        ...(userId ? { created_by: userId } : {}),
      })
    } catch (err) {
      console.error("Error inserting orden_evento:", err)
    }
  })()
}

async function recalcPresupuestoOrden(ordenId: string, organizationId: string, userId?: string | null) {
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
    if (orden && orden.estado === "PRESUPUESTADO") {
      await revertirOrdenSinPresupuestoActivo(
        ordenId,
        organizationId,
        orden.estado,
        "Cotización desvinculada o eliminada: se removió el último presupuesto activo de la orden",
        userId
      )
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

function formatCotizacion(c: any, includeCosts: boolean) {
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
      // Cost/margin data is ADMIN-only (server-side enforced, not just hidden in UI).
      costoUnitario: includeCosts && i.costo_unitario != null ? Number(i.costo_unitario) : null,
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
    const { error, organizationId, role } = await requireAuth()
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

    return NextResponse.json(formatCotizacion(cotizacion, canViewCotizacionCosts(role)))
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
        ? dateOnlyToNoonUtcISO(data.fechaVencimiento)
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

      // Cost/margin data is ADMIN-only, uniformly (VENDEDOR included — they
      // have no cotizaciones nav access today, so losing cost entry here is
      // deliberate, not an oversight; see canViewCotizacionCosts). Non-admin
      // actors never see costoUnitario in GET responses, so their edit
      // payload can't carry trustworthy values — resolve costs server-side
      // instead:
      //  - existing item (matched to a stored row) with an UNCHANGED inventario
      //    link: preserve the DB's current costo_unitario, ignoring whatever
      //    the client sent (blocks spoofing and prevents an edit from silently
      //    wiping out cost data an admin entered earlier).
      //  - existing item whose inventario link CHANGED (relinked to another
      //    product, or unlinked): the old cost no longer applies — re-derive
      //    from the new inventario.precio_compra, or null if unlinked.
      //  - new item linked to inventario: derive from inventario.precio_compra.
      //  - new free-text item: costo_unitario stays null.
      //
      // Matching an existing item cannot rely on item.id alone. This handler
      // deletes every items_cotizacion row and re-inserts fresh ones on each
      // PUT, and the insert never supplies an id (the column defaults to
      // generate_cuid()), so ids change on every save. Any client holding a
      // pre-save copy — a second tab, or the SWR cache in cotizacion-list,
      // which sets revalidateOnFocus: false — submits ids that no longer
      // exist. The id lookup missed, the item looked new, and a free-text line
      // (nothing to re-derive from) lost the manual cost an ADMIN had entered.
      //
      // The fix is a natural key — descripción (trimmed, case-insensitive)
      // plus the inventario link — used ONLY when the client sent an id that
      // missed. The key is the tuple that decides which cost applies, so a hit
      // means the same line: it also implies the link is unchanged, since the
      // link is part of the key. Restricting it to payloads that carry an id
      // keeps a genuinely new line (no id) from inheriting a same-named row's
      // cost. Rows are recreated rather than diffed because turning this into
      // a three-way diff would rework a write path that also feeds
      // recalcPresupuestoOrden, the stock reservations released by
      // liberar_items_cotizacion, and the items_factura.cotizacion_item_id FK
      // — and items_cotizacion has no unique constraint to upsert on anyway.
      //
      // Two limits, on purpose: a line renamed by the same edit that carries a
      // stale id is indistinguishable from a new line and still resolves to
      // null, and an ambiguous key (several stored rows sharing it but
      // disagreeing on cost) declines to guess.
      const canViewCosts = canViewCotizacionCosts(role)
      type StoredItemCost = { costoUnitario: number | null; inventarioId: string | null }
      const naturalKey = (descripcion: string | null, inventarioId: string | null) =>
        `${(descripcion || "").trim().toLowerCase()} ${inventarioId ?? ""}`
      const existingItemsById = new Map<string, StoredItemCost>()
      // null marks an ambiguous key: several rows share it and disagree.
      const existingItemsByNaturalKey = new Map<string, StoredItemCost | null>()
      const inventarioCostoById = new Map<string, number | null>()
      if (!canViewCosts) {
        const { data: existingItemRows, error: existingItemsError } = await supabaseAdmin
          .from("items_cotizacion")
          .select("id, descripcion, costo_unitario, inventario_id")
          .eq("cotizacion_id", id)
        if (existingItemsError) throw existingItemsError
        for (const row of existingItemRows || []) {
          const stored: StoredItemCost = {
            costoUnitario: row.costo_unitario != null ? Number(row.costo_unitario) : null,
            inventarioId: row.inventario_id ?? null,
          }
          existingItemsById.set(row.id, stored)

          const key = naturalKey(row.descripcion, stored.inventarioId)
          if (existingItemsByNaturalKey.has(key)) {
            // Duplicated lines that agree on cost resolve to the same answer
            // either way, so only a disagreement makes the key unusable.
            const previous = existingItemsByNaturalKey.get(key)
            if (!previous || previous.costoUnitario !== stored.costoUnitario) {
              existingItemsByNaturalKey.set(key, null)
            }
          } else {
            existingItemsByNaturalKey.set(key, stored)
          }
        }
      }

      const findStoredItem = (item: (typeof data.items)[number]): StoredItemCost | undefined => {
        if (!item.id) return undefined
        const byId = existingItemsById.get(item.id)
        if (byId) return byId
        return existingItemsByNaturalKey.get(
          naturalKey(item.descripcion, item.inventarioId ?? null)
        ) ?? undefined
      }

      if (!canViewCosts) {
        const inventarioIdsNeedingLookup = Array.from(new Set(
          data.items
            .filter((item) => {
              const stored = findStoredItem(item)
              const linkChanged = stored ? stored.inventarioId !== (item.inventarioId ?? null) : true
              return linkChanged && !!item.inventarioId
            })
            .map((item) => item.inventarioId as string)
        ))
        if (inventarioIdsNeedingLookup.length > 0) {
          const { data: invRows, error: invError } = await supabaseAdmin
            .from("inventario")
            .select("id, precio_compra")
            .eq("organization_id", organizationId!)
            .in("id", inventarioIdsNeedingLookup)
          if (invError) throw invError
          for (const row of invRows || []) {
            inventarioCostoById.set(row.id, row.precio_compra != null ? Number(row.precio_compra) : null)
          }
        }
      }

      const resolveCostoUnitario = (item: (typeof data.items)[number]): number | null => {
        if (canViewCosts) return item.costoUnitario ?? null
        const stored = findStoredItem(item)
        if (stored && stored.inventarioId === (item.inventarioId ?? null)) {
          return stored.costoUnitario
        }
        if (item.inventarioId) return inventarioCostoById.get(item.inventarioId) ?? null
        return null
      }

      const items = data.items.map((item) => ({
        ...item,
        subtotal: calcItemNeto(item),
        costoUnitario: resolveCostoUnitario(item),
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
            costo_unitario: item.costoUnitario,
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
      await recalcPresupuestoOrden(oid, organizationId!, userId)
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

    return NextResponse.json(formatCotizacion(cotizacion, canViewCotizacionCosts(role)))
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

    // Bug #6a: no se puede borrar la última cotización activa de una orden
    // APROBADA (dejaría la orden sin presupuesto y forzaría un regreso inválido
    // APROBADO -> EN_DIAGNOSTICO). El staff debe cancelar o mover la orden primero.
    if (cotizacion.orden_id) {
      const { data: otrasCots } = await supabaseAdmin
        .from("cotizaciones")
        .select("id")
        .eq("orden_id", cotizacion.orden_id)
        .neq("id", id)
        .is("deleted_at", null)
        .neq("estado", "RECHAZADA")
      if (!otrasCots || otrasCots.length === 0) {
        const { data: ordenAprob } = await supabaseAdmin
          .from("ordenes_servicio")
          .select("estado")
          .eq("id", cotizacion.orden_id)
          .single()
        if (ordenAprob?.estado === "APROBADO") {
          return NextResponse.json(
            {
              error:
                "No se puede borrar la última cotización de una orden aprobada. Cancelá o mové la orden primero.",
            },
            { status: 400 }
          )
        }
      }
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
        } else if (orden.estado === "PRESUPUESTADO") {
          // No quedan cotizaciones activas: revertir a EN_DIAGNOSTICO solo desde
          // PRESUPUESTADO (APROBADO ya fue bloqueado antes del borrado — bug #6a)
          await revertirOrdenSinPresupuestoActivo(
            cotizacion.orden_id,
            organizationId!,
            orden.estado,
            "Cotización eliminada: se removió el último presupuesto activo de la orden",
            userId
          )
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
