import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { getSubscriptionInfo, getUsageInfo } from "@/lib/subscriptions"

export async function GET() {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const [subscription, usage] = await Promise.all([
      getSubscriptionInfo(organizationId!),
      getUsageInfo(organizationId!),
    ])

    if (!subscription) {
      return NextResponse.json(
        { error: "No hay suscripción activa" },
        { status: 404 }
      )
    }

    // Calcular porcentajes de uso
    const usagePercentages = {
      ordenes:
        subscription.limits.ordenes !== null
          ? Math.round((usage.ordenesMesActual / subscription.limits.ordenes) * 100)
          : null,
      tecnicos:
        subscription.limits.tecnicos !== null
          ? Math.round((usage.tecnicos / subscription.limits.tecnicos) * 100)
          : null,
      clientes:
        subscription.limits.clientes !== null
          ? Math.round((usage.clientes / subscription.limits.clientes) * 100)
          : null,
      storage:
        subscription.limits.storageMb !== null
          ? Math.round((usage.storageMb / subscription.limits.storageMb) * 100)
          : null,
    }

    return NextResponse.json({
      usage,
      limits: subscription.limits,
      percentages: usagePercentages,
      planType: subscription.planTipo,
    })
  } catch (error) {
    console.error("Error fetching usage:", error)
    return NextResponse.json(
      { error: "Error al obtener uso" },
      { status: 500 }
    )
  }
}
