import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { inngest } from "@/lib/inngest/client"
import { z } from "zod"
import { getOrderByPublicToken } from "@/lib/public-token"

const rejectSchema = z.object({
  motivo: z.string().max(500).optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const body = await request.json()
    const { motivo } = rejectSchema.parse(body)

    const { orden, error } = await getOrderByPublicToken(token, `
        id, estado, presupuesto, organization_id, cliente_id,
        numero_orden, dispositivo,
        clientes (id, nombre, email, telefono),
        organizations (nombre, nombre_mostrar)
      `)
    if (error) return error

    if (orden.estado !== "PRESUPUESTADO") {
      return NextResponse.json(
        { error: "La orden no está en estado de presupuesto pendiente" },
        { status: 400 }
      )
    }

    // Revertir orden a EN_DIAGNOSTICO y limpiar presupuesto
    const { error: updateError } = await supabaseAdmin
      .from("ordenes_servicio")
      .update({
        estado: "EN_DIAGNOSTICO",
        presupuesto: null,
        costo_final: null,
        presupuesto_aprobado_portal: false,
        presupuesto_firma_url: null,
        presupuesto_firma_path: null,
        presupuesto_fecha_aprobacion: null,
      })
      .eq("id", orden.id)

    if (updateError) throw updateError

    // Si hay cotizaciones ENVIADA vinculadas, marcarlas como RECHAZADA
    await supabaseAdmin
      .from("cotizaciones")
      .update({ estado: "RECHAZADA" })
      .eq("orden_id", orden.id)
      .eq("estado", "ENVIADA")

    // Registrar evento
    await supabaseAdmin.from("orden_eventos").insert({
      orden_id: orden.id,
      organization_id: orden.organization_id,
      tipo: "PRESUPUESTO_RECHAZADO",
      estado_anterior: "PRESUPUESTADO",
      estado_nuevo: "EN_DIAGNOSTICO",
      descripcion: motivo
        ? `Presupuesto rechazado por el cliente: ${motivo}`
        : "Presupuesto rechazado por el cliente desde el portal público",
      metadata: { rechazadoDesdePortal: true, motivo: motivo || null },
    })

    // Notificar al taller
    const org = orden.organizations as unknown as Record<string, unknown>
    const cliente = orden.clientes as unknown as Record<string, unknown>

    inngest.send({
      name: "notification/send",
      data: {
        organizationId: orden.organization_id,
        ordenId: orden.id,
        clienteId: orden.cliente_id,
        tipo: "CAMBIO_ESTADO",
        context: {
          organizationName: (org?.nombre_mostrar as string) || (org?.nombre as string) || "",
          cliente: {
            id: cliente?.id as string,
            nombre: cliente?.nombre as string,
            email: cliente?.email as string | null,
            telefono: cliente?.telefono as string,
          },
          orden: {
            id: orden.id,
            numeroOrden: orden.numero_orden,
            dispositivo: orden.dispositivo,
            estado: "EN_DIAGNOSTICO",
            estadoAnterior: "PRESUPUESTADO",
            presupuesto: orden.presupuesto,
          },
        },
      },
    }).catch(err => console.error("Error sending notification:", err))

    return NextResponse.json({
      message: "Presupuesto rechazado",
      estado: "EN_DIAGNOSTICO",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error rejecting budget:", error)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
