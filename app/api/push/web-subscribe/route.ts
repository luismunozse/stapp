import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// Web Push subscription registration. Native push lives at /api/push-token.
//
// POST { endpoint, p256dh, auth, userAgent? } — upsert by endpoint.
// DELETE { endpoint } — mark inactive (keeps row for analytics, drops sends).

interface SubscribeBody {
  endpoint?: unknown
  p256dh?: unknown
  auth?: unknown
  userAgent?: unknown
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function POST(request: Request) {
  const { error, organizationId, userId } = await requireAuth()
  if (error) return error

  let body: SubscribeBody
  try {
    body = await request.json()
  } catch {
    return badRequest("Body inválido")
  }

  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : ""
  const p256dh = typeof body.p256dh === "string" ? body.p256dh.trim() : ""
  const auth = typeof body.auth === "string" ? body.auth.trim() : ""
  const userAgent =
    typeof body.userAgent === "string" ? body.userAgent.slice(0, 500) : null

  if (!endpoint || !endpoint.startsWith("https://")) return badRequest("endpoint inválido")
  if (!p256dh) return badRequest("p256dh requerido")
  if (!auth) return badRequest("auth requerido")

  const { error: dbError } = await supabaseAdmin
    .from("web_push_subscriptions")
    .upsert(
      {
        user_id: userId!,
        organization_id: organizationId!,
        endpoint,
        p256dh,
        auth,
        user_agent: userAgent,
        active: true,
        failure_count: 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" }
    )

  if (dbError) {
    console.error("[push/web-subscribe] DB error:", dbError)
    return NextResponse.json({ error: "Error guardando subscription" }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(request: Request) {
  const { error, userId } = await requireAuth()
  if (error) return error

  let body: { endpoint?: unknown }
  try {
    body = await request.json()
  } catch {
    return badRequest("Body inválido")
  }
  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : ""
  if (!endpoint) return badRequest("endpoint requerido")

  const { error: dbError } = await supabaseAdmin
    .from("web_push_subscriptions")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("user_id", userId!)
    .eq("endpoint", endpoint)

  if (dbError) {
    console.error("[push/web-subscribe] DB error:", dbError)
    return NextResponse.json({ error: "Error desactivando subscription" }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
