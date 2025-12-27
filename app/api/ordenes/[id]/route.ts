import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { createAuditLogger, diffObjects } from "@/lib/audit"
import { queueNotification } from "@/lib/inngest"
import { formatOrden } from "@/lib/db-utils"
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
      "CANCELADO",
      "SIN_REPARACION",
    ])
    .optional(),
  tecnicoId: z.string().optional().nullable(),
  presupuesto: z.number().optional().nullable(),
  costoFinal: z.number().optional().nullable(),
  fechaPrometida: z.string().optional().nullable(),
  observaciones: z.string().optional().nullable(),
  diagnostico: z.string().optional().nullable(),
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
        repuestos_orden (
          *,
          inventario (*)
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

    return NextResponse.json(formatOrden(orden))
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
        organizations (id, nombre)
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

    // Preparar datos para update
    const updateData: Record<string, any> = {}

    if (data.estado !== undefined) updateData.estado = data.estado
    if (data.tecnicoId !== undefined) updateData.tecnico_id = data.tecnicoId
    if (data.presupuesto !== undefined) updateData.presupuesto = data.presupuesto
    if (data.costoFinal !== undefined) updateData.costo_final = data.costoFinal
    if (data.observaciones !== undefined) updateData.observaciones = data.observaciones
    if (data.diagnostico !== undefined) updateData.diagnostico = data.diagnostico

    if (data.fechaPrometida !== undefined) {
      updateData.fecha_prometida = data.fechaPrometida
        ? new Date(data.fechaPrometida).toISOString()
        : null
    }

    if (data.estado === "REPARADO" && !orden.fecha_completado) {
      updateData.fecha_completado = new Date().toISOString()
    }

    const { data: updatedOrden, error: updateError } = await supabaseAdmin
      .from("ordenes_servicio")
      .update(updateData)
      .eq("id", id)
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

    // Auditoría
    const audit = createAuditLogger(organizationId!, userId!, request)
    const changes = diffObjects(orden, updatedOrden)
    await audit.update("ordenes_servicio", id, changes.before, changes.after)

    // Notificaciones via Inngest (background)
    const cliente = orden.clientes as any
    const org = orden.organizations as any

    // Notificación de cambio de estado
    if (data.estado && data.estado !== orden.estado) {
      queueNotification({
        organizationId: organizationId!,
        ordenId: id,
        clienteId: cliente.id,
        tipo: "CAMBIO_ESTADO",
        context: {
          organizationName: org.nombre,
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
            estado: data.estado,
            estadoAnterior: orden.estado,
          },
        },
      }).catch(err => console.error("Error queueing notification:", err))
    }

    // Notificación de presupuesto definido
    if (
      data.presupuesto !== undefined &&
      data.presupuesto !== null &&
      data.presupuesto !== orden.presupuesto
    ) {
      queueNotification({
        organizationId: organizationId!,
        ordenId: id,
        clienteId: cliente.id,
        tipo: "PRESUPUESTO_DEFINIDO",
        context: {
          organizationName: org.nombre,
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
