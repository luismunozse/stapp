import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"
import { createSuperadminAuditLogger } from "@/lib/superadmin-audit"
import { exceedsTrialCap, trialAdjustmentStatus } from "@/lib/trial"
import { cancelMercadoPagoPreapproval } from "@/lib/account-deletion/cancel-subscriptions"

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
    // Orgs que no se tocaron a propósito (no son errores): en "activate", las
    // que ya tienen un período pago vigente.
    let skippedCount = 0

    if (action === "extend_trial" && !dias) {
      return NextResponse.json({ error: "dias es requerido para extend_trial" }, { status: 400 })
    }

    // Auditoría fail-closed ANTES de tocar cualquier suscripción.
    const intento = await createSuperadminAuditLogger(email, request).exigir({
      action: "BULK_ACTION",
      entity: "subscriptions",
      description: `Acción masiva "${action}" sobre ${organizationIds.length} organización(es)`,
      metadata: { action, organizationIds, dias, motivo, billingPeriod, immediate, totalRequested: organizationIds.length },
    })
    if (!intento.ok) return intento.respuesta

    if (action === "extend_trial" && dias) {
      for (const orgId of organizationIds) {
        const { data: sub } = await supabaseAdmin
          .from("subscriptions")
          .select("id, trial_end, status")
          .eq("organization_id", orgId)
          .single()

        if (!sub) { errorCount++; continue }

        // Enforce the same cumulative cap as the single endpoint.
        const { data: exts } = await supabaseAdmin
          .from("trial_extensions")
          .select("dias_extendidos")
          .eq("organization_id", orgId)
        const existingSum = (exts ?? []).reduce((s, e) => s + (e.dias_extendidos || 0), 0)
        if (exceedsTrialCap(existingSum, dias)) { errorCount++; continue }

        const baseDate = sub.trial_end ? new Date(sub.trial_end) : new Date()
        const newTrialEnd = new Date(baseDate)
        newTrialEnd.setDate(newTrialEnd.getDate() + dias)

        // Never downgrade a paying/canceled sub by extending its trial.
        const nextStatus = trialAdjustmentStatus(sub.status)
        const { error: updateError } = await supabaseAdmin
          .from("subscriptions")
          .update({ status: nextStatus, trial_end: newTrialEnd.toISOString() })
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
          new_status: nextStatus,
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
        await intento.completar({ error: "sin plan Premium activo" }, "fallido")
        return NextResponse.json({ error: "No se encontró plan Premium activo" }, { status: 404 })
      }

      const now = new Date()
      const periodEnd = new Date(now)
      if (period === "YEARLY") periodEnd.setFullYear(periodEnd.getFullYear() + 1)
      else periodEnd.setMonth(periodEnd.getMonth() + 1)

      for (const orgId of organizationIds) {
        const { data: sub } = await supabaseAdmin
          .from("subscriptions")
          .select("id, status, current_period_end")
          .eq("organization_id", orgId)
          .single()

        if (!sub) { errorCount++; continue }

        // Una suscripción ACTIVE con período vigente ya está paga: pisarla con
        // "ahora + 1 período" podía acortar un anual y además cortaba su débito
        // automático. Se omite; para extenderla está la renovación individual.
        if (
          sub.status === "ACTIVE" &&
          sub.current_period_end &&
          new Date(sub.current_period_end) > now
        ) {
          skippedCount++
          continue
        }

        // Pasa a MANUAL: cancelar antes la preapproval de MercadoPago, que si
        // no seguiría debitando y su webhook volvería a MERCADOPAGO.
        const mpCancel = await cancelMercadoPagoPreapproval(orgId)
        if (!mpCancel.ok) { errorCount++; continue }

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

        // Igual que la cancelación individual: primero la preapproval de
        // MercadoPago; si falla, la org queda como estaba y cuenta como error.
        const mpCancel = await cancelMercadoPagoPreapproval(orgId)
        if (!mpCancel.ok) { errorCount++; continue }

        const { error: updateError } = immediate
          ? await supabaseAdmin
              .from("subscriptions")
              .update({ status: "CANCELED", canceled_at: now, cancel_at_period_end: false, trial_end: null })
              .eq("id", sub.id)
          : await supabaseAdmin
              .from("subscriptions")
              .update({ cancel_at_period_end: true, canceled_at: now })
              .eq("id", sub.id)

        if (updateError) { errorCount++; continue }

        await supabaseAdmin.from("subscription_history").insert({
          subscription_id: sub.id,
          organization_id: orgId,
          action: "CANCELED",
          previous_status: sub.status,
          new_status: immediate ? "CANCELED" : sub.status,
          details: { immediate, bulk: true, mercadopago_preapproval_canceled: mpCancel.canceled },
          performed_by: email,
        })

        successCount++
      }
    }

    await intento.completar({ successCount, errorCount, skippedCount })

    return NextResponse.json({
      success: true,
      message: `${successCount} operaciones exitosas${errorCount > 0 ? `, ${errorCount} errores` : ""}${skippedCount > 0 ? `, ${skippedCount} omitidas por tener un período pago vigente` : ""}`,
      successCount,
      errorCount,
      skippedCount,
    })
  } catch (err) {
    console.error("Error in bulk subscription action:", err)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
