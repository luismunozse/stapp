import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"
import { createSuperadminAuditLogger } from "@/lib/superadmin-audit"

const bulkActionSchema = z.object({
  action: z.enum(["extend_trial", "activate", "cancel"]),
  organizationIds: z.array(z.string()).min(1, "Selecciona al menos una organización"),
  // Para extend_trial
  dias: z.number().int().min(1).max(90).optional(),
  motivo: z.string().max(500).optional(),
  // Para activate
  billingPeriod: z.enum(["MONTHLY", "YEARLY"]).optional(),
  // Para cancel
  immediate: z.boolean().optional(),
})

export async function POST(request: Request) {
  try {
    const { error, email } = await requireSuperadmin()
    if (error) return error

    const parsed = await safeParseBody(request, bulkActionSchema)
    if ("error" in parsed) return parsed.error

    const { action, organizationIds, dias, motivo, billingPeriod, immediate } = parsed.data
    let successCount = 0
    let errorCount = 0

    if (action === "extend_trial") {
      if (!dias) {
        return NextResponse.json({ error: "dias es requerido para extend_trial" }, { status: 400 })
      }

      for (const orgId of organizationIds) {
        const { data: sub } = await supabaseAdmin
          .from("subscriptions")
          .select("id, trial_end, status")
          .eq("organization_id", orgId)
          .single()

        if (!sub) { errorCount++; continue }

        const baseDate = sub.trial_end ? new Date(sub.trial_end) : new Date()
        const newTrialEnd = new Date(baseDate)
        newTrialEnd.setDate(newTrialEnd.getDate() + dias)

        const { error: updateError } = await supabaseAdmin
          .from("subscriptions")
          .update({ status: "TRIALING", trial_end: newTrialEnd.toISOString() })
          .eq("id", sub.id)

        if (updateError) { errorCount++; continue }

        await supabaseAdmin.from("trial_extensions").insert({
          organization_id: orgId,
          dias_extendidos: dias,
          nueva_fecha_fin: newTrialEnd.toISOString(),
          motivo: motivo || "Extensión masiva",
          extendido_por: email || "superadmin",
        })

        await supabaseAdmin.from("subscription_history").insert({
          subscription_id: sub.id,
          organization_id: orgId,
          action: "TRIAL_EXTENDED",
          previous_status: sub.status,
          new_status: "TRIALING",
          details: { dias, motivo, bulk: true },
          performed_by: email,
        })

        successCount++
      }
    }

    if (action === "activate") {
      const period = billingPeriod || "MONTHLY"

      // Buscar por slug (default: profesional), con fallback a cualquier PREMIUM
      let { data: premiumPlan } = await supabaseAdmin
        .from("plans")
        .select("id")
        .eq("slug", "profesional")
        .eq("activo", true)
        .maybeSingle()

      if (!premiumPlan) {
        const { data: fallbackPlan } = await supabaseAdmin
          .from("plans")
          .select("id")
          .eq("tipo", "PREMIUM")
          .eq("activo", true)
          .order("tier_order", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle()
        premiumPlan = fallbackPlan
      }

      if (!premiumPlan) {
        return NextResponse.json({ error: "No se encontró plan Premium activo" }, { status: 404 })
      }

      const now = new Date()
      const periodEnd = new Date(now)
      if (period === "YEARLY") periodEnd.setFullYear(periodEnd.getFullYear() + 1)
      else periodEnd.setMonth(periodEnd.getMonth() + 1)

      for (const orgId of organizationIds) {
        const { data: sub } = await supabaseAdmin
          .from("subscriptions")
          .select("id, status")
          .eq("organization_id", orgId)
          .single()

        if (!sub) { errorCount++; continue }

        const { error: updateError } = await supabaseAdmin
          .from("subscriptions")
          .update({
            plan_id: premiumPlan.id,
            status: "ACTIVE",
            billing_period: period,
            payment_provider: "MANUAL",
            current_period_start: now.toISOString(),
            current_period_end: periodEnd.toISOString(),
            cancel_at_period_end: false,
            canceled_at: null,
            trial_end: null,
          })
          .eq("id", sub.id)

        if (updateError) { errorCount++; continue }

        await supabaseAdmin.from("subscription_history").insert({
          subscription_id: sub.id,
          organization_id: orgId,
          action: "ACTIVATED",
          previous_status: sub.status,
          new_status: "ACTIVE",
          details: { billingPeriod: period, periodEnd: periodEnd.toISOString(), bulk: true },
          performed_by: email,
        })

        successCount++
      }
    }

    if (action === "cancel") {
      const now = new Date().toISOString()

      for (const orgId of organizationIds) {
        const { data: sub } = await supabaseAdmin
          .from("subscriptions")
          .select("id, status, current_period_end")
          .eq("organization_id", orgId)
          .single()

        if (!sub || sub.status === "CANCELED") { errorCount++; continue }

        if (immediate) {
          await supabaseAdmin
            .from("subscriptions")
            .update({ status: "CANCELED", canceled_at: now, cancel_at_period_end: false })
            .eq("id", sub.id)
        } else {
          await supabaseAdmin
            .from("subscriptions")
            .update({ cancel_at_period_end: true, canceled_at: now })
            .eq("id", sub.id)
        }

        await supabaseAdmin.from("subscription_history").insert({
          subscription_id: sub.id,
          organization_id: orgId,
          action: "CANCELED",
          previous_status: sub.status,
          new_status: immediate ? "CANCELED" : sub.status,
          details: { immediate, bulk: true },
          performed_by: email,
        })

        successCount++
      }
    }

    // Audit log
    const auditLogger = createSuperadminAuditLogger(email, request)
    auditLogger
      .log({
        action: "BULK_ACTION",
        entity: "subscriptions",
        description: `Acción masiva "${action}": ${successCount} exitosas, ${errorCount} errores`,
        metadata: { action, successCount, errorCount, totalRequested: organizationIds.length },
      })
      .catch(() => {})

    return NextResponse.json({
      success: true,
      message: `${successCount} operaciones exitosas${errorCount > 0 ? `, ${errorCount} errores` : ""}`,
      successCount,
      errorCount,
    })
  } catch (err) {
    console.error("Error in bulk subscription action:", err)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
