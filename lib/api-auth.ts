import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { hashApiKey } from "@/lib/api-keys"
import { rateLimit } from "@/lib/rate-limit"
import { hasValidAccess } from "@/lib/subscriptions"

interface ApiKeyAuthResult {
  error: NextResponse | null
  organizationId: string | null
}

function unauthorized(message: string): ApiKeyAuthResult {
  return {
    error: NextResponse.json({ error: message, code: "UNAUTHORIZED" }, { status: 401 }),
    organizationId: null,
  }
}

function forbidden(message: string, code: string): ApiKeyAuthResult {
  return {
    error: NextResponse.json({ error: message, code }, { status: 403 }),
    organizationId: null,
  }
}

/**
 * Authenticates a public API v1 request via `Authorization: Bearer <key>`.
 * Returns `{ error, organizationId }` — same contract as requireAuth.
 */
export async function requireApiKey(request: Request): Promise<ApiKeyAuthResult> {
  const header = request.headers.get("authorization") || ""
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) return unauthorized("API key required (Authorization: Bearer <key>)")

  const raw = match[1].trim()
  const hash = hashApiKey(raw)

  const { data: key } = await supabaseAdmin
    .from("api_keys")
    .select("id, organization_id, activo, revoked_at")
    .eq("key_hash", hash)
    .maybeSingle()

  if (!key || key.activo === false || key.revoked_at) {
    return unauthorized("Invalid or revoked API key")
  }

  const rl = await rateLimit(`apikey:${hash.slice(0, 16)}`, 120, 60_000)
  if (!rl.success) {
    return {
      error: NextResponse.json(
        { error: "Too many requests", code: "RATE_LIMITED" },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil((rl.reset - Date.now()) / 1000)) },
        }
      ),
      organizationId: null,
    }
  }

  // La key sola no alcanza: la organización tiene que seguir activa y con una
  // suscripción vigente, igual que en el panel (app/(dashboard)/layout.tsx).
  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("id, activo, deleted_at")
    .eq("id", key.organization_id)
    .maybeSingle()

  if (!org || org.activo === false || org.deleted_at) {
    return forbidden("Organization inactive", "ORGANIZATION_INACTIVE")
  }

  const acceso = await hasValidAccess(key.organization_id)
  if (!acceso.hasAccess) {
    return forbidden("Subscription inactive", "SUBSCRIPTION_INACTIVE")
  }

  // best-effort last_used_at update — fire and forget
  supabaseAdmin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", key.id)
    .then(() => {}, () => {})

  return { error: null, organizationId: key.organization_id }
}
