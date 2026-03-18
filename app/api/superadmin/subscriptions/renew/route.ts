import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"

const renewSchema = z.object({
  organizationId: z.string().min(1, "ID de organización requerido"),
  billingPeriod: z.enum(["MONTHLY", "YEARLY"]).optional().default("MONTHLY"),
  months: z.number().int().min(1).max(36).optional(),
})

export async function POST(request: Request) {
  try {
    const { error: authError, email } = await requireSuperadmin()
    if (authError) return authError

    const parsed = await safeParseBody(request, renewSchema)
    if ("error" in parsed) return parsed.error

    const { organizationId, billingPeriod, months } = parsed.data

    const period: "MONTHLY" | "YEARLY" = billingPeriod

    // Obtener plan Premium
    const { data: premiumPlan, error: planError } = await supabaseAdmin
      .from("plans")
      .select("id")
      .eq("tipo", "PREMIUM")
      .eq("activo", true)
      .single()

    if (planError || !premiumPlan) {
      return NextResponse.json(
        { error: "No se encontró un plan Premium activo" },
        { status: 404 }
      )
    }

    // Calcular fechas del período
    const now = new Date()
    const periodEnd = new Date(now)

    if (months) {
      periodEnd.setMonth(periodEnd.getMonth() + months)
    } else if (period === "YEARLY") {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1)
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1)
    }

    // Verificar si ya existe una suscripción para esta org
    const { data: existingSub } = await supabaseAdmin
      .from("subscriptions")
      .select("id, status, current_period_end")
      .eq("organization_id", organizationId)
      .single()

    let subscriptionId: string

    if (existingSub) {
      // Si la suscripción actual está activa y no ha vencido, extender desde la fecha de vencimiento
      let startDate = now
      if (
        existingSub.status === "ACTIVE" &&
        existingSub.current_period_end &&
        new Date(existingSub.current_period_end) > now
      ) {
        startDate = new Date(existingSub.current_period_end)
        const extendedEnd = new Date(startDate)
        if (months) {
          extendedEnd.setMonth(extendedEnd.getMonth() + months)
        } else if (period === "YEARLY") {
          extendedEnd.setFullYear(extendedEnd.getFullYear() + 1)
        } else {
          extendedEnd.setMonth(extendedEnd.getMonth() + 1)
        }
        periodEnd.setTime(extendedEnd.getTime())
      }

      // Actualizar suscripción existente
      const { error: updateError } = await supabaseAdmin
        .from("subscriptions")
        .update({
          plan_id: premiumPlan.id,
          status: "ACTIVE",
          billing_period: period,
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
          current_period_start: now.toISOString(),
          current_period_end: periodEnd.toISOString(),
          cancel_at_period_end: false,
        })
        .select("id")
        .single()

      if (createError) throw createError
      subscriptionId = newSub.id
    }

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
        previous_status: existingSub?.status || null,
      },
    })

    return NextResponse.json({
      success: true,
      message: `Suscripción Premium activada hasta ${periodEnd.toLocaleDateString("es-AR")}`,
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
