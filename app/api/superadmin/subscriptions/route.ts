import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { parsePagination } from "@/lib/api-utils"
import type { SubscriptionListItem } from "@/types/superadmin"

export async function GET(request: Request) {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status") || ""
    const plan = searchParams.get("plan") || ""
    const dateFrom = searchParams.get("dateFrom") || ""
    const dateTo = searchParams.get("dateTo") || ""
    const search = searchParams.get("search") || ""
    const sortBy = searchParams.get("sortBy") || "created_at"
    const sortDir = searchParams.get("sortDir") === "asc" ? true : false
    const { page, limit, offset } = parsePagination(searchParams)

    // Si hay búsqueda, primero buscar organizaciones que coincidan
    let orgIdsFilter: string[] | null = null
    if (search.trim().length >= 2) {
      const searchPattern = `%${search.trim()}%`
      const { data: matchingOrgs } = await supabaseAdmin
        .from("organizations")
        .select("id")
        .or(`nombre.ilike.${searchPattern},slug.ilike.${searchPattern},email.ilike.${searchPattern}`)
        .limit(100)

      orgIdsFilter = matchingOrgs?.map((o) => o.id) || []
      if (orgIdsFilter.length === 0) {
        // Sin resultados de búsqueda
        const countsResult = await supabaseAdmin.rpc("get_subscription_counts")
        return NextResponse.json({
          subscriptions: [],
          total: 0,
          page,
          limit,
          counts: countsResult.data || { active: 0, trialing: 0, expiredTrials: 0, canceled: 0, past_due: 0 },
        })
      }
    }

    // Query base para suscripciones
    let query = supabaseAdmin
      .from("subscriptions")
      .select(
        `
        id,
        organization_id,
        status,
        billing_period,
        payment_provider,
        current_period_end,
        trial_end,
        cancel_at_period_end,
        created_at,
        plan_id,
        plans (
          id,
          nombre,
          tipo
        )
      `,
        { count: "exact" }
      )

    // Ordenamiento
    const validSortColumns = ["created_at", "status", "trial_end", "current_period_end"]
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : "created_at"
    query = query.order(sortColumn, { ascending: sortDir, nullsFirst: false })

    // Filtro de búsqueda por org
    if (orgIdsFilter) {
      query = query.in("organization_id", orgIdsFilter)
    }

    // Filtro de estado
    if (status) {
      query = query.eq("status", status.toUpperCase())
    }

    // Filtro de plan
    if (plan === "premium") {
      query = query.eq("status", "ACTIVE").not("payment_provider", "is", null)
    } else if (plan === "free") {
      query = query.or("status.eq.TRIALING,payment_provider.is.null")
    }

    // Filtro de fechas
    if (dateFrom) {
      query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`)
    }
    if (dateTo) {
      query = query.lte("created_at", `${dateTo}T23:59:59.999Z`)
    }

    // Paginación
    query = query.range(offset, offset + limit - 1)

    const { data: subscriptions, error: dbError, count } = await query

    if (dbError) throw dbError

    // Obtener información de organizaciones
    const orgIds = subscriptions?.map((s) => s.organization_id) || []

    let orgsMap: Record<string, { id: string; nombre: string; slug: string; activo: boolean; created_at: string }> = {}

    if (orgIds.length > 0) {
      const { data: orgs } = await supabaseAdmin
        .from("organizations")
        .select("id, nombre, slug, activo, created_at")
        .in("id", orgIds)

      orgsMap = (orgs || []).reduce(
        (acc, org) => {
          acc[org.id] = org
          return acc
        },
        {} as Record<string, { id: string; nombre: string; slug: string; activo: boolean; created_at: string }>
      )
    }

    // Indicador de engagement: orgs con ordenes en últimos 7 días.
    // Solo aplica a orgs con más de 7 días de antigüedad — una org nueva
    // sin órdenes no es "en riesgo", simplemente acaba de empezar.
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    // Filtrar solo orgs con más de 7 días
    const matureOrgIds = orgIds.filter((id) => {
      const org = orgsMap[id]
      return org && new Date(org.created_at) < sevenDaysAgo
    })

    let engagementMap: Record<string, boolean | null> = {}
    if (matureOrgIds.length > 0) {
      // Considerar actividad como cualquier orden, venta o cliente nuevo en 7 días.
      // Limitar explícitamente para no chocar con el cap default de 1000 filas
      // de PostgREST: orgs con tráfico alto podrían dejar fuera a otras orgs.
      const [ordersRes, ventasRes, clientesRes] = await Promise.all([
        supabaseAdmin
          .from("ordenes_servicio")
          .select("organization_id")
          .in("organization_id", matureOrgIds)
          .gte("created_at", sevenDaysAgo.toISOString())
          .limit(50000),
        supabaseAdmin
          .from("ventas")
          .select("organization_id")
          .in("organization_id", matureOrgIds)
          .gte("created_at", sevenDaysAgo.toISOString())
          .limit(50000),
        supabaseAdmin
          .from("clientes")
          .select("organization_id")
          .in("organization_id", matureOrgIds)
          .gte("created_at", sevenDaysAgo.toISOString())
          .limit(50000),
      ])

      const activeOrgSet = new Set<string>()
      for (const o of ordersRes.data || []) activeOrgSet.add(o.organization_id)
      for (const v of ventasRes.data || []) activeOrgSet.add(v.organization_id)
      for (const c of clientesRes.data || []) activeOrgSet.add(c.organization_id)

      for (const id of matureOrgIds) {
        engagementMap[id] = activeOrgSet.has(id)
      }
    }
    // Orgs nuevas (<7 días) no tienen indicador de engagement
    for (const id of orgIds) {
      if (!(id in engagementMap)) {
        engagementMap[id] = null
      }
    }

    // Combinar datos
    const result = (subscriptions || []).map((sub) => {
      const plansData = Array.isArray(sub.plans) ? sub.plans[0] : sub.plans
      return {
        id: sub.id,
        status: sub.status,
        billing_period: sub.billing_period,
        payment_provider: sub.payment_provider,
        current_period_end: sub.current_period_end,
        trial_end: sub.trial_end,
        cancel_at_period_end: sub.cancel_at_period_end,
        created_at: sub.created_at,
        organization: orgsMap[sub.organization_id] || null,
        plans: plansData || null,
        // null = org nueva (<7 días) → no se muestra ni warning ni indicador.
        // Importante NO usar `?? false` porque colapsa null en false y dispara
        // el warning amber para todas las orgs recién creadas.
        hasRecentActivity: engagementMap[sub.organization_id] ?? null,
      }
    })

    // Counts optimizados con un solo query (mejora 9)
    const countsResult = await supabaseAdmin.rpc("get_subscription_counts")

    return NextResponse.json({
      subscriptions: result,
      total: count || 0,
      page,
      limit,
      counts: countsResult.data || { active: 0, trialing: 0, expiredTrials: 0, canceled: 0, past_due: 0 },
    })
  } catch (error) {
    console.error("Error fetching subscriptions:", error)
    return NextResponse.json(
      { error: "Error al obtener suscripciones" },
      { status: 500 }
    )
  }
}
