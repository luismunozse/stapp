// Copy de marketing de los planes derivado de los límites reales.
//
// Fuente de verdad: tabla `plans` (slug='free'), que el server lee con
// getAllPlanPrices() en lib/pricing.ts. Este módulo es puro (sin supabase)
// para poder usarlo tanto en la card de la landing (client component) como
// en el FAQ de /precios (server component) sin duplicar números.

import type { AllPlansPrices, PlanDetails } from "@/lib/pricing"

export type PlanLimits = PlanDetails["limits"]

// Fallback cuando la DB no está disponible. Debe coincidir con lo seteado en
// plans.slug='free' por la última migración que tocó límites
// (supabase/migrations/187_free_plan_v2_loosen.sql) y con FREE_PLAN_LIMITS de
// lib/subscriptions.ts, que es lo que el enforcement usa sin suscripción.
export const FREE_PLAN_LIMITS_FALLBACK: PlanLimits = {
  ordenes: 30,
  tecnicos: 1,
  clientes: 200,
  vendedores: 1,
  storageMb: 100,
}

// El portal público de seguimiento (/seguimiento/[token]) no tiene gating por
// plan: está en todos los planes (migraciones 147 y 266).
const FREE_CLIENT_PORTAL_FALLBACK = true

export interface FreePlanInfo {
  limits: PlanLimits
  clientPortal: boolean
}

export function getFreePlanInfo(allPlans?: AllPlansPrices): FreePlanInfo {
  const free = allPlans?.free
  if (!free) {
    return { limits: FREE_PLAN_LIMITS_FALLBACK, clientPortal: FREE_CLIENT_PORTAL_FALLBACK }
  }
  return {
    limits: free.limits,
    clientPortal: free.featureFlags?.client_portal === true,
  }
}

function formatStorage(mb: number): string {
  if (mb >= 1000 && mb % 1000 === 0) return `${mb / 1000}GB`
  return `${mb}MB`
}

/** "Hasta 30 reparaciones por mes" / "Reparaciones ilimitadas". */
export function freeOrdersText(limits: PlanLimits): string {
  return limits.ordenes == null
    ? "Reparaciones ilimitadas"
    : `Hasta ${limits.ordenes} reparaciones por mes`
}

/** Resumen de límites del plan Free para el FAQ. */
export function freeLimitsSummary(limits: PlanLimits): string {
  const parts: string[] = []
  parts.push(
    limits.ordenes == null ? "órdenes ilimitadas" : `hasta ${limits.ordenes} órdenes por mes`
  )
  if (limits.tecnicos != null) {
    parts.push(`${limits.tecnicos} ${limits.tecnicos === 1 ? "técnico" : "técnicos"}`)
  }
  if (limits.clientes != null) parts.push(`hasta ${limits.clientes} clientes`)
  if (limits.storageMb != null) parts.push(`${formatStorage(limits.storageMb)} de almacenamiento`)
  return parts.join(", ")
}

export interface PricingFaq {
  question: string
  answer: string
}

export function buildPricingFaqs(free: FreePlanInfo): PricingFaq[] {
  const freeExtras = [
    "punto de venta (POS)",
    ...(free.clientPortal ? ["portal de seguimiento para tus clientes"] : []),
    "inventario básico",
  ]

  return [
    {
      question: "¿Cuánto cuesta STApp?",
      answer:
        "STApp tiene un plan Free gratuito para siempre con funciones básicas, y un plan Profesional con todas las funciones desbloqueadas. Al registrarte, tenés 30 días gratis con acceso total al plan Profesional. Los pagos se hacen con MercadoPago, en pesos argentinos.",
    },
    {
      question: "¿Puedo probar STApp gratis?",
      answer:
        "Sí, al registrarte tenés 30 días con acceso completo al plan Profesional, sin tarjeta de crédito. Si no te convence, tu cuenta pasa automáticamente al plan Free sin perder tus datos.",
    },
    {
      question: "¿Qué incluye el plan Profesional?",
      answer:
        "El plan Profesional incluye: órdenes de trabajo ilimitadas, gestión de clientes, control de inventario con alertas, punto de venta con garantías, cotizaciones con aprobación online, notificaciones por WhatsApp, portal de seguimiento para clientes, 15+ reportes avanzados, técnicos y vendedores ilimitados, modo kiosco, tu logo en presupuestos, y soporte prioritario.",
    },
    {
      question: "¿Qué incluye el plan Free?",
      answer: `El plan Free incluye ${freeLimitsSummary(free.limits)}, además de ${joinSpanish(freeExtras)}. Es ideal para conocer STApp y para talleres chicos.`,
    },
    {
      question: "¿Puedo cancelar en cualquier momento?",
      answer:
        "Sí, podés cancelar tu suscripción cuando quieras sin penalidades ni cargos ocultos. Tu cuenta pasa al plan Free y mantenés todos tus datos.",
    },
    {
      question: "¿Cómo se paga?",
      answer:
        "Con MercadoPago, en pesos argentinos. Por ahora no cobramos en dólares ni en otras monedas.",
    },
  ]
}

function joinSpanish(items: string[]): string {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`
}
