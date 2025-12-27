import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { getSubscriptionInfo, getUsageInfo, getAvailablePlans } from "@/lib/subscriptions"

export async function GET() {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const [subscription, usage, plans] = await Promise.all([
      getSubscriptionInfo(organizationId!),
      getUsageInfo(organizationId!),
      getAvailablePlans(),
    ])

    return NextResponse.json({
      subscription,
      usage,
      plans,
    })
  } catch (error) {
    console.error("Error fetching subscription:", error)
    return NextResponse.json(
      { error: "Error al obtener suscripción" },
      { status: 500 }
    )
  }
}
