import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { createAuditLogger, diffObjects } from "@/lib/audit"
import { queueNotification } from "@/lib/inngest"
import { z } from "zod"

const entregarSchema = z.object({
  firmaClienteEntrega: z.string().min(1, "Firma del cliente requerida"),
  firmaClienteMime: z.string().min(1, "Tipo de firma del cliente requerido"),
  firmaEncargadoEntrega: z.string().min(1, "Firma del encargado requerida"),
  firmaEncargadoMime: z.string().min(1, "Tipo de firma del encargado requerido"),
  notasEntrega: z.string().optional().nullable(),
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
    if (orden.estado === "ENTREGADO" || orden.estado === "ENTREGADO_SIN_REPARACION") {
      return NextResponse.json({ error: "La orden ya fue entregada" }, { status: 400 })
    }

    // Solo se puede entregar desde REPARADO o SIN_REPARACION (retiro)
    if (orden.estado !== "REPARADO" && orden.estado !== "SIN_REPARACION") {
      return NextResponse.json(
        { error: `No se puede entregar una orden en estado "${orden.estado}". Debe estar en estado "REPARADO" o "SIN_REPARACION".` },
        { status: 400 }
      )
    }

    const esRetiro = orden.estado === "SIN_REPARACION"
    const nuevoEstado = esRetiro ? "ENTREGADO_SIN_REPARACION" : "ENTREGADO"

    // Actualizar orden con datos de entrega
    const { data: updatedOrden, error: updateError } = await supabaseAdmin
      .from("ordenes_servicio")
      .update({
        estado: nuevoEstado,
        fecha_entrega: new Date().toISOString(),
        firma_cliente_entrega: data.firmaClienteEntrega,
        firma_cliente_entrega_mime: data.firmaClienteMime,
        firma_encargado_entrega: data.firmaEncargadoEntrega,
        firma_encargado_entrega_mime: data.firmaEncargadoMime,
        entregado_por_user_id: userId,
        notas_entrega: data.notasEntrega,
      })
      .eq("id", id)
      .select(`*, clientes(*), users:entregado_por_user_id(id, nombre, email)`)
      .single()

    if (updateError) throw updateError

    // Registrar auditoría
    const audit = createAuditLogger(organizationId!, userId!, request)
    const changes = diffObjects(orden, updatedOrden)
    await audit.update("ordenes_servicio", id, changes.before, changes.after)

    // Obtener datos de organización para notificación
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("nombre, moneda, zona_horaria")
      .eq("id", organizationId!)
      .single()

    // Encolar notificación de entrega
    const cliente = orden.clientes as any
    if (cliente) {
      queueNotification({
        organizationId: organizationId!,
        ordenId: id,
        clienteId: cliente.id,
        tipo: "CAMBIO_ESTADO",
        context: {
          organizationName: org?.nombre || "",
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
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    console.error("Error registering delivery:", error)
    return NextResponse.json({ error: "Error al registrar entrega" }, { status: 500 })
  }
}
