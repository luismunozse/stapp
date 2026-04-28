import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { getNextQuoteNumber } from "@/lib/counters"
import { parsePagination } from "@/lib/api-utils"
import { createAuditLogger } from "@/lib/audit"
import { randomBytes } from "crypto"
import { z } from "zod"

const itemSchema = z.object({
  descripcion: z.string().min(1, "Descripción requerida"),
  cantidad: z.number().int().positive("Cantidad debe ser mayor a 0"),
  precioUnitario: z.number().positive("Precio debe ser mayor a 0"),
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
  dispositivo: z.string().min(1, "Dispositivo requerido"),
  tipoDispositivoId: z.string().optional().nullable(),
  tipoDispositivo: z.string().optional().nullable(),
  marca: z.string().optional().nullable(),
  modelo: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  imei: z.string().optional().nullable(),
  numeroSerie: z.string().optional().nullable(),
  problemaReportado: z.string().min(1, "Problema reportado requerido"),
  condiciones: condicionesSchema,
})

const checklistSchema = z.object({
  templateId: z.string(),
  tipoDispositivoId: z.string().optional().nullable(),
  valores: z.record(z.union([z.boolean(), z.string(), z.null()])),
  notas: z.string().optional().nullable(),
})

const cotizacionSchema = z.object({
  tipo: z.enum(["ORDEN", "PRESUPUESTO"]).default("ORDEN"),
  ordenId: z.string().optional(),
  clienteId: z.string().optional(),
  sectorId: z.string().optional(),
  items: z.array(itemSchema).min(1, "Debe tener al menos un item"),
  notas: z.string().optional(),
  fechaVencimiento: z.string().optional(),
  terminos: z.string().optional(),
  descuentoGlobalTipo: z.enum(["porcentaje", "fijo"]).optional(),
  descuentoGlobalValor: z.number().min(0).optional(),
  ivaPorcentaje: z.number().min(0).max(100).optional(),
  tipoCambio: z.number().positive().optional(),
  equipo: equipoSchema.optional(),
  checklist: checklistSchema.optional(),
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
    vistoAt: c.visto_at || null,
    vistoCount: c.visto_count || 0,
    motivoRechazo: c.motivo_rechazo || null,
    tipoCambio: c.tipo_cambio || null,
    tipo: c.tipo || "ORDEN",
    equipo: c.equipo_snapshot || null,
    checklist: c.checklist_snapshot || null,
    convertidaAOrdenId: c.convertida_a_orden_id || null,
    clienteNombre: cliente?.nombre || null,
    clienteEmail: cliente?.email || null,
    ordenNumero: orden?.numero_orden || null,
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
      inventarioId: i.inventario_id ?? null,
      tipoRepuesto: i.tipo_repuesto || "NO_APLICA",
    })),
  }
}

export async function GET(request: Request) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const ordenId = searchParams.get("ordenId")
    const estado = searchParams.get("estado")
    const search = searchParams.get("search")

    if (ordenId) {
      // Modo legacy: filtrar por orden_id con inner join
      let query = supabaseAdmin
        .from("cotizaciones")
        .select(`
          *,
          ordenes_servicio!cotizaciones_orden_id_fkey!inner (
            id, numero_orden, dispositivo, organization_id,
            clientes (*)
          ),
          sectores_cliente (id, nombre),
          items_cotizacion (*)
        `)
        .eq("orden_id", ordenId)
        .eq("ordenes_servicio.organization_id", organizationId!)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })

      if (estado) query = query.eq("estado", estado)
      if (role === "TECNICO") query = query.eq("created_by", userId!)

      const { data: cotizaciones, error: dbError } = await query
      if (dbError) throw dbError

      return NextResponse.json(cotizaciones?.map(formatCotizacion) || [])
    }

    // Modo standalone: filtrar por organization_id con LEFT join + paginacion
    const { page, limit, offset } = parsePagination(searchParams)

    let query = supabaseAdmin
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
      `, { count: "exact" })
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })

    if (estado && estado !== "TODOS") query = query.eq("estado", estado)
    if (search) {
      // Buscar por número de cotización o nombre de cliente.
      // Supabase no soporta OR cross-table en un select, así que resolvemos
      // los cliente_ids que matchean y armamos un or() con in-list.
      const escaped = search.replace(/[%_]/g, "\\$&") // escape wildcards
      const { data: clientesMatch } = await supabaseAdmin
        .from("clientes")
        .select("id")
        .eq("organization_id", organizationId!)
        .ilike("nombre", `%${escaped}%`)

      const clienteIds = (clientesMatch || []).map((c) => c.id)
      if (clienteIds.length > 0) {
        query = query.or(
          `numero_cotizacion.ilike.%${escaped}%,cliente_id.in.(${clienteIds.join(",")})`
        )
      } else {
        query = query.ilike("numero_cotizacion", `%${escaped}%`)
      }
    }
    if (role === "TECNICO") query = query.eq("created_by", userId!)

    query = query.range(offset, offset + limit - 1)

    const { data: cotizaciones, error: dbError, count } = await query
    if (dbError) throw dbError

    const total = count || 0
    const result = cotizaciones?.map(formatCotizacion) || []

    return NextResponse.json({
      data: result,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    })
  } catch (error) {
    console.error("Error fetching cotizaciones:", error)
    return NextResponse.json(
      { error: "Error al obtener cotizaciones" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    const body = await request.json()
    const data = cotizacionSchema.parse(body)

    // Reglas por tipo:
    //   ORDEN       -> debe venir con ordenId o clienteId (flujo actual).
    //   PRESUPUESTO -> requiere clienteId + equipo (documento plano).
    if (data.tipo === "PRESUPUESTO") {
      if (!data.clienteId) {
        return NextResponse.json(
          { error: "Un presupuesto requiere un cliente" },
          { status: 400 }
        )
      }
      if (!data.equipo) {
        return NextResponse.json(
          { error: "Un presupuesto requiere los datos del equipo" },
          { status: 400 }
        )
      }
      if (data.ordenId) {
        return NextResponse.json(
          { error: "Un presupuesto plano no puede estar vinculado a una orden" },
          { status: 400 }
        )
      }
    } else {
      if (!data.ordenId && !data.clienteId) {
        return NextResponse.json(
          { error: "Se requiere una orden o un cliente" },
          { status: 400 }
        )
      }
    }

    let clienteIdForInsert: string | null = null

    if (data.ordenId) {
      // Verificar que la orden existe y pertenece a la organización
      const { data: orden, error: ordenError } = await supabaseAdmin
        .from("ordenes_servicio")
        .select("id, organization_id, cliente_id")
        .eq("id", data.ordenId)
        .eq("organization_id", organizationId!)
        .single()

      if (ordenError || !orden) {
        return NextResponse.json(
          { error: "Orden no encontrada" },
          { status: 404 }
        )
      }
      clienteIdForInsert = orden.cliente_id
    }

    if (data.clienteId) {
      // Verificar que el cliente pertenece a la organización
      const { data: cliente, error: clienteError } = await supabaseAdmin
        .from("clientes")
        .select("id, organization_id")
        .eq("id", data.clienteId)
        .eq("organization_id", organizationId!)
        .single()

      if (clienteError || !cliente) {
        return NextResponse.json(
          { error: "Cliente no encontrado" },
          { status: 404 }
        )
      }
      clienteIdForInsert = data.clienteId
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

    // Calculate totals with discounts and IVA
    const ivaPct = data.ivaPorcentaje || 0
    const descGlobalTipo = data.descuentoGlobalTipo || "porcentaje"
    const descGlobalValor = data.descuentoGlobalValor || 0

    const items = data.items.map((item) => ({
      ...item,
      subtotal: calcItemNeto(item),
    }))
    const subtotalNeto = items.reduce((sum, item) => sum + item.subtotal, 0)

    // Apply global discount
    let descGlobal = 0
    if (descGlobalValor > 0) {
      descGlobal = descGlobalTipo === "fijo"
        ? Math.min(descGlobalValor, subtotalNeto)
        : subtotalNeto * (descGlobalValor / 100)
    }
    const subtotalGravable = subtotalNeto - descGlobal
    const iva = subtotalGravable * (ivaPct / 100)
    const total = subtotalGravable + iva

    // Get quote number
    const numeroCotizacion = await getNextQuoteNumber(organizationId!)

    // Create cotizacion
    const publicToken = randomBytes(16).toString("hex")
    const { data: cotizacion, error: createError } = await supabaseAdmin
      .from("cotizaciones")
      .insert({
        orden_id: data.ordenId || null,
        cliente_id: clienteIdForInsert,
        sector_id: data.sectorId || null,
        organization_id: organizationId,
        numero_cotizacion: numeroCotizacion,
        public_token: publicToken,
        notas: data.notas || null,
        terminos: data.terminos || null,
        fecha_vencimiento: data.fechaVencimiento
          ? new Date(data.fechaVencimiento).toISOString()
          : null,
        descuento_global_tipo: descGlobalTipo,
        descuento_global_valor: descGlobalValor,
        iva_porcentaje: ivaPct,
        subtotal: subtotalNeto,
        iva,
        total,
        tipo_cambio: data.tipoCambio || null,
        created_by: userId,
        tipo: data.tipo,
        equipo_snapshot: data.tipo === "PRESUPUESTO" ? data.equipo : null,
        checklist_snapshot: data.tipo === "PRESUPUESTO" ? data.checklist || null : null,
      })
      .select()
      .single()

    if (createError) {
      throw createError
    }

    // Create items
    const { error: itemsError } = await supabaseAdmin
      .from("items_cotizacion")
      .insert(
        items.map((item) => ({
          cotizacion_id: cotizacion.id,
          descripcion: item.descripcion,
          cantidad: item.cantidad,
          precio_unitario: item.precioUnitario,
          subtotal: item.subtotal,
          unidad: item.unidad || "Unidad",
          descuento_tipo: item.descuentoTipo || "porcentaje",
          descuento_valor: item.descuentoValor || 0,
          inventario_id: item.inventarioId || null,
          tipo_repuesto: item.tipoRepuesto || "NO_APLICA",
        }))
      )

    if (itemsError) {
      await supabaseAdmin.from("cotizaciones").delete().eq("id", cotizacion.id)
      throw itemsError
    }

    // Auto-fill presupuesto on the linked order — sum ALL cotizaciones for this orden
    if (data.ordenId) {
      const { data: allCots } = await supabaseAdmin
        .from("cotizaciones")
        .select("total")
        .eq("orden_id", data.ordenId)
      const totalPresupuesto = (allCots || []).reduce((sum, c) => sum + Number(c.total), 0)
      await supabaseAdmin
        .from("ordenes_servicio")
        .update({ presupuesto: totalPresupuesto, costo_final: totalPresupuesto })
        .eq("id", data.ordenId)
    }

    // Get complete cotizacion
    const { data: cotizacionCompleta } = await supabaseAdmin
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
      .eq("id", cotizacion.id)
      .single()

    // Audit log
    const audit = createAuditLogger(organizationId!, userId!, request)
    audit.create("cotizaciones", cotizacion.id, {
      numero_cotizacion: numeroCotizacion,
      total,
      cliente_id: clienteIdForInsert,
      items_count: items.length,
    })

    return NextResponse.json(formatCotizacion(cotizacionCompleta), { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error creating cotizacion:", error)
    return NextResponse.json(
      { error: "Error al crear cotización" },
      { status: 500 }
    )
  }
}
