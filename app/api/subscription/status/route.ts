import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { getSubscriptionInfo, isPremium, getTrialInfo } from "@/lib/subscriptions"

/**
 * GET /api/subscription/status
 * Retorna el estado de suscripción del usuario actual
 * Usado por el hook useSubscription en el cliente
 */
export async function GET() {
  try {
    // Hoy no lo consume nadie en la app. Se cierra ahora, antes de que alguien
    // lo cablee a una pantalla y cerrarlo pase a ser un cambio de conducta.
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const [subscription, premium, trialInfo] = await Promise.all([
      getSubscriptionInfo(organizationId!),
      isPremium(organizationId!),
      getTrialInfo(organizationId!),
    ])

    return NextResponse.json({
      isPremium: premium,
      planTipo: subscription?.planTipo || "FREE",
      planNombre: subscription?.planNombre || "Free",
      planSlug: subscription?.planSlug || "free",
      tierOrder: subscription?.tierOrder || 0,
      status: subscription?.status || "ACTIVE",
      features: subscription?.features || [],
      featureFlags: subscription?.featureFlags || {},
      limits: subscription?.limits || {
        ordenes: 50,
        tecnicos: 2,
        clientes: 100,
        storageMb: 100,
      },
      // Trial info
      isInTrial: trialInfo.isInTrial,
      trialEnd: trialInfo.trialEnd?.toISOString() || null,
      daysRemaining: trialInfo.daysRemaining,
      isPaid: trialInfo.isPaid,
    })
  } catch (error) {
    console.error("Error fetching subscription status:", error)
    return NextResponse.json(
      { error: "Error al obtener estado de suscripción" },
      { status: 500 }
    )
  }
}
