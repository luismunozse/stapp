import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Detecta posibles anomalías en suscripciones — específicamente las que
 * pudieron haber sido extendidas dos veces (manual + webhook MP, o dos
 * pagos manuales seguidos).
 *
 * Reglas:
 *  1. **Período inflado**: subs ACTIVE cuyo current_period_end queda
 *     más de 13 meses adelante para billing MENSUAL, o más de 24 meses
 *     para ANUAL. Indica probable doble extensión.
 *
 *  2. **Pagos múltiples en ventana corta**: orgs con más de 1 fila en
 *     subscription_payments en las últimas 48h. Casi siempre legítimo
 *     si todos son del mismo provider, pero si mezcla MANUAL+MERCADOPAGO
 *     es bandera roja.
 *
 * Devuelve un resumen liviano para mostrar como widget en el dashboard
 * superadmin. Si hay 0 anomalías, el widget se oculta.
 */
export async function GET() {
  const { error } = await requireSuperadmin()
  if (error) return error

  const now = new Date()
  const nowIso = now.toISOString()

  // Umbrales (en meses) por billing_period
  const thresholdMonthly = new Date(now)
  thresholdMonthly.setMonth(thresholdMonthly.getMonth() + 13)
  const thresholdYearly = new Date(now)
  thresholdYearly.setMonth(thresholdYearly.getMonth() + 24)

  // 1. Subs con período inflado
  const { data: inflatedMonthly } = await supabaseAdmin
    .from("subscriptions")
    .select("id, organization_id, billing_period, current_period_end, payment_provider")
    .eq("status", "ACTIVE")
    .eq("billing_period", "MONTHLY")
    .gt("current_period_end", thresholdMonthly.toISOString())

  const { data: inflatedYearly } = await supabaseAdmin
    .from("subscriptions")
    .select("id, organization_id, billing_period, current_period_end, payment_provider")
    .eq("status", "ACTIVE")
    .eq("billing_period", "YEARLY")
    .gt("current_period_end", thresholdYearly.toISOString())

  const inflated = [...(inflatedMonthly || []), ...(inflatedYearly || [])]

  // 2. Pagos múltiples en ventana de 48h, mezclando providers
  const since48h = new Date(now)
  since48h.setHours(since48h.getHours() - 48)

  const { data: recentPayments } = await supabaseAdmin
    .from("subscription_payments")
    .select("id, organization_id, payment_provider, amount, paid_at")
    .gte("paid_at", since48h.toISOString())
    .eq("status", "SUCCEEDED")
    .order("paid_at", { ascending: false })

  const paymentsByOrg = new Map<
    string,
    Array<{ id: string; payment_provider: string; amount: number; paid_at: string }>
  >()
  for (const p of recentPayments || []) {
    const list = paymentsByOrg.get(p.organization_id) || []
    list.push({
      id: p.id,
      payment_provider: p.payment_provider,
      amount: Number(p.amount) || 0,
      paid_at: p.paid_at,
    })
    paymentsByOrg.set(p.organization_id, list)
  }

  const mixedProviderOrgs: Array<{
    organization_id: string
    payments: Array<{
      id: string
      payment_provider: string
      amount: number
      paid_at: string
    }>
  }> = []
  for (const [orgId, list] of paymentsByOrg.entries()) {
    if (list.length < 2) continue
    const providers = new Set(list.map((p) => p.payment_provider))
    if (providers.size > 1) {
      mixedProviderOrgs.push({ organization_id: orgId, payments: list })
    }
  }

  // Resolver nombres de organizaciones para todos los IDs únicos
  const orgIds = Array.from(
    new Set([
      ...inflated.map((s) => s.organization_id),
      ...mixedProviderOrgs.map((m) => m.organization_id),
    ])
  )

  let orgsMap: Record<string, { nombre: string; slug: string }> = {}
  if (orgIds.length > 0) {
    const { data: orgs } = await supabaseAdmin
      .from("organizations")
      .select("id, nombre, slug")
      .in("id", orgIds)
    orgsMap = (orgs || []).reduce(
      (acc, o) => {
        acc[o.id] = { nombre: o.nombre, slug: o.slug }
        return acc
      },
      {} as Record<string, { nombre: string; slug: string }>
    )
  }

  return NextResponse.json({
    generatedAt: nowIso,
    inflatedPeriod: inflated.map((s) => ({
      ...s,
      organization: orgsMap[s.organization_id] || null,
    })),
    mixedProviderPayments: mixedProviderOrgs.map((m) => ({
      ...m,
      organization: orgsMap[m.organization_id] || null,
    })),
    totals: {
      inflatedPeriod: inflated.length,
      mixedProviderPayments: mixedProviderOrgs.length,
    },
  })
}
