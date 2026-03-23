import { NextRequest, NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

export async function POST(request: NextRequest) {
  try {
    const { error: authError, email } = await requireSuperadmin()
    if (authError) return authError

    const body = await request.json()
    const { organizationId, dias, motivo } = body

    if (!organizationId || !dias || dias < 1 || dias > 90) {
      return NextResponse.json(
        { error: "organizationId y dias (1-90) son requeridos" },
        { status: 400 }
      )
    }

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
