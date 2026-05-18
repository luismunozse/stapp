import { supabaseAdmin } from "@/lib/supabase"

export type PlanSlug = "free" | "profesional" | string

export interface SubscriptionInfo {
  id: string
  planId: string
  planNombre: string
  planTipo: "FREE" | "PREMIUM"
  planSlug: PlanSlug
  tierOrder: number
  status: "ACTIVE" | "CANCELED" | "PAST_DUE" | "TRIALING"
  billingPeriod: "MONTHLY" | "YEARLY" | null
  paymentProvider: "MERCADOPAGO" | "REBILL" | null
  currentPeriodEnd: string | null
  trialEnd: string | null
  cancelAtPeriodEnd: boolean
  limits: {
    ordenes: number | null
    tecnicos: number | null
    clientes: number | null
    vendedores: number | null
    storageMb: number | null
  }
  features: string[]
  featureFlags: Record<string, boolean>
}

export interface TrialInfo {
  isInTrial: boolean
  isTrialExpired: boolean
  trialEnd: Date | null
  daysRemaining: number
  isPaid: boolean
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
      trial_end,
      cancel_at_period_end,
      plans (
        id,
        nombre,
        tipo,
        slug,
        tier_order,
        limite_ordenes,
        limite_tecnicos,
        limite_clientes,
        limite_vendedores,
        limite_storage_mb,
        features,
        feature_flags
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
    planSlug: plan.slug || (plan.tipo === "PREMIUM" ? "profesional" : "free"),
    tierOrder: plan.tier_order ?? 0,
    status: data.status,
    billingPeriod: data.billing_period,
    paymentProvider: data.payment_provider,
    currentPeriodEnd: data.current_period_end,
    trialEnd: data.trial_end,
    cancelAtPeriodEnd: data.cancel_at_period_end,
    limits: {
      ordenes: plan.limite_ordenes,
      tecnicos: plan.limite_tecnicos,
      clientes: plan.limite_clientes,
      vendedores: plan.limite_vendedores,
      storageMb: plan.limite_storage_mb,
    },
    features: plan.features || [],
    featureFlags: (plan.feature_flags as Record<string, boolean>) || {},
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
  ordenes: 15,
  tecnicos: 1,
  vendedores: 1,
  clientes: 30,
  storageMb: 100,
}

// Reset atómico del contador mensual de órdenes si periodo_inicio quedó del mes
// anterior. El trigger ON INSERT en ordenes_servicio también hace esto, pero
// solo si el INSERT llega a ejecutarse — sin este reset previo, el pre-check
// de checkPlanLimit lee el contador stale del mes pasado y deja al usuario
// bloqueado en plan Free (15/15) sin posibilidad de crear órdenes el mes nuevo.
async function resetOrdenesMesIfNeeded(organizationId: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc("reset_ordenes_mes_if_needed", {
    org_id: organizationId,
  })

  // Fallback si la RPC todavía no existe en este entorno: hacer el UPDATE
  // condicional desde la app. Es idempotente y atómico a nivel de fila.
  if (error) {
    const monthStart = new Date()
    monthStart.setUTCDate(1)
    monthStart.setUTCHours(0, 0, 0, 0)
    await supabaseAdmin
      .from("organization_usage")
      .update({
        ordenes_mes_actual: 0,
        periodo_inicio: monthStart.toISOString(),
      })
      .eq("organization_id", organizationId)
      .lt("periodo_inicio", monthStart.toISOString())
  }
}

// Verificar si una organización puede realizar una acción según su plan
export async function checkPlanLimit(
  organizationId: string,
  limitType: "ordenes" | "tecnicos" | "clientes" | "vendedores" | "storage"
): Promise<{ allowed: boolean; current: number; limit: number | null; message?: string }> {
  // Para órdenes: resetear contador mensual si periodo_inicio < mes actual.
  // Debe correr ANTES de getUsageInfo para que la lectura sea consistente.
  if (limitType === "ordenes") {
    await resetOrdenesMesIfNeeded(organizationId)
  }

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
        limit = subscription.limits.vendedores
        current = usage.vendedores
        break
      case "clientes":
        limit = subscription.limits.clientes
        current = usage.clientes
        break
      case "storage":
        limit = subscription.limits.storageMb
        current = Math.round(usage.storageMb)
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
      case "storage":
        current = Math.round(usage.storageMb)
        break
    }
  }

  // Si no hay límite (Premium), permitir
  if (limit === null) {
    return { allowed: true, current, limit: null }
  }

  const allowed = current < limit

  // Sugerencia de upgrade dinámica según el plan actual
  const currentSlug = subscription?.planSlug || "free"
  const upgradeTarget = "Profesional"

  return {
    allowed,
    current,
    limit,
    message: allowed
      ? undefined
      : `Has alcanzado el límite de ${limit} ${limitType} de tu plan. Actualizá a ${upgradeTarget} para continuar.`,
  }
}

// Retorna el slug del plan actual de la organización
export async function getPlanSlug(organizationId: string): Promise<PlanSlug> {
  const subscription = await getSubscriptionInfo(organizationId)
  if (!subscription) return "free"
  return subscription.planSlug
}

// Verifica si el plan actual tiene una feature específica habilitada
// Usado para feature gating granular (reportes, whatsapp, kiosco, etc)
export async function hasPlanFeature(
  organizationId: string,
  featureKey: string
): Promise<boolean> {
  const subscription = await getSubscriptionInfo(organizationId)
  if (!subscription) return false

  // Si el trial expiró, no hay acceso a ninguna feature
  if (subscription.status === "TRIALING") {
    const trialEnd = subscription.trialEnd ? new Date(subscription.trialEnd) : null
    if (!trialEnd || trialEnd < new Date()) return false
  }

  // Si el status es CANCELED o PAST_DUE, no hay acceso
  if (subscription.status === "CANCELED" || subscription.status === "PAST_DUE") {
    return false
  }

  // Chequear el flag específico en el JSONB del plan
  return subscription.featureFlags?.[featureKey] === true
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

// Obtener información del trial
export async function getTrialInfo(organizationId: string): Promise<TrialInfo> {
  const subscription = await getSubscriptionInfo(organizationId)

  if (!subscription) {
    return {
      isInTrial: false,
      isTrialExpired: true, // Sin suscripción = bloqueado
      trialEnd: null,
      daysRemaining: 0,
      isPaid: false,
    }
  }

  const now = new Date()
  const trialEnd = subscription.trialEnd ? new Date(subscription.trialEnd) : null
  const isInTrial = subscription.status === "TRIALING" && trialEnd !== null
  const isTrialExpired = isInTrial && trialEnd < now
  const isPaid = subscription.status === "ACTIVE" && subscription.paymentProvider !== null

  // Calcular días restantes
  let daysRemaining = 0
  if (trialEnd && !isTrialExpired) {
    const diffTime = trialEnd.getTime() - now.getTime()
    daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    if (daysRemaining < 0) daysRemaining = 0
  }

  return {
    isInTrial,
    isTrialExpired,
    trialEnd,
    daysRemaining,
    isPaid,
  }
}

// Verificar si la organización es la del Superadmin (panel admin.stapp.com.ar)
async function isSuperadminOrg(organizationId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("organizations")
    .select("slug")
    .eq("id", organizationId)
    .single()
  return data?.slug === "superadmin"
}

// Verificar si la organización tiene acceso válido (no bloqueado)
export async function hasValidAccess(organizationId: string): Promise<{
  hasAccess: boolean
  reason?: "trial_expired" | "canceled" | "past_due"
  trialInfo?: TrialInfo
}> {
  const subscription = await getSubscriptionInfo(organizationId)
  const trialInfo = await getTrialInfo(organizationId)

  // Superadmin siempre tiene acceso, nunca se downgradea
  if (await isSuperadminOrg(organizationId)) {
    return { hasAccess: true, trialInfo }
  }

  // Sin suscripción = sin acceso
  if (!subscription) {
    return { hasAccess: false, reason: "trial_expired", trialInfo }
  }

  // Si está en trial y expiró → migrar a plan Free automáticamente
  if (trialInfo.isTrialExpired) {
    await downgradeToFree(organizationId)
    return { hasAccess: true, trialInfo }
  }

  // Si el status es CANCELED = bloqueado
  if (subscription.status === "CANCELED") {
    return { hasAccess: false, reason: "canceled", trialInfo }
  }

  // Si el pago falló = bloqueado
  if (subscription.status === "PAST_DUE") {
    return { hasAccess: false, reason: "past_due", trialInfo }
  }

  // TRIALING (no expirado) o ACTIVE = tiene acceso
  return { hasAccess: true, trialInfo }
}

/**
 * Migra la suscripción de una organización al plan Free.
 * Se llama automáticamente cuando el trial de Profesional expira.
 */
async function downgradeToFree(organizationId: string): Promise<void> {
  try {
    // Guard: nunca downgradear la organización del Superadmin
    if (await isSuperadminOrg(organizationId)) {
      return
    }

    // Buscar el plan Free activo
    const { data: freePlan } = await supabaseAdmin
      .from("plans")
      .select("id")
      .eq("slug", "free")
      .eq("activo", true)
      .single()

    if (!freePlan) {
      console.error("[Subscriptions] No active Free plan found for downgrade")
      return
    }

    // Actualizar la suscripción al plan Free con status ACTIVE
    await supabaseAdmin
      .from("subscriptions")
      .update({
        plan_id: freePlan.id,
        status: "ACTIVE",
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", organizationId)
  } catch (error) {
    console.error("[Subscriptions] Error downgrading to Free:", error)
  }
}

// Verificar si la organización tiene plan Premium (o está en trial activo)
export async function isPremium(organizationId: string): Promise<boolean> {
  const subscription = await getSubscriptionInfo(organizationId)

  if (!subscription) return false

  // Premium pagado y activo
  if (subscription.planTipo === "PREMIUM" && subscription.status === "ACTIVE") {
    return true
  }

  // En trial activo (no expirado) con plan Premium
  if (subscription.status === "TRIALING" && subscription.planTipo === "PREMIUM") {
    const trialEnd = subscription.trialEnd ? new Date(subscription.trialEnd) : null
    if (trialEnd && trialEnd > new Date()) {
      return true
    }
  }

  return false
}

// Actualizar uso de storage.
// Retorna { error } cuando la RPC raisea (ej. PLAN_LIMIT_EXCEEDED:storage:...).
// El caller decide si rollbackear el upload + DB row o si convertir a 403.
export async function updateStorageUsage(
  organizationId: string,
  bytesAdded: number
): Promise<{ error: { message?: string; code?: string; details?: string | null; hint?: string | null } | null }> {
  const mbAdded = bytesAdded / (1024 * 1024)

  const { error } = await supabaseAdmin.rpc("update_storage_usage", {
    org_id: organizationId,
    mb_added: mbAdded,
  })

  return { error: error ?? null }
}
