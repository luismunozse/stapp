import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"
import { createSuperadminAuditLogger } from "@/lib/superadmin-audit"

const cancelSchema = z.object({
  organizationId: z.string().min(1, "ID de organización requerido"),
  immediate: z.boolean().optional().default(false),
})

export async function POST(request: Request) {
  try {
    const { error, email } = await requireSuperadmin()
    if (error) return error

    const parsed = await safeParseBody(request, cancelSchema)
    if ("error" in parsed) return parsed.error

    const { organizationId, immediate } = parsed.data

    // Buscar suscripción
    const { data: sub, error: subError } = await supabaseAdmin
      .from("subscriptions")
      .select("id, status, organization_id, current_period_end")
      .eq("organization_id", organizationId)
      .single()

    if (subError || !sub) {
      return NextResponse.json({ error: "Suscripción no encontrada" }, { status: 404 })
    }

    if (sub.status === "CANCELED") {
      return NextResponse.json({ error: "La suscripción ya está cancelada" }, { status: 400 })
    }

    const now = new Date().toISOString()

    if (immediate) {
      // Cancelación inmediata
      await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "CANCELED",
          canceled_at: now,
          cancel_at_period_end: false,
        })
        .eq("id", sub.id)
    } else {
      // Cancelar al final del período
      await supabaseAdmin
        .from("subscriptions")
        .update({
          cancel_at_period_end: true,
          canceled_at: now,
        })
        .eq("id", sub.id)
    }

    // Registrar en historial
    await supabaseAdmin.from("subscription_history").insert({
      subscription_id: sub.id,
      organization_id: organizationId,
      action: "CANCELED",
      previous_status: sub.status,
      new_status: immediate ? "CANCELED" : sub.status,
      details: { immediate, cancel_at_period_end: !immediate, current_period_end: sub.current_period_end },
      performed_by: email,
    })

    // Audit log
    const auditLogger = createSuperadminAuditLogger(email, request)
    auditLogger
      .log({
        action: "UPDATE",
        entity: "subscriptions",
        entityId: sub.id,
        organizationId,
        description: immediate
          ? "Suscripción cancelada inmediatamente"
          : "Suscripción marcada para cancelar al final del período",
        metadata: { immediate },
      })
      .catch(() => {})

    return NextResponse.json({
      success: true,
      message: immediate
        ? "Suscripción cancelada"
        : "Suscripción se cancelará al final del período actual",
    })
  } catch (err) {
    console.error("Error canceling subscription:", err)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
