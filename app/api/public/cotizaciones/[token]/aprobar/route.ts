import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { inngest } from "@/lib/inngest/client"
import { z } from "zod"

const aprobarSchema = z.object({
  firmaAprobacion: z.string().min(1, "Firma requerida"),
  firmaMime: z.string().min(1, "Tipo de firma requerido"),
  nombreAprobador: z.string().optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    if (!token || token.length !== 32) {
      return NextResponse.json(
        { error: "Token invalido" },
        { status: 400 }
      )
    }

    const body = await request.json()
    const data = aprobarSchema.parse(body)

    // Find cotizacion by public token (include orden_id and total)
    const { data: cotizacion, error: fetchError } = await supabaseAdmin
      .from("cotizaciones")
      .select("id, estado, orden_id, total")
      .eq("public_token", token)
      .single()

    if (fetchError || !cotizacion) {
      return NextResponse.json(
        { error: "Cotizacion no encontrada" },
        { status: 404 }
      )
    }

    if (cotizacion.estado !== "ENVIADA") {
      return NextResponse.json(
        { error: "Solo se pueden aprobar cotizaciones enviadas" },
        { status: 400 }
      )
    }

    // Update cotizacion to ACEPTADA
    const { error: updateError } = await supabaseAdmin
      .from("cotizaciones")
      .update({
        estado: "ACEPTADA",
        firma_aprobacion: data.firmaAprobacion,
        firma_mime: data.firmaMime,
        fecha_aprobacion: new Date().toISOString(),
      })
      .eq("id", cotizacion.id)

    if (updateError) throw updateError

    // If cotizacion is linked to an order in PRESUPUESTADO, transition it to APROBADO
    if (cotizacion.orden_id) {
      const { data: orden } = await supabaseAdmin
        .from("ordenes_servicio")
        .select("id, estado, organization_id, cliente_id, numero_orden, dispositivo, clientes (id, nombre, email, telefono), organizations (nombre, nombre_mostrar)")
        .eq("id", cotizacion.orden_id)
        .single()

      if (orden && orden.estado === "PRESUPUESTADO") {
        await supabaseAdmin
          .from("ordenes_servicio")
          .update({
            estado: "APROBADO",
            presupuesto: cotizacion.total,
            costo_final: cotizacion.total,
            presupuesto_aprobado_portal: true,
            presupuesto_fecha_aprobacion: new Date().toISOString(),
          })
          .eq("id", orden.id)

        // Record event
        await supabaseAdmin.from("orden_eventos").insert({
          orden_id: orden.id,
          organization_id: orden.organization_id,
          tipo: "PRESUPUESTO_APROBADO",
          estado_anterior: "PRESUPUESTADO",
          estado_nuevo: "APROBADO",
          descripcion: "Cotizacion aprobada por el cliente desde el enlace de cotizacion",
          metadata: { aprobadoDesdePortal: true, cotizacionId: cotizacion.id },
        })

        // Send notification
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
                estado: "APROBADO",
                estadoAnterior: "PRESUPUESTADO",
                presupuesto: cotizacion.total,
              },
            },
          },
        }).catch(err => console.error("Error sending notification:", err))
      }
    }

    return NextResponse.json({
      message: "Cotizacion aprobada exitosamente",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error approving public cotizacion:", error)
    return NextResponse.json(
      { error: "Error al aprobar cotizacion" },
      { status: 500 }
    )
  }
}
