import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { createAuditLogger } from "@/lib/audit"
import { z } from "zod"

const itemSchema = z.object({
  id: z.string().optional(),
  descripcion: z.string().min(1, "Descripción requerida"),
  cantidad: z.number().int().positive("Cantidad debe ser mayor a 0"),
  precioUnitario: z.number().positive("Precio debe ser mayor a 0"),
  unidad: z.string().optional(),
  descuentoTipo: z.enum(["porcentaje", "fijo"]).optional(),
  descuentoValor: z.number().min(0).optional(),
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
})

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
      subtotal: i.subtotal,
      unidad: i.unidad,
      descuentoTipo: i.descuento_tipo,
      descuentoValor: i.descuento_valor,
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
        ordenes_servicio (
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

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden editar cotizaciones" },
        { status: 403 }
      )
    }

    const { id } = await params
    const body = await request.json()
    const data = updateCotizacionSchema.parse(body)

    // Verify cotizacion exists and belongs to org
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("cotizaciones")
      .select("id, estado, organization_id, iva_porcentaje, descuento_global_tipo, descuento_global_valor")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json(
        { error: "Cotización no encontrada" },
        { status: 404 }
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
          items.map((item) => ({
            cotizacion_id: id,
            descripcion: item.descripcion,
            cantidad: item.cantidad,
            precio_unitario: item.precioUnitario,
            subtotal: item.subtotal,
            unidad: item.unidad || "Unidad",
            descuento_tipo: item.descuentoTipo || "porcentaje",
            descuento_valor: item.descuentoValor || 0,
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
          await supabaseAdmin
            .from("ordenes_servicio")
            .update({
              estado: "PRESUPUESTADO",
              presupuesto: cotWithOrder.total,
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
        ordenes_servicio (
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

    // Si la cotización estaba vinculada a una orden, limpiar presupuesto y revertir estado
    if (cotizacion.orden_id) {
      const { data: orden } = await supabaseAdmin
        .from("ordenes_servicio")
        .select("id, estado")
        .eq("id", cotizacion.orden_id)
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
          .eq("id", cotizacion.orden_id)
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
