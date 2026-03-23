import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"

const EXTENSION_DAYS = 7
const MAX_REACTIVATIONS = 1

export async function POST() {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 })
    }

    const organizationId = session.user.organizationId

    // Verificar suscripción actual
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("id, status, trial_end")
      .eq("organization_id", organizationId)
      .single()

    if (!sub) {
      return NextResponse.json({ error: "No se encontró suscripción" }, { status: 404 })
    }

    // Solo permitir reactivar si el trial está vencido
    const now = new Date()
    const trialEnd = sub.trial_end ? new Date(sub.trial_end) : null
    const isExpired = sub.status === "TRIALING" && trialEnd && trialEnd < now

    if (!isExpired) {
      // Trial todavía activo, simplemente redirigir
      return NextResponse.json({
        success: true,
        alreadyActive: true,
        message: "Tu cuenta ya está activa",
      })
    }

    // Verificar que no haya excedido el máximo de reactivaciones
    const { count } = await supabaseAdmin
      .from("trial_extensions")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .like("motivo", "%reactivación desde email%")

    if ((count || 0) >= MAX_REACTIVATIONS) {
      return NextResponse.json({
        success: false,
        maxReached: true,
        message: "Ya usaste tus extensiones de prueba. Suscribite al plan Premium para seguir usando STApp.",
      })
    }

    // Extender trial
    const newTrialEnd = new Date(now)
    newTrialEnd.setDate(newTrialEnd.getDate() + EXTENSION_DAYS)

    await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "TRIALING",
        trial_end: newTrialEnd.toISOString(),
      })
      .eq("id", sub.id)

    // Registrar extensión
    await supabaseAdmin.from("trial_extensions").insert({
      organization_id: organizationId,
      dias_extendidos: EXTENSION_DAYS,
      nueva_fecha_fin: newTrialEnd.toISOString(),
      motivo: "reactivación desde email - el usuario hizo clic en el enlace",
      extendido_por: session.user.email || "usuario",
    })

    return NextResponse.json({
      success: true,
      message: `Tu cuenta fue reactivada por ${EXTENSION_DAYS} días`,
      daysExtended: EXTENSION_DAYS,
      newTrialEnd: newTrialEnd.toISOString(),
    })
  } catch (error) {
    console.error("Error reactivating trial:", error)
    return NextResponse.json(
      { error: "Error al reactivar la cuenta" },
      { status: 500 }
    )
  }
}
