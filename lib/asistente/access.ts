import { getSubscriptionInfo, hasPlanFeature } from "@/lib/subscriptions"

export const ASISTENTE_FEATURE_KEY = "asistente_ia"

// Gate del asistente: plan con flag asistente_ia Y suscripción ACTIVE.
// hasPlanFeature solo no alcanza: permite TRIALING vigente, y el asistente
// se vende exclusivamente con el plan Profesional pago (decisión de producto).
export async function canUseAsistente(organizationId: string): Promise<boolean> {
  const subscription = await getSubscriptionInfo(organizationId)
  if (!subscription || subscription.status !== "ACTIVE") return false
  return hasPlanFeature(organizationId, ASISTENTE_FEATURE_KEY)
}
