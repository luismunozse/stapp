import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { getSuperadminOrgId } from "@/lib/superadmin-org"
import { montosDesdeRpc } from "@/lib/superadmin-montos"

const MONTH_NAMES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

export async function GET() {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    // Meses en UTC: superadmin_ingresos_por_mes agrupa por mes UTC.
    const now = new Date()
    const meses = Array.from({ length: 6 }, (_, idx) => {
      const i = 5 - idx
      const desde = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
      const hasta = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1))
      const key = `${desde.getUTCFullYear()}-${String(desde.getUTCMonth() + 1).padStart(2, "0")}`
      const label = `${MONTH_NAMES[desde.getUTCMonth()]} ${desde.getUTCFullYear().toString().slice(-2)}`
      return { key, label, desde, hasta }
    })
    const primerDiaMes = meses[5].desde
    const sixMonthsAgo = meses[0].desde

    // Id de la org del panel para filtrar de queries que joinean por
    // organization_id (ej. users). En queries directas sobre organizations
    // usamos .neq("slug","superadmin") directamente.
    const superadminOrgId = await getSuperadminOrgId()

    const totalUsersQuery = supabaseAdmin
      .from("users")
      .select("id", { count: "exact", head: true })
    if (superadminOrgId) totalUsersQuery.neq("organization_id", superadminOrgId)

    // Todo lo que es un conteo va con count/head y lo que es una suma con un
    // RPC: una lectura de filas se corta en 1000 sin error (PostgREST max_rows).
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
        .or(`current_period_end.is.null,current_period_end.gt.${now.toISOString()}`),

      // 4 - Ingresos cobrados por mes y moneda (últimos 6 meses, incluye el actual)
      supabaseAdmin.rpc("superadmin_ingresos_por_mes", { p_desde: sixMonthsAgo.toISOString() }),

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

      // 7 - Suscripciones ACTIVE con plan (para la distribución: free = esto - premium)
      supabaseAdmin
        .from("subscriptions")
        .select("id, plans!inner(tipo)", { count: "exact", head: true })
        .eq("status", "ACTIVE"),

      // 8..13 - Organizaciones creadas en cada uno de los últimos 6 meses
      ...meses.map((m) =>
        supabaseAdmin
          .from("organizations")
          .select("id", { count: "exact", head: true })
          .gte("created_at", m.desde.toISOString())
          .lt("created_at", m.hasta.toISOString())
          .neq("slug", "superadmin")
          .is("deleted_at", null)
      ),
    ])

    // Una consulta "falla" si la promesa se rechaza o si Supabase devuelve error
    // (Supabase no rechaza: resuelve con { error }). Lo que falla se cuenta en
    // failedQueries para que el panel avise, en vez de mostrarse como 0.
    type Resultado = { data?: any; count?: number | null; error?: unknown }
    const safeValue = (result: PromiseSettledResult<unknown>): Resultado | null => {
      if (result.status !== "fulfilled") return null
      const value = result.value as Resultado
      return value?.error ? null : value
    }
    const failedQueries = results.filter((r) => safeValue(r) === null).length

    const totalOrgsResult = safeValue(results[0])
    const activeOrgsResult = safeValue(results[1])
    const totalUsersResult = safeValue(results[2])
    const premiumSubscriptionsResult = safeValue(results[3])
    const ingresosResult = safeValue(results[4])
    const newOrgsThisMonthResult = safeValue(results[5])
    const recentOrgsResult = safeValue(results[6])
    const activeSubsResult = safeValue(results[7])
    const orgsPorMes = meses.map((_, i) => safeValue(results[8 + i]))

    // Ingresos: nunca se suman monedas distintas. El gráfico muestra una moneda
    // (ARS si hay pagos en ARS) y cada mes trae el detalle por moneda.
    const ingresos = (ingresosResult?.data ?? []) as Array<{ mes: string; moneda: string; total: number | string }>
    const monthlyRevenueByCurrency = ingresosResult
      ? montosDesdeRpc(ingresos.filter((r) => r.mes === meses[5].key))
      : null
    const monedas = [...new Set(ingresos.map((r) => r.moneda))]
    const revenueCurrency = monedas.includes("ARS") || monedas.length === 0 ? "ARS" : monedas.sort()[0]
    const monthlyRevenue6m = meses.map((m) => {
      const porMoneda: Record<string, number> = {}
      for (const r of ingresos) if (r.mes === m.key) porMoneda[r.moneda] = Number(r.total) || 0
      return { month: m.label, revenue: porMoneda[revenueCurrency] ?? 0, porMoneda }
    })

    const orgGrowth6m = meses.map((m, i) => ({ month: m.label, count: orgsPorMes[i]?.count ?? 0 }))

    // Distribución de planes. Una sub cuenta como Premium SOLO si es
    // efectivamente Premium (mismo conteo que premiumSubscriptions); todo lo
    // demás con plan (incluyendo Premium en trial) cuenta como Free.
    const premium = premiumSubscriptionsResult?.count ?? 0
    const planDistribution = {
      premium,
      free: Math.max(0, (activeSubsResult?.count ?? 0) - premium),
    }

    return NextResponse.json({
      totalOrganizations: totalOrgsResult?.count || 0,
      activeOrganizations: activeOrgsResult?.count || 0,
      totalUsers: totalUsersResult?.count || 0,
      premiumSubscriptions: premiumSubscriptionsResult?.count || 0,
      monthlyRevenueByCurrency,
      revenueCurrency,
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
