import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { parsePagination } from "@/lib/api-utils"
import type { SubscriptionsListResponse, SubscriptionListItem } from "@/types/superadmin"

export async function GET(request: Request) {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status") || ""
    const plan = searchParams.get("plan") || ""
    const dateFrom = searchParams.get("dateFrom") || ""
    const dateTo = searchParams.get("dateTo") || ""
    const { page, limit, offset } = parsePagination(searchParams)

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
      .order("created_at", { ascending: false })

    // Filtro de estado
    if (status) {
      query = query.eq("status", status.toUpperCase())
    }

    // Filtro de plan: "free" = trials sin pago, "premium" = pagos activos
    if (plan === "premium") {
      query = query.eq("status", "ACTIVE").not("payment_provider", "is", null)
    } else if (plan === "free") {
      // Free = trials (sin pago) o sin provider
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

    let orgsMap: Record<
      string,
      { id: string; nombre: string; slug: string; activo: boolean }
    > = {}

    if (orgIds.length > 0) {
      const { data: orgs } = await supabaseAdmin
        .from("organizations")
        .select("id, nombre, slug, activo")
        .in("id", orgIds)

      orgsMap = (orgs || []).reduce(
        (acc, org) => {
          acc[org.id] = org
          return acc
        },
        {} as Record<
          string,
          { id: string; nombre: string; slug: string; activo: boolean }
        >
      )
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
      }
    })

    // Counts globales (independientes de filtros y paginación)
    const [activeRes, trialingRes, expiredRes, canceledRes] = await Promise.all([
      supabaseAdmin
        .from("subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("status", "ACTIVE"),
      supabaseAdmin
        .from("subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("status", "TRIALING")
        .gt("trial_end", new Date().toISOString()),
      supabaseAdmin
        .from("subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("status", "TRIALING")
        .lte("trial_end", new Date().toISOString()),
      supabaseAdmin
        .from("subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("status", "CANCELED"),
    ])

    return NextResponse.json({
      subscriptions: result as SubscriptionListItem[],
      total: count || 0,
      page,
      limit,
      counts: {
        active: activeRes.count || 0,
        trialing: trialingRes.count || 0,
        expiredTrials: expiredRes.count || 0,
        canceled: canceledRes.count || 0,
      },
    })
  } catch (error) {
    console.error("Error fetching subscriptions:", error)
    return NextResponse.json(
      { error: "Error al obtener suscripciones" },
      { status: 500 }
    )
  }
}
