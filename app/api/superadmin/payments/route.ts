import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { parsePagination } from "@/lib/api-utils"

export async function GET(request: Request) {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status") || ""
    const provider = searchParams.get("provider") || ""
    const dateFrom = searchParams.get("dateFrom") || ""
    const dateTo = searchParams.get("dateTo") || ""
    const search = searchParams.get("search") || ""
    const includeStats = searchParams.get("includeStats") === "true"
    const { page, limit, offset } = parsePagination(searchParams)

    // Si hay búsqueda por org, encontrar IDs primero
    let searchOrgIds: string[] | null = null
    if (search.trim().length >= 2) {
      const searchPattern = `%${search.trim()}%`
      const { data: matchingOrgs } = await supabaseAdmin
        .from("organizations")
        .select("id")
        .or(`nombre.ilike.${searchPattern},slug.ilike.${searchPattern}`)
        .limit(100)
      searchOrgIds = matchingOrgs?.map((o) => o.id) || []
      if (searchOrgIds.length === 0) {
        const emptyResponse: any = { payments: [], total: 0, page, limit, totalAmount: 0 }
        if (includeStats) {
          emptyResponse.stats = { mrr: 0, totalHistorico: 0, pagosEsteMes: 0, webhookErrorRate: 0, pagosPendientes: 0 }
        }
        return NextResponse.json(emptyResponse)
      }
    }

    // Query base para pagos — ahora incluye plan_name, period_start, period_end, provider_payment_id
    let query = supabaseAdmin
      .from("subscription_payments")
      .select(
        `
        id,
        subscription_id,
        organization_id,
        amount,
        currency,
        status,
        payment_provider,
        provider_payment_id,
        invoice_url,
        receipt_url,
        paid_at,
        created_at,
        plan_name,
        period_start,
        period_end
      `,
        { count: "exact" }
      )
      .order("paid_at", { ascending: false, nullsFirst: false })

    // Filtro por búsqueda de org
    if (searchOrgIds) {
      query = query.in("organization_id", searchOrgIds)
    }

    // Filtro de estado
    if (status) {
      query = query.eq("status", status.toUpperCase())
    }

    // Filtro de proveedor
    if (provider) {
      query = query.eq("payment_provider", provider.toUpperCase())
    }

    // Filtro de fecha desde
    if (dateFrom) {
      query = query.gte("paid_at", dateFrom)
    }

    // Filtro de fecha hasta
    if (dateTo) {
      query = query.lte("paid_at", dateTo + "T23:59:59.999Z")
    }

    // Paginación
    query = query.range(offset, offset + limit - 1)

    // Ejecutar query de pagos y total de montos en paralelo
    let totalAmountQuery = supabaseAdmin
      .from("subscription_payments")
      .select("amount")
      .eq("status", "SUCCEEDED")

    if (dateFrom) {
      totalAmountQuery = totalAmountQuery.gte("paid_at", dateFrom)
    }
    if (dateTo) {
      totalAmountQuery = totalAmountQuery.lte("paid_at", dateTo + "T23:59:59.999Z")
    }

    // Ejecutar queries base
    const [
      { data: payments, error: dbError, count },
      { data: amountsData },
    ] = await Promise.all([query, totalAmountQuery])

    // Si se piden stats (KPIs), ejecutar queries de métricas en paralelo
    let statsResults: any[] = []
    if (includeStats) {
      const now = new Date()
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

      statsResults = await Promise.all([
        // MRR: pagos exitosos del mes actual
        supabaseAdmin
          .from("subscription_payments")
          .select("amount")
          .eq("status", "SUCCEEDED")
          .gte("paid_at", startOfMonth),
        // Pagos este mes (count)
        supabaseAdmin
          .from("subscription_payments")
          .select("id", { count: "exact", head: true })
          .eq("status", "SUCCEEDED")
          .gte("paid_at", startOfMonth),
        // Total histórico
        supabaseAdmin
          .from("subscription_payments")
          .select("amount")
          .eq("status", "SUCCEEDED"),
        // Webhook total (últimos 7 días)
        supabaseAdmin
          .from("webhook_events")
          .select("id", { count: "exact", head: true })
          .gte("received_at", sevenDaysAgo),
        // Webhook errors (últimos 7 días)
        supabaseAdmin
          .from("webhook_events")
          .select("id", { count: "exact", head: true })
          .eq("status", "ERROR")
          .gte("received_at", sevenDaysAgo),
        // Pagos pendientes
        supabaseAdmin
          .from("subscription_payments")
          .select("id", { count: "exact", head: true })
          .eq("status", "PENDING"),
      ])
    }

    if (dbError) throw dbError

    // Obtener información de organizaciones
    const orgIds = [...new Set(payments?.map((p: any) => p.organization_id) || [])]

    let orgsMap: Record<string, { nombre: string; slug: string }> = {}

    if (orgIds.length > 0) {
      const { data: orgs } = await supabaseAdmin
        .from("organizations")
        .select("id, nombre, slug")
        .in("id", orgIds)

      orgsMap = (orgs || []).reduce(
        (acc: Record<string, { nombre: string; slug: string }>, org: any) => {
          acc[org.id] = { nombre: org.nombre, slug: org.slug }
          return acc
        },
        {} as Record<string, { nombre: string; slug: string }>
      )
    }

    // Si hay pagos sin plan_name, intentar resolver desde la suscripción
    const paymentsNeedingPlan = (payments || []).filter((p: any) => !p.plan_name && p.subscription_id)
    if (paymentsNeedingPlan.length > 0) {
      const subIds = [...new Set(paymentsNeedingPlan.map((p: any) => p.subscription_id))]
      const { data: subs } = await supabaseAdmin
        .from("subscriptions")
        .select("id, plans(nombre, slug)")
        .in("id", subIds)

      const subPlanMap: Record<string, string> = {}
      for (const sub of subs || []) {
        const plan = sub.plans as any
        if (plan) subPlanMap[sub.id] = plan.nombre || plan.slug || "Premium"
      }
      for (const p of paymentsNeedingPlan) {
        if (subPlanMap[p.subscription_id]) {
          p.plan_name = subPlanMap[p.subscription_id]
        }
      }
    }

    // Combinar datos
    const result = (payments || []).map((payment: any) => ({
      ...payment,
      organization: orgsMap[payment.organization_id] || null,
    }))

    const totalAmount =
      amountsData?.reduce((sum: number, p: any) => sum + (p.amount || 0), 0) || 0

    const response: any = {
      payments: result,
      total: count || 0,
      page,
      limit,
      totalAmount,
    }

    // Agregar stats si se pidieron
    if (includeStats && statsResults.length > 0) {
      const { data: mrrData } = statsResults[0]
      const { count: pagosEsteMesCount } = statsResults[1]
      const { data: totalHistoricoData } = statsResults[2]
      const { count: webhookTotal } = statsResults[3]
      const { count: webhookErrors } = statsResults[4]
      const { count: pagosPendientes } = statsResults[5]

      const mrr = mrrData?.reduce((sum: number, p: any) => sum + (p.amount || 0), 0) || 0
      const totalHistorico = totalHistoricoData?.reduce((sum: number, p: any) => sum + (p.amount || 0), 0) || 0
      const webhookErrorRate = (webhookTotal ?? 0) > 0
        ? Math.round(((webhookErrors ?? 0) / (webhookTotal ?? 1)) * 100)
        : 0

      response.stats = {
        mrr,
        totalHistorico,
        pagosEsteMes: pagosEsteMesCount ?? 0,
        webhookErrorRate,
        webhookErrors: webhookErrors ?? 0,
        webhookTotal: webhookTotal ?? 0,
        pagosPendientes: pagosPendientes ?? 0,
      }
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error("Error fetching payments:", error)
    return NextResponse.json(
      { error: "Error al obtener pagos" },
      { status: 500 }
    )
  }
}
