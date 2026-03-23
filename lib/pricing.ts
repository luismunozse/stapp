import { supabaseAdmin } from "@/lib/supabase"

export interface PlanPrices {
  ars: { monthly: number; yearly: number }
  usd: { monthly: number; yearly: number }
}

// Valores de fallback en caso de que la DB no esté disponible
const FALLBACK_PRICES: PlanPrices = {
  ars: { monthly: 19999, yearly: 191990 },
  usd: { monthly: 14, yearly: 134 },
}

// Cache en memoria con TTL de 5 minutos
let cachedPrices: PlanPrices | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 5 * 60 * 1000

/**
 * Obtiene los precios del plan Premium desde la base de datos.
 * Usa cache en memoria de 5 minutos para no hacer queries innecesarias.
 * Si la DB no responde, usa valores de fallback.
 */
export async function getPremiumPrices(): Promise<PlanPrices> {
  const now = Date.now()

  // Retornar cache si es válido
  if (cachedPrices && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedPrices
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("plans")
      .select("precio_mensual, precio_anual, precio_mensual_usd, precio_anual_usd")
      .eq("tipo", "PREMIUM")
      .eq("activo", true)
      .single()

    if (error || !data) {
      console.error("[Pricing] Error fetching prices:", error)
      return cachedPrices || FALLBACK_PRICES
    }

    const prices: PlanPrices = {
      ars: {
        monthly: Number(data.precio_mensual),
        yearly: Number(data.precio_anual),
      },
      usd: {
        monthly: Number(data.precio_mensual_usd),
        yearly: Number(data.precio_anual_usd),
      },
    }

    // Actualizar cache
    cachedPrices = prices
    cacheTimestamp = now

    return prices
  } catch (err) {
    console.error("[Pricing] Unexpected error:", err)
    return cachedPrices || FALLBACK_PRICES
  }
}

/**
 * Invalida el cache de precios (útil cuando se actualizan desde superadmin).
 */
export function invalidatePricesCache() {
  cachedPrices = null
  cacheTimestamp = 0
}
