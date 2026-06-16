import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"
import {
  exceedsTrialCap,
  computeNewTrialEnd,
  trialAdjustmentStatus,
  TRIAL_NET_EXTENSION_CAP_DAYS,
} from "@/lib/trial"

// `dias` accepts negative values (shorten) and the schema also supports
// `remove: true` to end the trial immediately. Either `remove` or a non-zero
// `dias` must be provided.
const trialExtensionSchema = z
  .object({
    organizationId: z.string().min(1, "ID de organización requerido"),
    dias: z.number().int().min(-90, "Mínimo -90 días").max(90, "Máximo 90 días").optional(),
    remove: z.boolean().optional(),
    motivo: z.string().max(500).optional(),
  })
  .refine((d) => d.remove === true || (typeof d.dias === "number" && d.dias !== 0), {
    message: "Indicá una cantidad de días distinta de 0, o remove:true para quitar el trial",
  })

export async function POST(request: NextRequest) {
  try {
    const { error: authError, email } = await requireSuperadmin()
    if (authError) return authError

    const parsed = await safeParseBody(request, trialExtensionSchema)
    if ("error" in parsed) return parsed.error

    const { organizationId, dias, motivo, remove } = parsed.data

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

    const now = new Date()
    const isRemoval = remove === true
    const deltaDias = isRemoval ? 0 : (dias as number)

    // Enforce the cumulative cap (only positive extensions can be blocked).
    if (!isRemoval && deltaDias > 0) {
      const { data: exts } = await supabaseAdmin
        .from("trial_extensions")
        .select("dias_extendidos")
        .eq("organization_id", organizationId)
      const existingSum = (exts ?? []).reduce(
        (s, e) => s + (e.dias_extendidos || 0),
        0
      )
      if (exceedsTrialCap(existingSum, deltaDias)) {
        return NextResponse.json(
          {
            error: `Tope de extensión alcanzado: máximo ${TRIAL_NET_EXTENSION_CAP_DAYS} días acumulados (ya hay ${existingSum}).`,
          },
          { status: 400 }
        )
      }
    }

    // Quitar el trial = terminarlo ahora. Acortar/extender = mover la fecha.
    const newTrialEnd = isRemoval
      ? now
      : computeNewTrialEnd(sub.trial_end ? new Date(sub.trial_end) : null, deltaDias, now)

    // Actualizar suscripción. NO degradamos a TRIALING una sub que paga
    // (ACTIVE) ni reactivamos una CANCELED por ajustar fechas de trial.
    const nextStatus = trialAdjustmentStatus(sub.status)
    const { error: updateError } = await supabaseAdmin
      .from("subscriptions")
      .update({
        status: nextStatus,
        trial_end: newTrialEnd.toISOString(),
      })
      .eq("id", sub.id)

    if (updateError) throw updateError

    // Registrar el ajuste (dias_extendidos puede ser negativo o 0 al quitar)
    await supabaseAdmin.from("trial_extensions").insert({
      organization_id: organizationId,
      dias_extendidos: deltaDias,
      nueva_fecha_fin: newTrialEnd.toISOString(),
      motivo: motivo || (isRemoval ? "Trial finalizado por superadmin" : null),
      extendido_por: email || "superadmin",
    })

    const fechaFmt = newTrialEnd.toLocaleDateString("es-AR")
    const accionDesc = isRemoval
      ? "trial finalizado"
      : deltaDias > 0
      ? `trial extendido ${deltaDias} días`
      : `trial acortado ${Math.abs(deltaDias)} días`

    // Registrar en historial de suscripción
    await supabaseAdmin.from("subscription_history").insert({
      subscription_id: sub.id,
      organization_id: organizationId,
      action: "TRIAL_EXTENDED",
      previous_status: sub.status,
      new_status: nextStatus,
      details: {
        dias: deltaDias,
        removed: isRemoval,
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
        action: "trial_adjustment",
        dias_extendidos: deltaDias,
        removed: isRemoval,
        nueva_fecha_fin: newTrialEnd.toISOString(),
        motivo,
        superadmin_email: email,
        previous_status: sub.status,
        previous_trial_end: sub.trial_end,
      },
    })

    // Notificar al admin de la org SOLO cuando es una extensión real (días
    // positivos). No tiene sentido avisarle al cliente que le acortamos o
    // quitamos el trial con copy de "extendido".
    if (!isRemoval && deltaDias > 0) {
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
          body: `Tu prueba gratuita fue extendida ${deltaDias} días hasta ${fechaFmt}`,
          type: "SUBSCRIPTION",
          icon: "clock",
          action_url: "/configuracion",
        }))

        await supabaseAdmin.from("user_notifications").insert(notifications)
      }
    }

    return NextResponse.json({
      success: true,
      message: isRemoval ? "Trial finalizado" : `${accionDesc} (hasta ${fechaFmt})`,
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
