import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

function formatDelivery(row: any) {
  return {
    id: row.id,
    webhookId: row.webhook_id,
    event: row.event,
    payload: row.payload,
    status: row.status,
    httpStatus: row.http_status,
    responseBody: row.response_body,
    attempts: row.attempts,
    lastAttemptAt: row.last_attempt_at,
    nextRetryAt: row.next_retry_at,
    createdAt: row.created_at,
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const url = new URL(request.url)
    const status = url.searchParams.get("status")
    // Cap a 200 — UI no necesita más por página y evita payloads gigantes.
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200)

    // Verificar pertenencia del webhook (defensa en profundidad sobre RLS).
    const { data: wh, error: whErr } = await supabaseAdmin
      .from("webhooks")
      .select("id")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (whErr || !wh) {
      return NextResponse.json({ error: "Webhook no encontrado" }, { status: 404 })
    }

    let query = supabaseAdmin
      .from("webhook_deliveries")
      .select("*")
      .eq("webhook_id", id)
      .eq("organization_id", organizationId!)
      .order("created_at", { ascending: false })
      .limit(limit)

    if (status && ["PENDING", "SUCCESS", "FAILED"].includes(status)) {
      query = query.eq("status", status)
    }

    const { data, error: dbErr } = await query
    if (dbErr) throw dbErr

    return NextResponse.json({ data: (data || []).map(formatDelivery) })
  } catch (err) {
    console.error("Error fetching deliveries:", err)
    return NextResponse.json({ error: "Error al obtener entregas" }, { status: 500 })
  }
}
