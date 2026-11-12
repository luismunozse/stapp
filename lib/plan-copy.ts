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
// (supabase/migrations/187_free_plan_v2_loosen.sql y 205 para sucursales).
// lib/subscriptions.ts usa este mismo objeto para el enforcement de las orgs
// sin suscripción, así que la landing y el límite real no pueden divergir.
export const FREE_PLAN_LIMITS_FALLBACK: PlanLimits = {
  ordenes: 30,
  tecnicos: 1,
  clientes: 200,
  vendedores: 1,
  storageMb: 100,
  sucursales: 1,
}

// Planes de fallback cuando la DB no está disponible (o en el cliente sin
// datos). Espejo de la tabla `plans` según las últimas migraciones.
export const FALLBACK_ALL_PLANS: AllPlansPrices = {
  free: {
    id: "fallback-free",
    slug: "free",
    nombre: "Free",
    tierOrder: 0,
    ars: { monthly: 0, yearly: 0 },
    usd: { monthly: 0, yearly: 0 },
    limits: FREE_PLAN_LIMITS_FALLBACK,
    featureFlags: {
      pos_sales: true,
      client_portal: true,
    },
  },
  profesional: {
    id: "fallback-profesional",
    slug: "profesional",
    nombre: "Profesional",
    tierOrder: 2,
    ars: { monthly: 19999, yearly: 149999 },
    usd: { monthly: 14, yearly: 107 },
    limits: {
      ordenes: null,
      tecnicos: null,
      clientes: null,
      vendedores: null,
      storageMb: 5000,
      sucursales: 3,
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
      facturacion_electronica: true,
      recepcion_multiple: true,
      reparaciones_express: true,
    },
  },
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

export function formatStorage(mb: number): string {
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

export function buildPricingFaqs(
  free: FreePlanInfo,
  allPlans: AllPlansPrices = FALLBACK_ALL_PLANS
): PricingFaq[] {
  const plans = allPlans.profesional ? allPlans : FALLBACK_ALL_PLANS
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
      answer: profesionalAnswer(plans),
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

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

function profesionalAnswer(plans: AllPlansPrices): string {
  const pro = plans.profesional
  const gained = featuresGained(pro, plans.free).map(lowerFirst)
  const limits = pro.limits
  const sinLimites = [
    limits.ordenes == null && "reparaciones",
    limits.tecnicos == null && "técnicos",
    limits.vendedores == null && "vendedores",
    limits.clientes == null && "clientes",
  ].filter((x): x is string => Boolean(x))
  const parts: string[] = ["Todo lo del plan Free"]
  if (sinLimites.length > 0) parts.push(`${joinSpanish(sinLimites)} sin límite`)
  if (limits.sucursales != null && limits.sucursales > 1) parts.push(`hasta ${limits.sucursales} sucursales`)
  if (limits.storageMb != null) parts.push(`${formatStorage(limits.storageMb)} de almacenamiento`)
  const base = parts.join(", ")
  return gained.length > 0
    ? `${base}. Además suma ${joinSpanish(gained)}.`
    : `${base}.`
}

function joinSpanish(items: string[]): string {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`
}

// ---------------------------------------------------------------------------
// Comparación de planes (landing y /precios)
// ---------------------------------------------------------------------------
//
// Las features listadas acá son SOLO las que el código realmente gatea por
// plan (hasPlanFeature en las rutas, o el flag del Free para POS y
// seguimiento). Cada fila lee el flag de la tabla `plans`, así que si desde
// superadmin se mueve una feature de plan, la landing, /precios y la
// comparación cambian solas. Lo que no está gateado (órdenes, clientes,
// inventario, caja...) va en CORE_FEATURES, incluido en todos los planes.

export interface PlanFeatureDef {
  key: string
  label: string
}

export const PLAN_FEATURES: PlanFeatureDef[] = [
  { key: "pos_sales", label: "Ventas de mostrador (POS)" },
  { key: "client_portal", label: "Tus clientes siguen su reparación online" },
  { key: "whatsapp_notifications", label: "Avisos automáticos por WhatsApp" },
  { key: "cotizaciones_online", label: "Presupuestos que tu cliente aprueba online" },
  { key: "advanced_reports", label: "Reportes avanzados del negocio" },
  { key: "facturacion_electronica", label: "Factura electrónica ARCA (Argentina)" },
  { key: "recepcion_multiple", label: "Recepción de varios equipos en un lote" },
  { key: "reparaciones_express", label: "Reparaciones express a cuenta corriente" },
  { key: "kiosk_mode", label: "Pantalla de estado para el local (kiosco)" },
  { key: "import_export", label: "Importar clientes e inventario desde Excel" },
  { key: "data_export", label: "Exportar reportes" },
]

export const CORE_FEATURES = [
  "Órdenes de trabajo con estados y fotos",
  "Clientes con historial de reparaciones",
  "Inventario de repuestos",
  "Caja diaria",
] as const

export type ComparisonValue = string | boolean

export interface ComparisonRow {
  label: string
  /** Un valor por plan, en el mismo orden que `plans`. */
  values: ComparisonValue[]
}

export interface PlanComparison {
  plans: Pick<PlanDetails, "slug" | "nombre">[]
  limitRows: ComparisonRow[]
  featureRows: ComparisonRow[]
}

function limitValue(n: number | null, unit?: (n: number) => string): string {
  if (n == null) return "Ilimitado"
  return unit ? unit(n) : String(n)
}

// Planes que se venden en la landing (las cards muestran estos dos). Si la DB
// no trae alguno, se usa el fallback para que la tabla nunca quede coja.
const MARKETED_PLAN_SLUGS = ["free", "profesional"] as const

function orderedPlans(allPlans: AllPlansPrices): PlanDetails[] {
  return MARKETED_PLAN_SLUGS.map((slug) => allPlans[slug] ?? FALLBACK_ALL_PLANS[slug]).sort(
    (a, b) => a.tierOrder - b.tierOrder
  )
}

export function buildPlanComparison(allPlans: AllPlansPrices): PlanComparison {
  const plans = orderedPlans(allPlans)
  const row = (label: string, pick: (p: PlanDetails) => ComparisonValue): ComparisonRow => ({
    label,
    values: plans.map(pick),
  })

  const limitRows: ComparisonRow[] = [
    row("Reparaciones por mes", (p) => limitValue(p.limits.ordenes)),
    row("Técnicos", (p) => limitValue(p.limits.tecnicos)),
    row("Vendedores", (p) => limitValue(p.limits.vendedores)),
    row("Clientes", (p) => limitValue(p.limits.clientes)),
    row("Sucursales", (p) => limitValue(p.limits.sucursales ?? null)),
    row("Almacenamiento", (p) => limitValue(p.limits.storageMb, formatStorage)),
  ]

  const featureRows: ComparisonRow[] = [
    ...CORE_FEATURES.map((label) => row(label, () => true)),
    ...PLAN_FEATURES.map((f) => row(f.label, (p) => p.featureFlags?.[f.key] === true)),
  ]

  return {
    plans: plans.map((p) => ({ slug: p.slug, nombre: p.nombre })),
    limitRows,
    featureRows,
  }
}

/**
 * Features gateadas que tiene `plan` y no tiene `base` (lo que suma subir de
 * plan). Sirve para las cards: el Free muestra lo que incluye y el Profesional
 * lo que agrega, sin listar funciones tachadas.
 */
export function featuresGained(plan: PlanDetails | undefined, base: PlanDetails | undefined): string[] {
  if (!plan) return []
  return PLAN_FEATURES.filter(
    (f) => plan.featureFlags?.[f.key] === true && base?.featureFlags?.[f.key] !== true
  ).map((f) => f.label)
}

/** Features gateadas que el plan incluye. */
export function featuresIncluded(plan: PlanDetails | undefined): string[] {
  if (!plan) return []
  return PLAN_FEATURES.filter((f) => plan.featureFlags?.[f.key] === true).map((f) => f.label)
}
