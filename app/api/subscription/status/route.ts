import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { getSubscriptionInfo, isPremium } from "@/lib/subscriptions"

/**
 * GET /api/subscription/status
 * Retorna el estado de suscripción del usuario actual
 * Usado por el hook useSubscription en el cliente
 */
export async function GET() {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const [subscription, premium] = await Promise.all([
      getSubscriptionInfo(organizationId!),
      isPremium(organizationId!),
    ])

    return NextResponse.json({
      isPremium: premium,
      planTipo: subscription?.planTipo || "FREE",
      planNombre: subscription?.planNombre || "Free",
      status: subscription?.status || "ACTIVE",
      features: subscription?.features || [],
      limits: subscription?.limits || {
        ordenes: 50,
        tecnicos: 2,
        clientes: 100,
        storageMb: 100,
      },
    })
  } catch (error) {
    console.error("Error fetching subscription status:", error)
    return NextResponse.json(
      { error: "Error al obtener estado de suscripción" },
      { status: 500 }
    )
  }
}
