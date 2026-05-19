import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { dispatch } from "@/lib/webhooks/dispatcher"

// Retry manual de una delivery FAILED. Verifica ownership por org antes de
// despachar — dispatch() no chequea organization_id (corre con service role).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params

    const { data: delivery, error: fetchErr } = await supabaseAdmin
      .from("webhook_deliveries")
      .select("id, organization_id, status")
      .eq("id", id)
      .single()

    if (fetchErr || !delivery || delivery.organization_id !== organizationId) {
      return NextResponse.json({ error: "Entrega no encontrada" }, { status: 404 })
    }

    if (delivery.status === "SUCCESS") {
      return NextResponse.json(
        { error: "La entrega ya fue exitosa." },
        { status: 400 },
      )
    }

    const result = await dispatch(id)

    return NextResponse.json({
      ok: result.ok,
      httpStatus: result.httpStatus,
      responseBody: result.body,
    })
  } catch (err) {
    console.error("Error retrying delivery:", err)
    return NextResponse.json({ error: "Error al reintentar" }, { status: 500 })
  }
}
