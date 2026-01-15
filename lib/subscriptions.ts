import { supabaseAdmin } from "@/lib/supabase"

export interface SubscriptionInfo {
  id: string
  planId: string
  planNombre: string
  planTipo: "FREE" | "PREMIUM"
  status: "ACTIVE" | "CANCELED" | "PAST_DUE" | "TRIALING"
  billingPeriod: "MONTHLY" | "YEARLY" | null
  paymentProvider: "MERCADOPAGO" | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  limits: {
    ordenes: number | null
    tecnicos: number | null
    clientes: number | null
    storageMb: number | null
  }
  features: string[]
}

export interface UsageInfo {
  ordenesMesActual: number
  ordenesTotal: number
  tecnicos: number
  vendedores: number
  clientes: number
  storageMb: number
}

// Obtener información de suscripción de una organización
export async function getSubscriptionInfo(
  organizationId: string
): Promise<SubscriptionInfo | null> {
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select(`
      id,
      status,
      billing_period,
      payment_provider,
      current_period_end,
      cancel_at_period_end,
      plans (
        id,
        nombre,
        tipo,
        limite_ordenes,
        limite_tecnicos,
        limite_clientes,
        limite_storage_mb,
        features
      )
    `)
    .eq("organization_id", organizationId)
    .single()

  if (error || !data) {
    return null
  }

  const plan = data.plans as any

  return {
    id: data.id,
    planId: plan.id,
    planNombre: plan.nombre,
    planTipo: plan.tipo,
    status: data.status,
    billingPeriod: data.billing_period,
    paymentProvider: data.payment_provider,
    currentPeriodEnd: data.current_period_end,
    cancelAtPeriodEnd: data.cancel_at_period_end,
    limits: {
      ordenes: plan.limite_ordenes,
      tecnicos: plan.limite_tecnicos,
      clientes: plan.limite_clientes,
      storageMb: plan.limite_storage_mb,
    },
    features: plan.features || [],
  }
}

// Obtener información de uso de una organización
export async function getUsageInfo(organizationId: string): Promise<UsageInfo> {
  const { data } = await supabaseAdmin
    .from("organization_usage")
    .select("*")
    .eq("organization_id", organizationId)
    .single()

  if (!data) {
    return {
      ordenesMesActual: 0,
      ordenesTotal: 0,
      tecnicos: 0,
      vendedores: 0,
      clientes: 0,
      storageMb: 0,
    }
  }

  return {
    ordenesMesActual: data.ordenes_mes_actual || 0,
    ordenesTotal: data.ordenes_count || 0,
    tecnicos: data.tecnicos_count || 0,
    vendedores: data.vendedores_count || 0,
    clientes: data.clientes_count || 0,
    storageMb: parseFloat(data.storage_used_mb || "0"),
  }
}

// Límites por defecto del plan FREE (cuando no hay suscripción)
const FREE_PLAN_LIMITS: Record<string, number> = {
  ordenes: 50,
  tecnicos: 2,
  vendedores: 2,
  clientes: 100,
  storageMb: 100,
}

// Verificar si una organización puede realizar una acción según su plan
export async function checkPlanLimit(
  organizationId: string,
  limitType: "ordenes" | "tecnicos" | "clientes" | "vendedores"
): Promise<{ allowed: boolean; current: number; limit: number | null; message?: string }> {
  const subscription = await getSubscriptionInfo(organizationId)
  const usage = await getUsageInfo(organizationId)

  // Obtener límites (usar FREE por defecto si no hay suscripción)
  let limit: number | null = null
  let current = 0

  if (subscription) {
    // Usar límites de la suscripción
    switch (limitType) {
      case "ordenes":
        limit = subscription.limits.ordenes
        current = usage.ordenesMesActual
        break
      case "tecnicos":
        limit = subscription.limits.tecnicos
        current = usage.tecnicos
        break
      case "vendedores":
        // Vendedores usa el mismo límite que técnicos en el plan
        limit = subscription.limits.tecnicos
        current = usage.vendedores
        break
      case "clientes":
        limit = subscription.limits.clientes
        current = usage.clientes
        break
    }
  } else {
    // Sin suscripción: usar límites FREE
    limit = FREE_PLAN_LIMITS[limitType]
    switch (limitType) {
      case "ordenes":
        current = usage.ordenesMesActual
        break
      case "tecnicos":
        current = usage.tecnicos
        break
      case "vendedores":
        current = usage.vendedores
        break
      case "clientes":
        current = usage.clientes
        break
    }
  }

  // Si no hay límite (Premium), permitir
  if (limit === null) {
    return { allowed: true, current, limit: null }
  }

  const allowed = current < limit

  return {
    allowed,
    current,
    limit,
    message: allowed
      ? undefined
      : `Has alcanzado el límite de ${limit} ${limitType} de tu plan. Actualiza a Premium para continuar.`,
  }
}

// Obtener todos los planes disponibles
export async function getAvailablePlans() {
  const { data, error } = await supabaseAdmin
    .from("plans")
    .select("*")
    .eq("activo", true)
    .order("precio_mensual", { ascending: true })

  if (error) {
    console.error("Error fetching plans:", error)
    return []
  }

  return data || []
}

// Verificar si la organización tiene plan Premium
export async function isPremium(organizationId: string): Promise<boolean> {
  const subscription = await getSubscriptionInfo(organizationId)
  return subscription?.planTipo === "PREMIUM" && subscription.status === "ACTIVE"
}

// Actualizar uso de storage
export async function updateStorageUsage(
  organizationId: string,
  bytesAdded: number
) {
  const mbAdded = bytesAdded / (1024 * 1024)

  await supabaseAdmin.rpc("update_storage_usage", {
    org_id: organizationId,
    mb_added: mbAdded,
  })
}
