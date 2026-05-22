import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { requireCronAuth } from "@/lib/cron-auth"

// Cron diario: barre subscriptions ACTIVE con current_period_end vencido.
//   - MANUAL  → downgrade plan a Free (admin no renovó → asumimos churn)
//   - MERCADOPAGO/REBILL → status PAST_DUE (esperamos resolución webhook)
//
// Sin este sweep, las subs MANUAL quedan "Activa" perpetua porque ningún
// webhook las mueve. El read-time guard en hasValidAccess() ya hace lo
// mismo cuando la org entra, pero orgs inactivas nunca se actualizan.

export const maxDuration = 60

type Sub = {
  id: string
  organization_id: string
  plan_id: string
  payment_provider: string | null
  current_period_end: string | null
  organizations: { slug: string } | { slug: string }[] | null
}

export async function GET(request: Request) {
  const authError = requireCronAuth(request)
  if (authError) return authError

  try {
    const nowIso = new Date().toISOString()
    const results = { downgradedManual: 0, markedPastDue: 0, skipped: 0, failed: 0 }

    const { data: freePlan, error: planErr } = await supabaseAdmin
      .from("plans")
      .select("id")
      .eq("slug", "free")
      .eq("activo", true)
      .maybeSingle()

    if (planErr || !freePlan) {
      return NextResponse.json(
        { error: "Plan Free no encontrado", planErr },
        { status: 500 }
      )
    }

    const { data: expired, error: selErr } = await supabaseAdmin
      .from("subscriptions")
      .select(`
        id, organization_id, plan_id, payment_provider, current_period_end,
        organizations!inner ( slug ),
        plans!inner ( tipo )
      `)
      .eq("status", "ACTIVE")
      .eq("plans.tipo", "PREMIUM")
      .not("current_period_end", "is", null)
      .lte("current_period_end", nowIso)
      .neq("organizations.slug", "superadmin")

    if (selErr) {
      console.error("[subscription-sweep] select error:", selErr)
      return NextResponse.json({ error: "Error consultando subs" }, { status: 500 })
    }

    const list = (expired || []) as Sub[]

    for (const sub of list) {
      const slug = Array.isArray(sub.organizations)
        ? sub.organizations[0]?.slug
        : sub.organizations?.slug

      if (sub.payment_provider === "MANUAL") {
        const { error: upErr } = await supabaseAdmin
          .from("subscriptions")
          .update({
            plan_id: freePlan.id,
            payment_provider: null,
            current_period_end: null,
            billing_period: null,
            updated_at: nowIso,
          })
          .eq("id", sub.id)

        if (upErr) {
          console.error(`[subscription-sweep] FAIL downgrade ${slug}:`, upErr.message)
          results.failed++
          continue
        }

        await supabaseAdmin.from("subscription_history").insert({
          subscription_id: sub.id,
          organization_id: sub.organization_id,
          action: "DOWNGRADED",
          previous_status: "ACTIVE",
          new_status: "ACTIVE",
          details: {
            reason: "cron_sweep_expired_manual",
            previous_plan_id: sub.plan_id,
            new_plan_id: freePlan.id,
            expired_at: sub.current_period_end,
          },
          performed_by: "system:cron",
        })

        results.downgradedManual++
      } else if (
        sub.payment_provider === "MERCADOPAGO" ||
        sub.payment_provider === "REBILL"
      ) {
        const { error: upErr } = await supabaseAdmin
          .from("subscriptions")
          .update({ status: "PAST_DUE", updated_at: nowIso })
          .eq("id", sub.id)

        if (upErr) {
          console.error(`[subscription-sweep] FAIL past_due ${slug}:`, upErr.message)
          results.failed++
          continue
        }

        await supabaseAdmin.from("subscription_history").insert({
          subscription_id: sub.id,
          organization_id: sub.organization_id,
          action: "MARKED_PAST_DUE",
          previous_status: "ACTIVE",
          new_status: "PAST_DUE",
          details: {
            reason: "cron_sweep_expired_external",
            payment_provider: sub.payment_provider,
            expired_at: sub.current_period_end,
          },
          performed_by: "system:cron",
        })

        results.markedPastDue++
      } else {
        results.skipped++
      }
    }

    return NextResponse.json({
      success: true,
      results,
      total: list.length,
      timestamp: nowIso,
    })
  } catch (error) {
    console.error("[subscription-sweep] error:", error)
    return NextResponse.json({ error: "Error en sweep" }, { status: 500 })
  }
}
