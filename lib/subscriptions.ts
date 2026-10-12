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
  paymentProvider: "MERCADOPAGO" | "CREEM" | "REBILL" | "MANUAL" | null
  /** Si la suscripcion se cobra sola. Es un booleano y no el id del preapproval:
   *  el identificador del proveedor no tiene por que viajar al browser. */
  autoDebito: boolean
  currentPeriodEnd: string | null
  trialEnd: string | null
  cancelAtPeriodEnd: boolean
  limits: {
    ordenes: number | null
    tecnicos: number | null
    clientes: number | null
    vendedores: number | null
    storageMb: number | null
    sucursales: number | null
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
      mercadopago_preapproval_id,
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
        limite_sucursales,
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
    autoDebito: !!data.mercadopago_preapproval_id,
    currentPeriodEnd: data.current_period_end,
    trialEnd: data.trial_end,
    cancelAtPeriodEnd: data.cancel_at_period_end,
    limits: {
      ordenes: plan.limite_ordenes,
      tecnicos: plan.limite_tecnicos,
      clientes: plan.limite_clientes,
      vendedores: plan.limite_vendedores,
      storageMb: plan.limite_storage_mb,
      sucursales: plan.limite_sucursales,
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

// Límites por defecto del plan FREE (cuando no hay suscripción).
// Deben coincidir con lo seteado en plans.slug='free' por la última migración
// (ver supabase/migrations/187_free_plan_v2_loosen.sql).
const FREE_PLAN_LIMITS: Record<string, number> = {
  ordenes: 30,
  tecnicos: 1,
  vendedores: 1,
  clientes: 200,
  storageMb: 100,
  sucursales: 1,
}

// COUNT en vivo de sucursales activas de la org. No usamos el contador cacheado
// (organization_usage.sucursales_count) porque no tiene trigger que lo mantenga.
async function countSucursalesActivas(organizationId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from("sucursales")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .eq("activo", true)
  return count ?? 0
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

export type UpgradeAction = "upgrade_free_to_profesional" | "activate_trial" | null

// Verificar si una organización puede realizar una acción según su plan
export async function checkPlanLimit(
  organizationId: string,
  limitType: "ordenes" | "tecnicos" | "clientes" | "vendedores" | "storage" | "sucursales"
): Promise<{
  allowed: boolean
  current: number
  limit: number | null
  message?: string
  upgradeAction?: UpgradeAction
}> {
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
      case "sucursales":
        limit = subscription.limits.sucursales
        current = await countSucursalesActivas(organizationId)
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
      case "sucursales":
        current = await countSucursalesActivas(organizationId)
        break
    }
  }

  // Si no hay límite (Premium), permitir
  if (limit === null) {
    return { allowed: true, current, limit: null, upgradeAction: null }
  }

  const allowed = current < limit

  if (allowed) {
    return { allowed, current, limit, upgradeAction: null }
  }

  // Sugerencia de upgrade dinámica según el plan actual.
  // - Free → upgrade a Profesional (CTA fuerte, mensaje con beneficios).
  // - Otro plan (trial/limbo) → activar el plan (mensaje más suave).
  const currentSlug = subscription?.planSlug || "free"
  const upgradeAction: UpgradeAction =
    currentSlug === "free" ? "upgrade_free_to_profesional" : "activate_trial"

  // Label legible del tipo de límite para el mensaje.
  const limitLabels: Record<string, string> = {
    ordenes: "órdenes",
    clientes: "clientes",
    tecnicos: "técnicos",
    vendedores: "vendedores",
    storage: "almacenamiento (MB)",
    sucursales: "sucursales",
  }
  const label = limitLabels[limitType] || limitType

  let message: string
  if (currentSlug === "free") {
    message = `Llegaste al límite del plan Free (${limit} ${label}). Actualizá a Profesional para obtener ${label} ilimitados y desbloquear WhatsApp, reportes, garantías y más.`
  } else {
    message = `Llegaste al límite de ${limit} ${label} de tu plan. Activá el plan Profesional para seguir creciendo sin restricciones.`
  }

  return {
    allowed,
    current,
    limit,
    message,
    upgradeAction,
  }
}

// Retorna el slug del plan actual de la organización
export async function getPlanSlug(organizationId: string): Promise<PlanSlug> {
  const subscription = await getSubscriptionInfo(organizationId)
  if (!subscription) return "free"
  return subscription.planSlug
}

/**
 * Pure resolver: returns the override value when it is not null, otherwise
 * falls back to the plan-level flag. Access gating (trial expiry, CANCELED,
 * PAST_DUE) is handled by hasPlanFeature before this is called.
 */
export function resolveFeatureAccess(
  planHasFeature: boolean,
  override: boolean | null
): boolean {
  return override !== null ? override : planHasFeature
}

/**
 * Fetches a per-org feature override from the DB.
 * Returns null when no row exists or on any error (safe fallback to plan).
 */
async function getFeatureOverride(
  organizationId: string,
  featureKey: string
): Promise<boolean | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("organization_feature_overrides")
      .select("enabled")
      .eq("organization_id", organizationId)
      .eq("feature_key", featureKey)
      .single()

    if (error || data === null) return null
    return data.enabled
  } catch {
    return null
  }
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

  // ACTIVE Premium con período vencido = sin acceso a features premium
  if (
    subscription.status === "ACTIVE" &&
    subscription.planTipo === "PREMIUM" &&
    subscription.currentPeriodEnd &&
    new Date(subscription.currentPeriodEnd) <= new Date()
  ) {
    return false
  }

  // Resolve plan flag + per-org override
  const planHas = subscription.featureFlags?.[featureKey] === true
  const override = await getFeatureOverride(organizationId, featureKey)
  return resolveFeatureAccess(planHas, override)
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

  // ACTIVE con período vencido: la sub no se renovó. Sin esto, una sub MANUAL
  // queda Premium para siempre (no hay webhook que la mueva a PAST_DUE).
  //   - MANUAL vencido → downgrade a Free (el admin la setea a mano; si no
  //     renovó, asumimos churn → mantiene acceso a plan gratis).
  //   - MERCADOPAGO/REBILL vencido → PAST_DUE y bloqueo (esperamos que el
  //     webhook resuelva el cobro; no descartar histórico de pago).
  if (
    subscription.status === "ACTIVE" &&
    subscription.planTipo === "PREMIUM" &&
    subscription.currentPeriodEnd &&
    new Date(subscription.currentPeriodEnd) <= new Date()
  ) {
    if (subscription.paymentProvider === "MANUAL") {
      await downgradeToFree(organizationId)
      return { hasAccess: true, trialInfo }
    }
    await markPastDue(organizationId)
    return { hasAccess: false, reason: "past_due", trialInfo }
  }

  // TRIALING (no expirado) o ACTIVE vigente = tiene acceso
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

/**
 * Marca una sub como PAST_DUE. Usado cuando vence el período de una sub
 * externa (MercadoPago/Rebill) sin que el webhook la renueve.
 */
async function markPastDue(organizationId: string): Promise<void> {
  try {
    if (await isSuperadminOrg(organizationId)) return
    await supabaseAdmin
      .from("subscriptions")
      .update({ status: "PAST_DUE", updated_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .eq("status", "ACTIVE")
  } catch (error) {
    console.error("[Subscriptions] Error marking past_due:", error)
  }
}

// Verificar si la organización tiene plan Premium (o está en trial activo)
export async function isPremium(organizationId: string): Promise<boolean> {
  const subscription = await getSubscriptionInfo(organizationId)

  if (!subscription) return false

  // Premium pagado y activo, con período vigente
  if (subscription.planTipo === "PREMIUM" && subscription.status === "ACTIVE") {
    if (subscription.currentPeriodEnd) {
      return new Date(subscription.currentPeriodEnd) > new Date()
    }
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
