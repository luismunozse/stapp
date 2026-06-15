import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { createSuperadminAuditLogger } from "@/lib/superadmin-audit"
import { getSubscriptionInfo } from "@/lib/subscriptions"

// ── GET /api/superadmin/organizations/[id]/feature-overrides ──────────────────
// Returns:
//   { overrides: { feature_key: string; enabled: boolean }[]; featureKeys: string[] }
//
// featureKeys = union of the plan's featureFlags keys + any override keys,
// so the UI can list every toggleable feature even if the plan doesn't define it.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error: authError } = await requireSuperadmin()
    if (authError) return authError

    const { id } = await params

    // Fetch existing overrides for this org
    const { data: overrideRows, error: overrideError } = await supabaseAdmin
      .from("organization_feature_overrides")
      .select("feature_key, enabled")
      .eq("organization_id", id)

    if (overrideError) throw overrideError

    const overrides = (overrideRows ?? []) as { feature_key: string; enabled: boolean }[]

    // Fetch plan featureFlags to build the full key set + expose the plan-level
    // default per key so the UI can render the effective state and tell apart
    // "override" from "plan default".
    const subscription = await getSubscriptionInfo(id)
    const planFlags = (subscription?.featureFlags ?? {}) as Record<string, boolean>
    const planKeys = Object.keys(planFlags)
    const overrideKeys = overrides.map((r) => r.feature_key)
    const featureKeys = Array.from(new Set([...planKeys, ...overrideKeys])).sort()

    return NextResponse.json({ overrides, featureKeys, planFlags })
  } catch (err) {
    console.error("Error fetching feature overrides:", err)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}

// ── POST /api/superadmin/organizations/[id]/feature-overrides ─────────────────
// Body: { featureKey: string; enabled: boolean }
// Upserts the override and records an audit event.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error: authError, email } = await requireSuperadmin()
    if (authError) return authError

    const { id } = await params
    const body = await request.json()
    const { featureKey, enabled } = body

    if (typeof featureKey !== "string" || featureKey.trim() === "") {
      return NextResponse.json({ error: "featureKey es requerido" }, { status: 400 })
    }
    if (typeof enabled !== "boolean") {
      return NextResponse.json({ error: "enabled debe ser boolean" }, { status: 400 })
    }

    const { error: upsertError } = await supabaseAdmin
      .from("organization_feature_overrides")
      .upsert(
        {
          organization_id: id,
          feature_key: featureKey,
          enabled,
          created_by: email,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,feature_key" }
      )

    if (upsertError) throw upsertError

    const auditLogger = createSuperadminAuditLogger(email, request)
    auditLogger
      .log({
        action: "UPDATE",
        entity: "organizations",
        entityId: id,
        organizationId: id,
        description: `Feature override set: ${featureKey} = ${enabled}`,
        metadata: { featureKey, enabled, event: "FEATURE_OVERRIDE_SET" },
      })
      .catch(() => {})

    return NextResponse.json({
      success: true,
      message: `Feature "${featureKey}" establecida en ${enabled}`,
    })
  } catch (err) {
    console.error("Error setting feature override:", err)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}

// ── DELETE /api/superadmin/organizations/[id]/feature-overrides ───────────────
// Body: { featureKey: string }
// Removes the override row (reverts to plan default).

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error: authError, email } = await requireSuperadmin()
    if (authError) return authError

    const { id } = await params
    const body = await request.json()
    const { featureKey } = body

    if (typeof featureKey !== "string" || featureKey.trim() === "") {
      return NextResponse.json({ error: "featureKey es requerido" }, { status: 400 })
    }

    const { error: deleteError } = await supabaseAdmin
      .from("organization_feature_overrides")
      .delete()
      .eq("organization_id", id)
      .eq("feature_key", featureKey)

    if (deleteError) throw deleteError

    const auditLogger = createSuperadminAuditLogger(email, request)
    auditLogger
      .log({
        action: "DELETE",
        entity: "organizations",
        entityId: id,
        organizationId: id,
        description: `Feature override cleared: ${featureKey}`,
        metadata: { featureKey, event: "FEATURE_OVERRIDE_CLEAR" },
      })
      .catch(() => {})

    return NextResponse.json({
      success: true,
      message: `Override de "${featureKey}" eliminado — vuelve al valor del plan`,
    })
  } catch (err) {
    console.error("Error clearing feature override:", err)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
