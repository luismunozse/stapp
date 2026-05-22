import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import type { SuperadminStats } from "@/types/superadmin"

export async function GET() {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const primerDiaMes = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1
    )

    const [
      totalOrgsResult,
      activeOrgsResult,
      totalUsersResult,
      activeSubscriptionsResult,
      monthlyRevenueResult,
      newOrgsThisMonthResult,
      recentPaymentsResult,
    ] = await Promise.all([
      // Total organizaciones
      supabaseAdmin
        .from("organizations")
        .select("id", { count: "exact", head: true }),

      // Organizaciones activas
      supabaseAdmin
        .from("organizations")
        .select("id", { count: "exact", head: true })
        .eq("activo", true),

      // Total usuarios
      supabaseAdmin
        .from("users")
        .select("id", { count: "exact", head: true }),

      // Suscripciones activas (PREMIUM efectivas).
      // Misma definición que lib/subscription-status.ts:isEffectivelyPremium
      // y que el filtro plan=premium en /api/superadmin/organizations.
      // Antes este conteo aceptaba cualquier ACTIVE con plan_id != null,
      // por lo que mostraba en el dashboard un número distinto al de
      // /superadmin/suscripciones filtrado por Premium.
      supabaseAdmin
        .from("subscriptions")
        .select("id, plans!inner(tipo)", { count: "exact", head: true })
        .eq("status", "ACTIVE")
        .not("payment_provider", "is", null)
        .eq("plans.tipo", "PREMIUM")
        .or(`current_period_end.is.null,current_period_end.gt.${new Date().toISOString()}`),

      // Ingresos del mes actual
      supabaseAdmin
        .from("subscription_payments")
        .select("amount")
        .eq("status", "SUCCEEDED")
        .gte("paid_at", primerDiaMes.toISOString()),

      // Nuevas organizaciones este mes
      supabaseAdmin
        .from("organizations")
        .select("id", { count: "exact", head: true })
        .gte("created_at", primerDiaMes.toISOString()),

      // Últimos 5 pagos
      supabaseAdmin
        .from("subscription_payments")
        .select(
          `
          id,
          amount,
          currency,
          status,
          paid_at,
          created_at,
          organization_id
        `
        )
        .eq("status", "SUCCEEDED")
        .order("paid_at", { ascending: false })
        .limit(5),
    ])

    // Obtener nombres de organizaciones para los pagos recientes
    const recentPayments = recentPaymentsResult.data || []
    const orgIds = [...new Set(recentPayments.map((p) => p.organization_id))]

    let orgsMap: Record<string, { nombre: string; slug: string }> = {}
    if (orgIds.length > 0) {
      const { data: orgs } = await supabaseAdmin
        .from("organizations")
        .select("id, nombre, slug")
        .in("id", orgIds)

      orgsMap = (orgs || []).reduce(
        (acc, org) => {
          acc[org.id] = { nombre: org.nombre, slug: org.slug }
          return acc
        },
        {} as Record<string, { nombre: string; slug: string }>
      )
    }

    const paymentsWithOrg = recentPayments.map((p) => ({
      ...p,
      organization: orgsMap[p.organization_id] || null,
    }))

    const monthlyRevenue =
      monthlyRevenueResult.data?.reduce((sum, p) => sum + (p.amount || 0), 0) ||
      0

    const stats: SuperadminStats = {
      totalOrganizations: totalOrgsResult.count || 0,
      activeOrganizations: activeOrgsResult.count || 0,
      totalUsers: totalUsersResult.count || 0,
      activeSubscriptions: activeSubscriptionsResult.count || 0,
      monthlyRevenue,
      newOrgsThisMonth: newOrgsThisMonthResult.count || 0,
      recentPayments: paymentsWithOrg as any,
    }

    return NextResponse.json(stats)
  } catch (error) {
    console.error("Error fetching superadmin stats:", error)
    return NextResponse.json(
      { error: "Error al obtener estadísticas" },
      { status: 500 }
    )
  }
}
