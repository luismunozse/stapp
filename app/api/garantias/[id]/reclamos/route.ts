import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { getNextOrderNumber } from "@/lib/counters"
import { z } from "zod"

const reclamoSchema = z.object({
  descripcion: z.string().min(1, "Descripción requerida"),
  crearOrden: z.boolean().default(false),
})

const updateReclamoSchema = z.object({
  estado: z.enum(["PENDIENTE", "EN_REVISION", "ACEPTADO", "RECHAZADO", "RESUELTO"]),
  resolucion: z.string().optional(),
  crearOrden: z.boolean().optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id: garantiaId } = await params
    const body = await request.json()
    const data = reclamoSchema.parse(body)

    // Verificar que la garantía existe
    const { data: garantia, error: garantiaError } = await supabaseAdmin
      .from("garantias")
      .select(`*, ordenes_servicio!inner(organization_id)`)
      .eq("id", garantiaId)
      .single()

    if (garantiaError || !garantia) {
      return NextResponse.json({ error: "Garantía no encontrada" }, { status: 404 })
    }

    const ordenOrgId = (garantia.ordenes_servicio as any)?.organization_id
    if (ordenOrgId !== organizationId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }

    // Verificar si la garantía está vencida
    const hoy = new Date()
    if (new Date(garantia.fecha_vencimiento) < hoy) {
      return NextResponse.json({ error: "La garantía ha vencido" }, { status: 400 })
    }

    if (garantia.estado === "VENCIDA") {
      return NextResponse.json({ error: "No se pueden crear reclamos en garantías vencidas" }, { status: 400 })
    }

    // Crear el reclamo
    const { data: reclamo, error: reclamoError } = await supabaseAdmin
      .from("reclamos_garantia")
      .insert({
        garantia_id: garantiaId,
        descripcion: data.descripcion,
      })
      .select()
      .single()

    if (reclamoError) throw reclamoError

    // Actualizar estado de la garantía a RECLAMADA
    await supabaseAdmin
      .from("garantias")
      .update({ estado: "RECLAMADA" })
      .eq("id", garantiaId)

    return NextResponse.json(reclamo, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    console.error("Error creating reclamo:", error)
    return NextResponse.json({ error: "Error al crear reclamo" }, { status: 500 })
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json({ error: "Solo administradores pueden actualizar reclamos" }, { status: 403 })
    }

    const { id: garantiaId } = await params
    const { searchParams } = new URL(request.url)
    const reclamoId = searchParams.get("reclamoId")

    if (!reclamoId) {
      return NextResponse.json({ error: "ID de reclamo requerido" }, { status: 400 })
    }

    const body = await request.json()
    const data = updateReclamoSchema.parse(body)

    // Obtener el reclamo con datos de la garantía y orden
    const { data: reclamo, error: reclamoError } = await supabaseAdmin
      .from("reclamos_garantia")
      .select(`
        *,
        garantias (
          *,
          ordenes_servicio (
            id, organization_id, cliente_id, dispositivo, tipo_dispositivo, numero_orden
          )
        )
      `)
      .eq("id", reclamoId)
      .single()

    if (reclamoError || !reclamo) {
      return NextResponse.json({ error: "Reclamo no encontrado" }, { status: 404 })
    }

    let ordenReparacionId = reclamo.orden_reparacion_id

    // Si se acepta el reclamo y se solicita crear orden
    if (data.estado === "ACEPTADO" && data.crearOrden) {
      const orgId = reclamo.garantias.ordenes_servicio.organization_id

      // Obtener número de orden atómico
      const nuevoNumeroOrden = await getNextOrderNumber(orgId)

      // Crear nueva orden de reparación vinculada
      const { data: nuevaOrden, error: ordenError } = await supabaseAdmin
        .from("ordenes_servicio")
        .insert({
          numero_orden: nuevoNumeroOrden,
          organization_id: orgId,
          cliente_id: reclamo.garantias.ordenes_servicio.cliente_id,
          dispositivo: reclamo.garantias.ordenes_servicio.dispositivo,
          tipo_dispositivo: reclamo.garantias.ordenes_servicio.tipo_dispositivo,
          problema_reportado: `[RECLAMO GARANTÍA] ${reclamo.descripcion}`,
          observaciones: `Reclamo de garantía de la orden #${reclamo.garantias.ordenes_servicio.numero_orden}`,
        })
        .select()
        .single()

      if (ordenError) throw ordenError
      ordenReparacionId = nuevaOrden.id
    }

    // Actualizar el reclamo
    const { data: updatedReclamo, error: updateError } = await supabaseAdmin
      .from("reclamos_garantia")
      .update({
        estado: data.estado,
        resolucion: data.resolucion || null,
        orden_reparacion_id: ordenReparacionId,
        fecha_resolucion: ["RESUELTO", "RECHAZADO"].includes(data.estado) ? new Date().toISOString() : null,
      })
      .eq("id", reclamoId)
      .select()
      .single()

    if (updateError) throw updateError

    // Si el reclamo se resuelve o rechaza, verificar si hay más reclamos activos
    if (["RESUELTO", "RECHAZADO"].includes(data.estado)) {
      const { count } = await supabaseAdmin
        .from("reclamos_garantia")
        .select("id", { count: "exact", head: true })
        .eq("garantia_id", garantiaId)
        .in("estado", ["PENDIENTE", "EN_REVISION", "ACEPTADO"])

      if (count === 0) {
        // Verificar si la garantía aún es válida
        const { data: garantia } = await supabaseAdmin
          .from("garantias")
          .select("fecha_vencimiento")
          .eq("id", garantiaId)
          .single()

        if (garantia && new Date(garantia.fecha_vencimiento) >= new Date()) {
          await supabaseAdmin.from("garantias").update({ estado: "ACTIVA" }).eq("id", garantiaId)
        } else {
          await supabaseAdmin.from("garantias").update({ estado: "VENCIDA" }).eq("id", garantiaId)
        }
      }
    }

    return NextResponse.json(updatedReclamo)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    console.error("Error updating reclamo:", error)
    return NextResponse.json({ error: "Error al actualizar reclamo" }, { status: 500 })
  }
}
