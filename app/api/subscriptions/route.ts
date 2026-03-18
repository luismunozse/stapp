import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { getSubscriptionInfo, getUsageInfo, getAvailablePlans, getTrialInfo } from "@/lib/subscriptions"

export async function GET() {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const [subscription, usage, plans, trialInfo] = await Promise.all([
      getSubscriptionInfo(organizationId!),
      getUsageInfo(organizationId!),
      getAvailablePlans(),
      getTrialInfo(organizationId!),
    ])

    // Determinar estado efectivo para el frontend
    let effectiveStatus: string | null = subscription?.status || null
    if (trialInfo.isTrialExpired) {
      effectiveStatus = "EXPIRED"
    }

    return NextResponse.json({
      subscription,
      usage,
      plans,
      trialInfo,
      effectiveStatus,
    })
  } catch (error) {
    console.error("Error fetching subscription:", error)
    return NextResponse.json(
      { error: "Error al obtener suscripción" },
      { status: 500 }
    )
  }
}
