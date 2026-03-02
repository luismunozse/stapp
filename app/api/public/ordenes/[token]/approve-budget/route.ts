import { NextResponse } from "next/server"
import { supabaseAdmin, STORAGE_BUCKETS } from "@/lib/supabase"
import { inngest } from "@/lib/inngest/client"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const body = await request.json()
    const { firma } = body // Base64 signature image

    // Obtener orden
    const { data: orden } = await supabaseAdmin
      .from("ordenes_servicio")
      .select(`
        id, estado, presupuesto, organization_id, cliente_id,
        numero_orden, dispositivo,
        clientes (id, nombre, email, telefono),
        organizations (nombre, nombre_mostrar)
      `)
      .eq("public_token", token)
      .single()

    if (!orden) {
      return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
    }

    // Solo se puede aprobar si está en estado PRESUPUESTADO
    if (orden.estado !== "PRESUPUESTADO") {
      return NextResponse.json(
        { error: "La orden no está en estado de presupuesto pendiente de aprobación" },
        { status: 400 }
      )
    }

    // Guardar firma si se proporcionó
    let firmaUrl: string | null = null
    let firmaPath: string | null = null

    if (firma) {
      const base64Data = firma.replace(/^data:image\/\w+;base64,/, "")
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
    }

    // Actualizar orden a APROBADO
    const { error: updateError } = await supabaseAdmin
      .from("ordenes_servicio")
      .update({
        estado: "APROBADO",
        presupuesto_aprobado_portal: true,
        presupuesto_firma_url: firmaUrl,
        presupuesto_firma_path: firmaPath,
        presupuesto_fecha_aprobacion: new Date().toISOString(),
      })
      .eq("id", orden.id)

    if (updateError) throw updateError

    // Registrar evento
    await supabaseAdmin.from("orden_eventos").insert({
      orden_id: orden.id,
      organization_id: orden.organization_id,
      tipo: "PRESUPUESTO_APROBADO",
      estado_anterior: "PRESUPUESTADO",
      estado_nuevo: "APROBADO",
      descripcion: "Presupuesto aprobado por el cliente desde el portal público",
      metadata: { aprobadoDesdePortal: true },
    })

    // Enviar notificación al taller
    const org = orden.organizations as unknown as Record<string, unknown>
    const cliente = orden.clientes as unknown as Record<string, unknown>

    await inngest.send({
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
            presupuesto: orden.presupuesto,
          },
        },
      },
    })

    return NextResponse.json({
      message: "Presupuesto aprobado exitosamente",
      estado: "APROBADO",
    })
  } catch (error) {
    console.error("Error approving budget:", error)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
