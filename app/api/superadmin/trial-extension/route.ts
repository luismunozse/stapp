import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"

const trialExtensionSchema = z.object({
  organizationId: z.string().min(1, "ID de organización requerido"),
  dias: z.number().int().min(1, "Mínimo 1 día").max(90, "Máximo 90 días"),
  motivo: z.string().max(500).optional(),
})

export async function POST(request: NextRequest) {
  try {
    const { error: authError, email } = await requireSuperadmin()
    if (authError) return authError

    const parsed = await safeParseBody(request, trialExtensionSchema)
    if ("error" in parsed) return parsed.error

    const { organizationId, dias, motivo } = parsed.data

    // Buscar suscripción actual
    const { data: sub, error: subError } = await supabaseAdmin
      .from("subscriptions")
      .select("id, status, trial_end")
      .eq("organization_id", organizationId)
      .single()

    if (subError || !sub) {
      return NextResponse.json(
        { error: "No se encontro suscripcion para esta organizacion" },
        { status: 404 }
      )
    }

    // Calcular nueva fecha de fin de trial
    const baseDate = sub.trial_end ? new Date(sub.trial_end) : new Date()
    const newTrialEnd = new Date(baseDate)
    newTrialEnd.setDate(newTrialEnd.getDate() + dias)

    // Actualizar suscripción
    const { error: updateError } = await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "TRIALING",
        trial_end: newTrialEnd.toISOString(),
      })
      .eq("id", sub.id)

    if (updateError) throw updateError

    // Registrar extensión
    await supabaseAdmin.from("trial_extensions").insert({
      organization_id: organizationId,
      dias_extendidos: dias,
      nueva_fecha_fin: newTrialEnd.toISOString(),
      motivo: motivo || null,
      extendido_por: email || "superadmin",
    })

    // Registrar en historial de suscripción
    await supabaseAdmin.from("subscription_history").insert({
      subscription_id: sub.id,
      organization_id: organizationId,
      action: "TRIAL_EXTENDED",
      previous_status: sub.status,
      new_status: "TRIALING",
      details: {
        dias,
        motivo,
        previous_trial_end: sub.trial_end,
        new_trial_end: newTrialEnd.toISOString(),
      },
      performed_by: email,
    })

    // Audit log
    await supabaseAdmin.from("audit_logs").insert({
      organization_id: organizationId,
      user_id: null,
      action: "UPDATE",
      entity: "subscriptions",
      entity_id: sub.id,
      changes: {
        action: "trial_extension",
        dias_extendidos: dias,
        nueva_fecha_fin: newTrialEnd.toISOString(),
        motivo,
        superadmin_email: email,
        previous_status: sub.status,
        previous_trial_end: sub.trial_end,
      },
    })

    // Notificar al admin de la org
    const { data: orgAdmins } = await supabaseAdmin
      .from("users")
      .select("id, organization_id")
      .eq("organization_id", organizationId)
      .eq("rol", "ADMIN")

    if (orgAdmins && orgAdmins.length > 0) {
      const notifications = orgAdmins.map((admin) => ({
        organization_id: admin.organization_id,
        user_id: admin.id,
        title: "Período de prueba extendido",
        body: `Tu prueba gratuita fue extendida ${dias} días hasta ${newTrialEnd.toLocaleDateString("es-AR")}`,
        type: "SUBSCRIPTION",
        icon: "clock",
        action_url: "/configuracion",
      }))

      await supabaseAdmin.from("user_notifications").insert(notifications)
    }

    return NextResponse.json({
      success: true,
      message: `Trial extendido ${dias} dias hasta ${newTrialEnd.toLocaleDateString("es-AR")}`,
      newTrialEnd: newTrialEnd.toISOString(),
    })
  } catch (error) {
    console.error("Error extending trial:", error)
    return NextResponse.json(
      { error: "Error al extender trial" },
      { status: 500 }
    )
  }
}
