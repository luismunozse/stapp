import { supabaseAdmin } from "@/lib/supabase"

export interface PlanPrices {
  ars: { monthly: number; yearly: number }
  usd: { monthly: number; yearly: number }
}

export interface PlanDetails extends PlanPrices {
  id: string
  slug: string
  nombre: string
  tierOrder: number
  limits: {
    ordenes: number | null
    tecnicos: number | null
    clientes: number | null
    vendedores: number | null
    storageMb: number | null
  }
  featureFlags: Record<string, boolean>
}

export type AllPlansPrices = Record<string, PlanDetails>

// Valores de fallback en caso de que la DB no esté disponible
const FALLBACK_PRICES: PlanPrices = {
  ars: { monthly: 19999, yearly: 191990 },
  usd: { monthly: 14, yearly: 134 },
}

const FALLBACK_ALL_PLANS: AllPlansPrices = {
  emprendedor: {
    id: "fallback-emprendedor",
    slug: "emprendedor",
    nombre: "Emprendedor",
    tierOrder: 1,
    ars: { monthly: 10999, yearly: 105590 },
    usd: { monthly: 8, yearly: 77 },
    limits: {
      ordenes: 500,
      tecnicos: 1,
      clientes: null,
      vendedores: 2,
      storageMb: 1000,
    },
    featureFlags: {
      pos_sales: true,
      fotos_etapa: true,
      garantias: true,
      firma_digital: true,
      cuenta_corriente: true,
    },
  },
  profesional: {
    id: "fallback-profesional",
    slug: "profesional",
    nombre: "Profesional",
    tierOrder: 2,
    ars: { monthly: 19999, yearly: 191990 },
    usd: { monthly: 14, yearly: 134 },
    limits: {
      ordenes: null,
      tecnicos: null,
      clientes: null,
      vendedores: null,
      storageMb: 5000,
    },
    featureFlags: {
      advanced_reports: true,
      whatsapp_notifications: true,
      kiosk_mode: true,
      pos_sales: true,
      client_portal: true,
      data_export: true,
      custom_logo: true,
      cuenta_corriente: true,
      cotizaciones_online: true,
      gestion_proveedores: true,
      import_export: true,
      firma_digital: true,
      fotos_etapa: true,
      garantias: true,
    },
  },
}

// Cache en memoria con TTL de 5 minutos
let cachedAllPlans: AllPlansPrices | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 5 * 60 * 1000

/**
 * Obtiene todos los planes activos desde la DB, indexados por slug.
 * Esta es la función principal de pricing — reemplaza getPremiumPrices()
 * que asumía un único plan.
 */
export async function getAllPlanPrices(): Promise<AllPlansPrices> {
  const now = Date.now()

  if (cachedAllPlans && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedAllPlans
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("plans")
      .select(
        "id, slug, nombre, tier_order, precio_mensual, precio_anual, precio_mensual_usd, precio_anual_usd, limite_ordenes, limite_tecnicos, limite_clientes, limite_vendedores, limite_storage_mb, feature_flags"
      )
      .eq("activo", true)
      .order("tier_order", { ascending: true })

    if (error || !data || data.length === 0) {
      console.error("[Pricing] Error fetching plans:", error)
      return cachedAllPlans || FALLBACK_ALL_PLANS
    }

    const plans: AllPlansPrices = {}
    for (const row of data) {
      // Solo planes con slug (los 3-tier activos)
      if (!row.slug) continue
      plans[row.slug] = {
        id: row.id,
        slug: row.slug,
        nombre: row.nombre,
        tierOrder: row.tier_order ?? 0,
        ars: {
          monthly: Number(row.precio_mensual) || 0,
          yearly: Number(row.precio_anual) || 0,
        },
        usd: {
          monthly: Number(row.precio_mensual_usd) || 0,
          yearly: Number(row.precio_anual_usd) || 0,
        },
        limits: {
          ordenes: row.limite_ordenes,
          tecnicos: row.limite_tecnicos,
          clientes: row.limite_clientes,
          vendedores: row.limite_vendedores,
          storageMb: row.limite_storage_mb,
        },
        featureFlags:
          (row.feature_flags as Record<string, boolean>) || {},
      }
    }

    // Si la query devolvió planes pero ninguno tiene slug (pre-migración),
    // usar el fallback
    if (Object.keys(plans).length === 0) {
      return cachedAllPlans || FALLBACK_ALL_PLANS
    }

    cachedAllPlans = plans
    cacheTimestamp = now

    return plans
  } catch (err) {
    console.error("[Pricing] Unexpected error:", err)
    return cachedAllPlans || FALLBACK_ALL_PLANS
  }
}

/**
 * Wrapper legacy: retorna los precios del plan Profesional.
 * Mantener para compatibilidad con landing page existente que espera PlanPrices.
 * @deprecated Usar getAllPlanPrices() para obtener todos los planes.
 */
export async function getPremiumPrices(): Promise<PlanPrices> {
  const allPlans = await getAllPlanPrices()
  const profesional = allPlans.profesional

  if (!profesional) {
    return FALLBACK_PRICES
  }

  return {
    ars: profesional.ars,
    usd: profesional.usd,
  }
}

/**
 * Busca un plan específico por slug. Retorna null si no existe.
 */
export async function getPlanBySlug(slug: string): Promise<PlanDetails | null> {
  const allPlans = await getAllPlanPrices()
  return allPlans[slug] || null
}

/**
 * Invalida el cache de precios (útil cuando se actualizan desde superadmin).
 */
export function invalidatePricesCache() {
  cachedAllPlans = null
  cacheTimestamp = 0
}
