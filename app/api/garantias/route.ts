import { NextResponse } from "next/server"
import { requireAuth, requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { queueNotification } from "@/lib/inngest"
import { z } from "zod"

const garantiaSchema = z.object({
  ordenId: z.string().min(1, "Orden requerida"),
  diasValidez: z.number().int().positive().default(30),
  notas: z.string().optional(),
})

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const estado = searchParams.get("estado")
    const porVencer = searchParams.get("porVencer") === "true"

    let query = supabaseAdmin
      .from("garantias")
      .select(`
        *,
        ordenes_servicio!inner (
          id,
          numero_orden,
          dispositivo,
          organization_id,
          clientes (*)
        ),
        reclamos_garantia (*)
      `)
      .eq("ordenes_servicio.organization_id", organizationId!)
      .order("fecha_vencimiento", { ascending: true })

    if (estado) {
      query = query.eq("estado", estado)
    }

    if (porVencer) {
      const hoy = new Date().toISOString()
      const enSieteDias = new Date()
      enSieteDias.setDate(enSieteDias.getDate() + 7)

      query = query
        .eq("estado", "ACTIVA")
        .gte("fecha_vencimiento", hoy)
        .lte("fecha_vencimiento", enSieteDias.toISOString())
    }

    const { data: garantias, error: dbError } = await query

    if (dbError) {
      throw dbError
    }

    // Actualizar garantías vencidas
    const hoy = new Date()
    for (const garantia of garantias || []) {
      if (garantia.estado === "ACTIVA" && new Date(garantia.fecha_vencimiento) < hoy) {
        await supabaseAdmin
          .from("garantias")
          .update({ estado: "VENCIDA" })
          .eq("id", garantia.id)
        garantia.estado = "VENCIDA"
      }
    }

    // Formatear respuesta
    const garantiasFormatted = garantias?.map(g => ({
      id: g.id,
      ordenId: g.orden_id,
      diasValidez: g.dias_validez,
      fechaInicio: g.fecha_inicio,
      fechaVencimiento: g.fecha_vencimiento,
      estado: g.estado,
      notas: g.notas,
      createdAt: g.created_at,
      orden: {
        id: g.ordenes_servicio.id,
        numeroOrden: g.ordenes_servicio.numero_orden,
        dispositivo: g.ordenes_servicio.dispositivo,
        cliente: g.ordenes_servicio.clientes,
      },
      reclamos: g.reclamos_garantia?.sort((a: any, b: any) =>
        new Date(b.fecha_reclamo).getTime() - new Date(a.fecha_reclamo).getTime()
      ),
    }))

    return NextResponse.json(garantiasFormatted)
  } catch (error) {
    console.error("Error fetching garantias:", error)
    return NextResponse.json(
      { error: "Error al obtener garantías" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden crear garantías" },
        { status: 403 }
      )
    }

    const body = await request.json()
    const data = garantiaSchema.parse(body)

    // Verificar que la orden existe, está entregada y pertenece a la org
    const { data: orden, error: ordenError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select(`
        id,
        estado,
        numero_orden,
        dispositivo,
        organization_id,
        clientes (*),
        organizations (id, nombre, moneda, zona_horaria),
        garantias (id)
      `)
      .eq("id", data.ordenId)
      .eq("organization_id", organizationId!)
      .single()

    if (ordenError || !orden) {
      return NextResponse.json(
        { error: "Orden no encontrada" },
        { status: 404 }
      )
    }

    if (orden.estado !== "ENTREGADO") {
      return NextResponse.json(
        { error: "Solo se puede crear garantía para órdenes entregadas" },
        { status: 400 }
      )
    }

    if (orden.garantias && orden.garantias.length > 0) {
      return NextResponse.json(
        { error: "Esta orden ya tiene una garantía registrada" },
        { status: 400 }
      )
    }

    // Calcular fechas
    const fechaInicio = new Date()
    const fechaVencimiento = new Date()
    fechaVencimiento.setDate(fechaVencimiento.getDate() + data.diasValidez)

    const { data: garantia, error: createError } = await supabaseAdmin
      .from("garantias")
      .insert({
        orden_id: data.ordenId,
        dias_validez: data.diasValidez,
        fecha_inicio: fechaInicio.toISOString(),
        fecha_vencimiento: fechaVencimiento.toISOString(),
        notas: data.notas || null,
      })
      .select()
      .single()

    if (createError) {
      throw createError
    }

    // Enviar notificación via Inngest
    const cliente = orden.clientes as any
    const org = orden.organizations as any

    queueNotification({
      organizationId: organizationId!,
      ordenId: data.ordenId,
      garantiaId: garantia.id,
      clienteId: cliente.id,
      tipo: "GARANTIA_CREADA",
      context: {
        organizationName: org.nombre,
        moneda: org.moneda || "ARS",
        zonaHoraria: org.zona_horaria || "America/Argentina/Buenos_Aires",
        cliente: {
          id: cliente.id,
          nombre: cliente.nombre,
          email: cliente.email,
          telefono: cliente.telefono,
        },
        orden: {
          id: orden.id,
          numeroOrden: orden.numero_orden,
          dispositivo: orden.dispositivo,
          estado: orden.estado,
        },
        garantia: {
          id: garantia.id,
          diasValidez: garantia.dias_validez,
          fechaVencimiento: garantia.fecha_vencimiento,
        },
      },
    }).catch(err => console.error("Error queueing notification:", err))

    return NextResponse.json({
      id: garantia.id,
      ordenId: garantia.orden_id,
      diasValidez: garantia.dias_validez,
      fechaInicio: garantia.fecha_inicio,
      fechaVencimiento: garantia.fecha_vencimiento,
      estado: garantia.estado,
      notas: garantia.notas,
      orden: {
        id: orden.id,
        numeroOrden: orden.numero_orden,
        dispositivo: orden.dispositivo,
        cliente: cliente,
      },
    }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error creating garantia:", error)
    return NextResponse.json(
      { error: "Error al crear garantía" },
      { status: 500 }
    )
  }
}
