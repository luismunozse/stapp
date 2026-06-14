import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { getSuperadminOrgId } from "@/lib/superadmin-org"

export async function GET() {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const primerDiaMes = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1
    )

    // Calculate 6 months ago for chart data
    const now = new Date()
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)

    // Id de la org del panel para filtrar de queries que joinean por
    // organization_id (ej. users). En queries directas sobre organizations
    // usamos .neq("slug","superadmin") directamente.
    const superadminOrgId = await getSuperadminOrgId()

    const totalUsersQuery = supabaseAdmin
      .from("users")
      .select("id", { count: "exact", head: true })
    if (superadminOrgId) totalUsersQuery.neq("organization_id", superadminOrgId)

    const results = await Promise.allSettled([
      // 0 - Total organizaciones (excluye org del panel admin y archivadas)
      supabaseAdmin
        .from("organizations")
        .select("id", { count: "exact", head: true })
        .neq("slug", "superadmin")
        .is("deleted_at", null),

      // 1 - Organizaciones activas
      supabaseAdmin
        .from("organizations")
        .select("id", { count: "exact", head: true })
        .eq("activo", true)
        .neq("slug", "superadmin")
        .is("deleted_at", null),

      // 2 - Total usuarios (excluye los del panel admin)
      totalUsersQuery,

      // 3 - Suscripciones Premium efectivas (mismo criterio que
      // lib/subscription-status.ts:isEffectivelyPremium para mantener
      // consistencia entre dashboard, /superadmin/suscripciones y
      // /superadmin/organizaciones).
      supabaseAdmin
        .from("subscriptions")
        .select("id, plans!inner(tipo)", { count: "exact", head: true })
        .eq("status", "ACTIVE")
        .not("payment_provider", "is", null)
        .eq("plans.tipo", "PREMIUM")
        .or(`current_period_end.is.null,current_period_end.gt.${new Date().toISOString()}`),

      // 4 - Ingresos del mes actual
      supabaseAdmin
        .from("subscription_payments")
        .select("amount")
        .eq("status", "SUCCEEDED")
        .gte("paid_at", primerDiaMes.toISOString()),

      // 5 - Nuevas organizaciones este mes
      supabaseAdmin
        .from("organizations")
        .select("id", { count: "exact", head: true })
        .gte("created_at", primerDiaMes.toISOString())
        .neq("slug", "superadmin")
        .is("deleted_at", null),

      // 6 - Organizaciones recientes
      supabaseAdmin
        .from("organizations")
        .select("id, nombre, slug, activo, created_at")
        .neq("slug", "superadmin")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(5),

      // 7 - Payments from last 6 months (for revenue chart)
      supabaseAdmin
        .from("subscription_payments")
        .select("amount, paid_at")
        .eq("status", "SUCCEEDED")
        .gte("paid_at", sixMonthsAgo.toISOString()),

      // 8 - Organizations created in last 6 months (for growth chart)
      supabaseAdmin
        .from("organizations")
        .select("id, created_at")
        .gte("created_at", sixMonthsAgo.toISOString())
        .neq("slug", "superadmin")
        .is("deleted_at", null),

      // 9 - All active subscriptions with plan type + payment provider
      // (for plan distribution chart). Necesitamos payment_provider para
      // distinguir Premium pagado de trials/free, mismo criterio que
      // isEffectivelyPremium.
      supabaseAdmin
        .from("subscriptions")
        .select("id, payment_provider, current_period_end, plans!inner(tipo)")
        .eq("status", "ACTIVE"),
    ])

    const safeValue = <T,>(result: PromiseSettledResult<T>): T | null =>
      result.status === "fulfilled" ? result.value : null

    const totalOrgsResult = safeValue(results[0])
    const activeOrgsResult = safeValue(results[1])
    const totalUsersResult = safeValue(results[2])
    const premiumSubscriptionsResult = safeValue(results[3])
    const monthlyRevenueResult = safeValue(results[4])
    const newOrgsThisMonthResult = safeValue(results[5])
    const recentOrgsResult = safeValue(results[6])
    const payments6mResult = safeValue(results[7])
    const orgs6mResult = safeValue(results[8])
    const planDistResult = safeValue(results[9])

    const failedQueries = results.filter((r) => r.status === "rejected").length

    const monthlyRevenue =
      monthlyRevenueResult?.data?.reduce(
        (s: number, p: { amount: number }) => s + (p.amount || 0),
        0
      ) || 0

    // Build monthly revenue for last 6 months
    const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
    const monthlyRevenue6m: { month: string; revenue: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      const label = `${monthNames[d.getMonth()]} ${d.getFullYear().toString().slice(-2)}`
      const revenue = (payments6mResult?.data || [])
        .filter((p: { amount: number; paid_at: string }) => p.paid_at?.startsWith(key))
        .reduce((s: number, p: { amount: number }) => s + (p.amount || 0), 0)
      monthlyRevenue6m.push({ month: label, revenue })
    }

    // Build org growth for last 6 months
    const orgGrowth6m: { month: string; count: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      const label = `${monthNames[d.getMonth()]} ${d.getFullYear().toString().slice(-2)}`
      const count = (orgs6mResult?.data || [])
        .filter((o: { id: string; created_at: string }) => o.created_at?.startsWith(key))
        .length
      orgGrowth6m.push({ month: label, count })
    }

    // Build plan distribution. Una sub cuenta como Premium SOLO si es
    // efectivamente Premium (tipo PREMIUM + payment_provider != null);
    // todo lo demás (incluyendo Premium en trial) cuenta como Free.
    // Misma definición que lib/subscription-status.ts.
    const planDistData = planDistResult?.data || []
    const nowIso = new Date()
    let premium = 0
    let free = 0
    for (const s of planDistData as Array<Record<string, unknown>>) {
      const plans = Array.isArray(s.plans) ? s.plans[0] : s.plans
      const tipo = (plans as Record<string, unknown> | null)?.tipo
      const cpe = s.current_period_end as string | null | undefined
      const expired = cpe ? new Date(cpe) <= nowIso : false
      if (tipo === "PREMIUM" && s.payment_provider != null && !expired) {
        premium++
      } else {
        free++
      }
    }
    const planDistribution = { free, premium }

    return NextResponse.json({
      totalOrganizations: totalOrgsResult?.count || 0,
      activeOrganizations: activeOrgsResult?.count || 0,
      totalUsers: totalUsersResult?.count || 0,
      premiumSubscriptions: premiumSubscriptionsResult?.count || 0,
      monthlyRevenue,
      newOrgsThisMonth: newOrgsThisMonthResult?.count || 0,
      recentOrganizations: recentOrgsResult?.data || [],
      monthlyRevenue6m,
      orgGrowth6m,
      planDistribution,
      failedQueries,
    })
  } catch (error) {
    console.error("Error fetching dashboard stats:", error)
    return NextResponse.json(
      { error: "Error al obtener estadísticas del dashboard" },
      { status: 500 }
    )
  }
}
