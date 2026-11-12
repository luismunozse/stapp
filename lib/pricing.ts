import { unstable_cache, revalidateTag } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase"
import { FALLBACK_ALL_PLANS } from "@/lib/plan-copy"

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
    sucursales: number | null
  }
  featureFlags: Record<string, boolean>
}

export type AllPlansPrices = Record<string, PlanDetails>

// Valores de fallback en caso de que la DB no esté disponible
const FALLBACK_PRICES: PlanPrices = {
  ars: { monthly: 19999, yearly: 149999 },
  usd: { monthly: 14, yearly: 107 },
}

// Cache compartido (Data Cache de Next) con revalidación cada 5 minutos: la
// landing, /precios y el chatbot leen los planes sin pegarle a Supabase en
// cada request. Si la consulta falla se tira el error para que NO se guarde el
// fallback en la cache; el próximo request vuelve a intentar.
// Los cambios desde superadmin invalidan el tag con invalidatePricesCache().
const PLANS_CACHE_TAG = "plans"
const PLANS_REVALIDATE_SECONDS = 300

async function fetchActivePlans(): Promise<AllPlansPrices> {
  const { data, error } = await supabaseAdmin
    .from("plans")
    .select(
      "id, slug, nombre, tier_order, precio_mensual, precio_anual, precio_mensual_usd, precio_anual_usd, limite_ordenes, limite_tecnicos, limite_clientes, limite_vendedores, limite_storage_mb, limite_sucursales, feature_flags"
    )
    .eq("activo", true)
    .order("tier_order", { ascending: true })

  if (error || !data || data.length === 0) {
    throw new Error(`[Pricing] Error fetching plans: ${error?.message ?? "sin planes activos"}`)
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
        sucursales: row.limite_sucursales ?? null,
      },
      featureFlags:
        (row.feature_flags as Record<string, boolean>) || {},
    }
  }

  // Si la query devolvió planes pero ninguno tiene slug (pre-migración),
  // usar el fallback
  if (Object.keys(plans).length === 0) {
    throw new Error("[Pricing] Ningún plan activo tiene slug")
  }

  return plans
}

const fetchActivePlansCached = unstable_cache(fetchActivePlans, ["plans-activos"], {
  revalidate: PLANS_REVALIDATE_SECONDS,
  tags: [PLANS_CACHE_TAG],
})

/**
 * Obtiene todos los planes activos desde la DB, indexados por slug.
 * Esta es la función principal de pricing — reemplaza getPremiumPrices()
 * que asumía un único plan.
 */
export async function getAllPlanPrices(): Promise<AllPlansPrices> {
  try {
    return await fetchActivePlansCached()
  } catch (err) {
    console.error(err)
    return FALLBACK_ALL_PLANS
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
  // expire: 0 → la próxima lectura ya trae el precio nuevo (lo usa el cobro de
  // MercadoPago), en vez de servir el viejo mientras revalida.
  revalidateTag(PLANS_CACHE_TAG, { expire: 0 })
}
