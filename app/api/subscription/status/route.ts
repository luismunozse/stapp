import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { getSubscriptionInfo, isPremium, getTrialInfo } from "@/lib/subscriptions"

/**
 * GET /api/subscription/status
 * Retorna el estado de suscripción del usuario actual
 * Usado por el hook useSubscription en el cliente
 */
export async function GET() {
  try {
    // Cualquier rol autenticado, a propósito.
    //
    // Esto estuvo cerrado con requireAdmin() sobre la premisa de que "hoy no lo
    // consume nadie en la app". Lo consumen cinco pantallas del cliente, todas
    // vía el hook `useSubscription`: /cotizaciones, cotizacion-list, las dos
    // listas de clientes y el header del detalle, más el badge de plan.
    //
    // Y el costo no era un 403 visible: `useSubscription` atrapa el error y cae
    // a un fallback "FREE con featureFlags vacío". Al TECNICO y al VENDEDOR la
    // app les pintaba su organización como si estuviera en Free —sin botón
    // "Nueva Cotización", con el cartel de "las cotizaciones son parte del plan
    // Profesional"— dentro de organizaciones que estaban pagando Profesional.
    // Un paywall fabricado por un guard, sin nada en pantalla que lo delatara.
    //
    // El plan de la organización no es un dato por rol: es el mismo para todos
    // los que trabajan adentro, y el resto de la app ya lo trata así
    // (/api/org/features es requireAuth por el mismo motivo). Lo que sí es por
    // rol —quién puede escribir qué— lo deciden los guards de cada endpoint,
    // no esta lectura. `organizationId` sale de la sesión, así que abrirla a
    // todos los roles no la abre a otras organizaciones.
    const { error, organizationId } = await requireAuth()
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
