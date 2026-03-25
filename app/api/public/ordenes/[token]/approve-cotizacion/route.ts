import { NextResponse } from "next/server"
import { supabaseAdmin, STORAGE_BUCKETS } from "@/lib/supabase"
import { inngest } from "@/lib/inngest/client"
import { z } from "zod"
import { getOrderByPublicToken } from "@/lib/public-token"

const approveSchema = z.object({
  cotizacionId: z.string().uuid("ID de cotizacion invalido"),
  firmaAprobacion: z.string().min(1, "Firma requerida"),
  firmaMime: z.string().min(1, "Tipo de firma requerido"),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const body = await request.json()
    const data = approveSchema.parse(body)

    // Get order
    const { orden, error } = await getOrderByPublicToken(token, `
        id, estado, presupuesto, organization_id, cliente_id,
        numero_orden, dispositivo,
        clientes (id, nombre, email, telefono),
        organizations (nombre, nombre_mostrar)
      `)
    if (error) return error

    // Only allow approval if order is in PRESUPUESTADO state
    if (orden.estado !== "PRESUPUESTADO") {
      return NextResponse.json(
        { error: "La orden no esta en estado de presupuesto pendiente de aprobacion" },
        { status: 400 }
      )
    }

    // Verify cotizacion belongs to this order and is ENVIADA
    const { data: cotizacion, error: cotError } = await supabaseAdmin
      .from("cotizaciones")
      .select("id, estado, total, public_token")
      .eq("id", data.cotizacionId)
      .eq("orden_id", orden.id)
      .single()

    if (cotError || !cotizacion) {
      return NextResponse.json(
        { error: "Cotizacion no encontrada para esta orden" },
        { status: 404 }
      )
    }

    if (cotizacion.estado !== "ENVIADA") {
      return NextResponse.json(
        { error: "Solo se pueden aprobar cotizaciones en estado enviada" },
        { status: 400 }
      )
    }

    // Upload signature to storage
    let firmaUrl: string | null = null
    let firmaPath: string | null = null

    const base64Data = data.firmaAprobacion.replace(/^data:image\/\w+;base64,/, "")
    const buffer = Buffer.from(base64Data, "base64")
    const path = `${orden.organization_id}/presupuesto/${orden.id}/${crypto.randomUUID()}.png`

    const { error: uploadError } = await supabaseAdmin.storage
      .from(STORAGE_BUCKETS.FIRMAS)
      .upload(path, buffer, { contentType: "image/png" })

    if (!uploadError) {
      const { data: urlData } = supabaseAdmin.storage
        .from(STORAGE_BUCKETS.FIRMAS)
        .getPublicUrl(path)
      firmaUrl = urlData.publicUrl
      firmaPath = path
    }

    // Update cotizacion to ACEPTADA
    const { error: cotUpdateError } = await supabaseAdmin
      .from("cotizaciones")
      .update({
        estado: "ACEPTADA",
        firma_aprobacion: data.firmaAprobacion,
        firma_mime: data.firmaMime,
        fecha_aprobacion: new Date().toISOString(),
      })
      .eq("id", cotizacion.id)

    if (cotUpdateError) throw cotUpdateError

    // Update order to APROBADO and set presupuesto from cotizacion total
    const { error: updateError } = await supabaseAdmin
      .from("ordenes_servicio")
      .update({
        estado: "APROBADO",
        presupuesto: cotizacion.total,
        presupuesto_aprobado_portal: true,
        presupuesto_firma_url: firmaUrl,
        presupuesto_firma_path: firmaPath,
        presupuesto_fecha_aprobacion: new Date().toISOString(),
      })
      .eq("id", orden.id)

    if (updateError) throw updateError

    // Record event
    await supabaseAdmin.from("orden_eventos").insert({
      orden_id: orden.id,
      organization_id: orden.organization_id,
      tipo: "PRESUPUESTO_APROBADO",
      estado_anterior: "PRESUPUESTADO",
      estado_nuevo: "APROBADO",
      descripcion: "Cotizacion aprobada por el cliente desde el portal de seguimiento",
      metadata: { aprobadoDesdePortal: true, cotizacionId: cotizacion.id },
    })

    // Send notification (fire-and-forget)
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

    return NextResponse.json({
      message: "Cotizacion aprobada exitosamente",
      estado: "APROBADO",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error approving cotizacion:", error)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
