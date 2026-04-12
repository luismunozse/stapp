import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { parsePagination } from "@/lib/api-utils"
import type { OrganizationsListResponse, OrganizationsKpis } from "@/types/superadmin"

export async function GET(request: Request) {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search") || ""
    const status = searchParams.get("status") || ""
    const plan = searchParams.get("plan") || ""
    const sort = searchParams.get("sort") || ""
    const dir = searchParams.get("dir") || "desc"
    const { page, limit, offset } = parsePagination(searchParams)

    // ============================================================
    // Filtro de plan: lo aplicamos ANTES de paginar para que `total`
    // y la paginación sean correctos. La definición de "Premium efectivo"
    // debe coincidir con lib/subscription-status.ts e isEffectivelyPremium:
    //   tipo=PREMIUM AND status=ACTIVE AND payment_provider IS NOT NULL.
    // Antes este filtro se aplicaba a los 20 resultados de la página, lo
    // que rompía la paginación y devolvía conteos inconsistentes contra
    // /superadmin/suscripciones.
    // ============================================================
    let premiumOrgIds: string[] | null = null
    if (plan === "premium" || plan === "free") {
      const { data: premiumSubs, error: premiumErr } = await supabaseAdmin
        .from("subscriptions")
        .select("organization_id, plans!inner(tipo)")
        .eq("status", "ACTIVE")
        .not("payment_provider", "is", null)
        .eq("plans.tipo", "PREMIUM")

      if (premiumErr) throw premiumErr
      premiumOrgIds = (premiumSubs || []).map((s) => s.organization_id)
    }

    // Para el filtro "sin actividad en 30 días", obtener IDs
    let noActivityOrgIds: string[] | null = null
    if (status === "no_activity") {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      // Orgs que SÍ tuvieron actividad en los últimos 30 días
      const { data: activeOrgs } = await supabaseAdmin
        .from("audit_logs")
        .select("organization_id")
        .gte("created_at", thirtyDaysAgo)
      const activeOrgIds = [...new Set((activeOrgs || []).map((a) => a.organization_id))]

      // Obtener TODAS las org IDs para excluir las activas
      const { data: allOrgs } = await supabaseAdmin
        .from("organizations")
        .select("id")
      noActivityOrgIds = (allOrgs || [])
        .map((o) => o.id)
        .filter((id) => !activeOrgIds.includes(id))
    }

    // Ordenamiento dinámico
    const sortColumnMap: Record<string, string> = {
      nombre: "nombre",
      created_at: "created_at",
      activo: "activo",
    }
    const sortColumn = sortColumnMap[sort] || "created_at"
    const ascending = dir === "asc"

    // Query base para organizaciones
    let query = supabaseAdmin
      .from("organizations")
      .select(
        `
        id,
        nombre,
        slug,
        email,
        telefono,
        activo,
        created_at
      `,
        { count: "exact" }
      )
      .order(sortColumn, { ascending })

    // Filtro de búsqueda
    if (search) {
      query = query.or(
        `nombre.ilike.%${search}%,slug.ilike.%${search}%,email.ilike.%${search}%`
      )
    }

    // Filtro de estado
    if (status === "active") {
      query = query.eq("activo", true)
    } else if (status === "inactive") {
      query = query.eq("activo", false)
    } else if (status === "no_activity" && noActivityOrgIds) {
      if (noActivityOrgIds.length === 0) {
        return NextResponse.json({
          organizations: [],
          total: 0,
          page,
          limit,
        } satisfies OrganizationsListResponse)
      }
      query = query.in("id", noActivityOrgIds)
    }

    // Aplicar filtro de plan a nivel SQL
    if (plan === "premium") {
      if (!premiumOrgIds || premiumOrgIds.length === 0) {
        return NextResponse.json({
          organizations: [],
          total: 0,
          page,
          limit,
        } satisfies OrganizationsListResponse)
      }
      query = query.in("id", premiumOrgIds)
    } else if (plan === "free") {
      if (premiumOrgIds && premiumOrgIds.length > 0) {
        // Excluir las orgs que califican como Premium efectivo
        query = query.not(
          "id",
          "in",
          `(${premiumOrgIds.map((id) => `"${id}"`).join(",")})`
        )
      }
    }

    // Paginación
    query = query.range(offset, offset + limit - 1)

    const { data: organizations, error: dbError, count } = await query

    if (dbError) throw dbError

    // Obtener suscripciones y conteo de usuarios para cada organización
    const orgIds = organizations?.map((o) => o.id) || []

    let subscriptionsMap: Record<string, { id: string; status: string; payment_provider: string | null; plans: { id: string; nombre: string; tipo: string } | null }> = {}
    let usersCountMap: Record<string, number> = {}
    let lastActivityMap: Record<string, string> = {}

    if (orgIds.length > 0) {
      // Obtener suscripciones, conteo de usuarios y última actividad en paralelo
      const [{ data: subscriptions }, { data: usersCounts }, { data: lastActivities }] = await Promise.all([
        supabaseAdmin
          .from("subscriptions")
          .select(
            `
            id,
            organization_id,
            status,
            payment_provider,
            plans (
              id,
              nombre,
              tipo
            )
          `
          )
          .in("organization_id", orgIds),

        supabaseAdmin
          .from("users")
          .select("organization_id")
          .in("organization_id", orgIds),

        // Última actividad por org: max(created_at) de audit_logs
        // Usamos un select con order + limit por cada org es ineficiente,
        // así que traemos los registros más recientes agrupados con RPC
        // o con una subquery. Supabase no soporta GROUP BY directo,
        // así que traemos el log más reciente de cada org de la página.
        supabaseAdmin
          .from("audit_logs")
          .select("organization_id, created_at")
          .in("organization_id", orgIds)
          .order("created_at", { ascending: false }),
      ])

      subscriptionsMap = (subscriptions || []).reduce(
        (acc, sub) => {
          const plansData = Array.isArray(sub.plans) ? sub.plans[0] : sub.plans
          acc[sub.organization_id] = {
            id: sub.id,
            status: sub.status as string,
            payment_provider: (sub.payment_provider as string | null) ?? null,
            plans: plansData ?? null,
          }
          return acc
        },
        {} as typeof subscriptionsMap
      )

      usersCountMap = (usersCounts || []).reduce(
        (acc, user) => {
          acc[user.organization_id] = (acc[user.organization_id] || 0) + 1
          return acc
        },
        {} as Record<string, number>
      )

      // Solo guardamos la primera aparición (más reciente) por org
      lastActivityMap = (lastActivities || []).reduce(
        (acc, log) => {
          if (!acc[log.organization_id]) {
            acc[log.organization_id] = log.created_at
          }
          return acc
        },
        {} as Record<string, string>
      )
    }

    // Combinar datos. El filtro de plan ya se aplicó a nivel SQL más arriba
    // (ver bloque premiumOrgIds), no hace falta filtrar en memoria acá.
    let result = (organizations || []).map((org) => ({
      ...org,
      usersCount: usersCountMap[org.id] || 0,
      last_activity_at: lastActivityMap[org.id] || null,
      subscription: subscriptionsMap[org.id] || null,
    }))

    // Sort en memoria para columnas calculadas (usersCount, plan)
    if (sort === "usersCount") {
      result.sort((a, b) => ascending
        ? a.usersCount - b.usersCount
        : b.usersCount - a.usersCount)
    } else if (sort === "subscription") {
      result.sort((a, b) => {
        const planA = a.subscription?.plans?.nombre || "Free"
        const planB = b.subscription?.plans?.nombre || "Free"
        return ascending
          ? planA.localeCompare(planB)
          : planB.localeCompare(planA)
      })
    }

    // Calcular KPIs solo en la primera página (sin filtros) para eficiencia
    let kpis: OrganizationsKpis | undefined
    if (page === 1 && !search && !status && !plan) {
      const now = new Date()
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

      const [totalRes, trialRes, premiumRes, newRes] = await Promise.all([
        // Total de orgs activas
        supabaseAdmin
          .from("organizations")
          .select("id", { count: "exact", head: true })
          .eq("activo", true),
        // Activas en trial: plan FREE y activa (sin suscripción premium activa)
        // Son las orgs activas que NO están en premiumOrgIds
        supabaseAdmin
          .from("organizations")
          .select("id", { count: "exact", head: true })
          .eq("activo", true),
        // Premium: ya tenemos premiumOrgIds si lo calculamos antes, sino recalculamos
        premiumOrgIds
          ? Promise.resolve({ count: premiumOrgIds.length })
          : supabaseAdmin
              .from("subscriptions")
              .select("organization_id", { count: "exact", head: true })
              .eq("status", "ACTIVE")
              .not("payment_provider", "is", null)
              .eq("plans.tipo", "PREMIUM"),
        // Nuevas este mes
        supabaseAdmin
          .from("organizations")
          .select("id", { count: "exact", head: true })
          .gte("created_at", startOfMonth),
      ])

      // Para trial necesitamos restar las premium de las activas
      // Primero obtener premiumOrgIds si no los teníamos
      let premiumCount: number
      if (premiumOrgIds) {
        premiumCount = premiumOrgIds.length
      } else {
        const { data: premSubs } = await supabaseAdmin
          .from("subscriptions")
          .select("organization_id, plans!inner(tipo)")
          .eq("status", "ACTIVE")
          .not("payment_provider", "is", null)
          .eq("plans.tipo", "PREMIUM")
        premiumCount = premSubs?.length || 0
      }

      const totalOrgs = count || 0
      const activeTotal = totalRes.count || 0
      const activeTrial = activeTotal - premiumCount
      const newThisMonth = newRes.count || 0
      const conversionRate = totalOrgs > 0
        ? Math.round((premiumCount / totalOrgs) * 100 * 10) / 10
        : 0

      kpis = {
        totalOrgs,
        activeTrial: Math.max(0, activeTrial),
        premium: premiumCount,
        newThisMonth,
        conversionRate,
      }
    }

    const response: OrganizationsListResponse = {
      organizations: result as OrganizationsListResponse["organizations"],
      total: count || 0,
      page,
      limit,
      kpis,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error("Error fetching organizations:", error)
    return NextResponse.json(
      { error: "Error al obtener organizaciones" },
      { status: 500 }
    )
  }
}
