import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"
import { DEFAULT_TIMEZONE, formatDateValue } from "@/lib/timezone"

const renewSchema = z.object({
  organizationId: z.string().min(1, "ID de organización requerido"),
  billingPeriod: z.enum(["MONTHLY", "YEARLY"]).optional().default("MONTHLY"),
  months: z.number().int().min(1).max(36).optional(),
  days: z.number().int().min(1).max(3650).optional(),
  customEndDate: z.string().optional(), // ISO date string para fecha custom
  planSlug: z.string().optional(), // Default: 'profesional'
})

export async function POST(request: Request) {
  try {
    const { error: authError, email } = await requireSuperadmin()
    if (authError) return authError

    const parsed = await safeParseBody(request, renewSchema)
    if ("error" in parsed) return parsed.error

    const { organizationId, billingPeriod, months, days, customEndDate, planSlug } = parsed.data

    const period: "MONTHLY" | "YEARLY" = billingPeriod
    const targetSlug = planSlug || "profesional"

    // Obtener plan por slug (default: profesional)
    let { data: premiumPlan } = await supabaseAdmin
      .from("plans")
      .select("id, precio_mensual, precio_anual, moneda")
      .eq("slug", targetSlug)
      .eq("activo", true)
      .maybeSingle()

    // Fallback: si no se encuentra por slug, tomar el PREMIUM activo con mayor tier_order
    if (!premiumPlan) {
      const { data: fallbackPlan } = await supabaseAdmin
        .from("plans")
        .select("id, precio_mensual, precio_anual, moneda")
        .eq("tipo", "PREMIUM")
        .eq("activo", true)
        .order("tier_order", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle()
      premiumPlan = fallbackPlan
    }

    if (!premiumPlan) {
      return NextResponse.json(
        { error: "No se encontró un plan Premium activo" },
        { status: 404 }
      )
    }

    // Calcular fechas del período
    const now = new Date()
    let periodEnd: Date

    if (customEndDate) {
      // Fecha custom
      periodEnd = new Date(customEndDate)
      if (isNaN(periodEnd.getTime()) || periodEnd <= now) {
        return NextResponse.json(
          { error: "La fecha custom debe ser posterior a hoy" },
          { status: 400 }
        )
      }
    } else if (days) {
      periodEnd = new Date(now)
      periodEnd.setDate(periodEnd.getDate() + days)
    } else {
      periodEnd = new Date(now)
      if (months) {
        periodEnd.setMonth(periodEnd.getMonth() + months)
      } else if (period === "YEARLY") {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1)
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1)
      }
    }

    // Verificar si ya existe una suscripción para esta org
    const { data: existingSub } = await supabaseAdmin
      .from("subscriptions")
      .select("id, status, current_period_end")
      .eq("organization_id", organizationId)
      .single()

    let subscriptionId: string
    const previousStatus = existingSub?.status || null

    if (existingSub) {
      // Si la suscripción actual está activa y no ha vencido, extender desde la fecha de vencimiento
      let startDate = now
      if (
        !customEndDate &&
        existingSub.status === "ACTIVE" &&
        existingSub.current_period_end &&
        new Date(existingSub.current_period_end) > now
      ) {
        startDate = new Date(existingSub.current_period_end)
        const extendedEnd = new Date(startDate)
        if (days) {
          extendedEnd.setDate(extendedEnd.getDate() + days)
        } else if (months) {
          extendedEnd.setMonth(extendedEnd.getMonth() + months)
        } else if (period === "YEARLY") {
          extendedEnd.setFullYear(extendedEnd.getFullYear() + 1)
        } else {
          extendedEnd.setMonth(extendedEnd.getMonth() + 1)
        }
        periodEnd = extendedEnd
      }

      // Actualizar suscripción existente
      const { error: updateError } = await supabaseAdmin
        .from("subscriptions")
        .update({
          plan_id: premiumPlan.id,
          status: "ACTIVE",
          billing_period: period,
          payment_provider: "MANUAL",
          current_period_start: startDate.toISOString(),
          current_period_end: periodEnd.toISOString(),
          cancel_at_period_end: false,
          canceled_at: null,
          trial_end: null,
        })
        .eq("id", existingSub.id)

      if (updateError) throw updateError
      subscriptionId = existingSub.id
    } else {
      // Crear nueva suscripción
      const { data: newSub, error: createError } = await supabaseAdmin
        .from("subscriptions")
        .insert({
          organization_id: organizationId,
          plan_id: premiumPlan.id,
          status: "ACTIVE",
          billing_period: period,
          payment_provider: "MANUAL",
          current_period_start: now.toISOString(),
          current_period_end: periodEnd.toISOString(),
          cancel_at_period_end: false,
        })
        .select("id")
        .single()

      if (createError) throw createError
      subscriptionId = newSub.id
    }

    // Registrar pago en subscription_payments para que aparezca en /superadmin/pagos y dashboard
    // Calcular monto en base al período / cantidad de meses
    const meses = months || (period === "YEARLY" ? 12 : 1)
    const precioMensual = Number(premiumPlan.precio_mensual) || 0
    const precioAnual = Number(premiumPlan.precio_anual) || 0
    let amount = 0
    if (period === "YEARLY" && !months) {
      amount = precioAnual
    } else {
      amount = precioMensual * meses
    }

    const { error: payInsertError } = await supabaseAdmin
      .from("subscription_payments")
      .insert({
        subscription_id: subscriptionId,
        organization_id: organizationId,
        amount,
        currency: premiumPlan.moneda || "ARS",
        payment_provider: "MANUAL",
        provider_payment_id: `manual-${Date.now()}`,
        status: "SUCCEEDED",
        paid_at: now.toISOString(),
      })

    if (payInsertError) {
      console.error(
        `[superadmin/renew] Error inserting subscription_payment for org ${organizationId}:`,
        payInsertError
      )
      // No abortamos: la suscripción ya se renovó. Solo logueamos.
    }

    // Registrar en historial de suscripción
    await supabaseAdmin.from("subscription_history").insert({
      subscription_id: subscriptionId,
      organization_id: organizationId,
      action: previousStatus === "ACTIVE" ? "RENEWED" : "ACTIVATED",
      previous_status: previousStatus,
      new_status: "ACTIVE",
      details: {
        billing_period: period,
        months: days ? undefined : (months || (period === "YEARLY" ? 12 : 1)),
        days: days || undefined,
        period_end: periodEnd.toISOString(),
        custom_date: !!customEndDate,
      },
      performed_by: email,
    })

    // Registrar en audit_logs
    await supabaseAdmin.from("audit_logs").insert({
      organization_id: organizationId,
      user_id: null,
      action: "UPDATE",
      entity: "subscriptions",
      entity_id: subscriptionId,
      changes: {
        action: "manual_renewal",
        billing_period: period,
        months: months || (period === "YEARLY" ? 12 : 1),
        period_end: periodEnd.toISOString(),
        superadmin_email: email,
        previous_status: previousStatus,
        custom_date: !!customEndDate,
      },
    })

    // Notificar al admin de la org (mejora 11)
    const { data: orgAdmins } = await supabaseAdmin
      .from("users")
      .select("id, organization_id")
      .eq("organization_id", organizationId)
      .eq("rol", "ADMIN")

    if (orgAdmins && orgAdmins.length > 0) {
      const notifications = orgAdmins.map((admin) => ({
        organization_id: admin.organization_id,
        user_id: admin.id,
        title: "Suscripción Premium activada",
        body: `Tu plan Premium está activo hasta ${formatDateValue(periodEnd, DEFAULT_TIMEZONE)}`,
        type: "SUBSCRIPTION",
        icon: "credit-card",
        action_url: "/configuracion",
      }))

      await supabaseAdmin.from("user_notifications").insert(notifications)
    }

    return NextResponse.json({
      success: true,
      message: `Suscripción Premium activada hasta ${formatDateValue(periodEnd, DEFAULT_TIMEZONE)}`,
      periodEnd: periodEnd.toISOString(),
    })
  } catch (error) {
    console.error("Error renewing subscription:", error)
    return NextResponse.json(
      { error: "Error al renovar suscripción" },
      { status: 500 }
    )
  }
}
