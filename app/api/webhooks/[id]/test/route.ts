import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { dispatch } from "@/lib/webhooks/dispatcher"

// Test ping: crea una delivery del evento "webhook.test" para ESTE webhook
// (sin importar a qué eventos esté suscripto) y la despacha sincrónicamente.
// Devuelve el resultado para feedback inmediato en la UI.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params

    const { data: wh, error: whErr } = await supabaseAdmin
      .from("webhooks")
      .select("id, activo, deleted_at")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (whErr || !wh || wh.deleted_at) {
      return NextResponse.json({ error: "Webhook no encontrado" }, { status: 404 })
    }

    if (!wh.activo) {
      return NextResponse.json(
        { error: "El webhook está desactivado. Activalo antes de probar." },
        { status: 400 },
      )
    }

    const payload = {
      message: "Test ping",
      at: new Date().toISOString(),
    }

    const { data: delivery, error: insErr } = await supabaseAdmin
      .from("webhook_deliveries")
      .insert({
        webhook_id: id,
        organization_id: organizationId!,
        event: "webhook.test",
        payload,
        status: "PENDING",
      })
      .select("id")
      .single()

    if (insErr || !delivery) throw insErr

    // Sincrónico: caller espera el resultado para mostrar éxito/fallo.
    const result = await dispatch(delivery.id)

    return NextResponse.json({
      deliveryId: delivery.id,
      ok: result.ok,
      httpStatus: result.httpStatus,
      responseBody: result.body,
    })
  } catch (err) {
    console.error("Error testing webhook:", err)
    return NextResponse.json({ error: "Error al probar webhook" }, { status: 500 })
  }
}
