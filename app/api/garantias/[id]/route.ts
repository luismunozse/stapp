import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const updateGarantiaSchema = z.object({
  estado: z.enum(["ACTIVA", "VENCIDA", "RECLAMADA"]).optional(),
  notas: z.string().optional(),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params

    const { data: garantia, error: dbError } = await supabaseAdmin
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
      .eq("id", id)
      .eq("ordenes_servicio.organization_id", organizationId!)
      .single()

    if (dbError || !garantia) {
      return NextResponse.json(
        { error: "Garantía no encontrada" },
        { status: 404 }
      )
    }

    // Actualizar si está vencida
    const hoy = new Date()
    if (garantia.estado === "ACTIVA" && new Date(garantia.fecha_vencimiento) < hoy) {
      await supabaseAdmin
        .from("garantias")
        .update({ estado: "VENCIDA" })
        .eq("id", id)
      garantia.estado = "VENCIDA"
    }

    return NextResponse.json({
      id: garantia.id,
      ordenId: garantia.orden_id,
      diasValidez: garantia.dias_validez,
      fechaInicio: garantia.fecha_inicio,
      fechaVencimiento: garantia.fecha_vencimiento,
      estado: garantia.estado,
      notas: garantia.notas,
      createdAt: garantia.created_at,
      orden: {
        id: garantia.ordenes_servicio.id,
        numeroOrden: garantia.ordenes_servicio.numero_orden,
        dispositivo: garantia.ordenes_servicio.dispositivo,
        cliente: garantia.ordenes_servicio.clientes,
      },
      reclamos: garantia.reclamos_garantia?.sort((a: any, b: any) =>
        new Date(b.fecha_reclamo).getTime() - new Date(a.fecha_reclamo).getTime()
      ),
    })
  } catch (error) {
    console.error("Error fetching garantia:", error)
    return NextResponse.json(
      { error: "Error al obtener garantía" },
      { status: 500 }
    )
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
      return NextResponse.json(
        { error: "Solo administradores pueden modificar garantías" },
        { status: 403 }
      )
    }

    const { id } = await params
    const body = await request.json()
    const data = updateGarantiaSchema.parse(body)

    // Verificar que la garantía existe y pertenece a la org
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("garantias")
      .select("id, ordenes_servicio!inner(organization_id)")
      .eq("id", id)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json(
        { error: "Garantía no encontrada" },
        { status: 404 }
      )
    }

    const ordenOrgId = (existing.ordenes_servicio as any)?.organization_id
    if (ordenOrgId !== organizationId) {
      return NextResponse.json(
        { error: "No autorizado" },
        { status: 403 }
      )
    }

    const updateData: Record<string, any> = {}
    if (data.estado !== undefined) updateData.estado = data.estado
    if (data.notas !== undefined) updateData.notas = data.notas

    const { data: garantia, error: updateError } = await supabaseAdmin
      .from("garantias")
      .update(updateData)
      .eq("id", id)
      .select(`
        *,
        ordenes_servicio (
          id,
          numero_orden,
          dispositivo,
          clientes (*)
        ),
        reclamos_garantia (*)
      `)
      .single()

    if (updateError) {
      throw updateError
    }

    return NextResponse.json({
      id: garantia.id,
      ordenId: garantia.orden_id,
      diasValidez: garantia.dias_validez,
      fechaInicio: garantia.fecha_inicio,
      fechaVencimiento: garantia.fecha_vencimiento,
      estado: garantia.estado,
      notas: garantia.notas,
      orden: {
        id: garantia.ordenes_servicio.id,
        numeroOrden: garantia.ordenes_servicio.numero_orden,
        dispositivo: garantia.ordenes_servicio.dispositivo,
        cliente: garantia.ordenes_servicio.clientes,
      },
      reclamos: garantia.reclamos_garantia,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error updating garantia:", error)
    return NextResponse.json(
      { error: "Error al actualizar garantía" },
      { status: 500 }
    )
  }
}
