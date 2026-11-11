import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { parsePagination } from "@/lib/api-utils"
import { escapeOrIlikeTerm } from "@/lib/pg-search"
import { montosDesdeRpc } from "@/lib/superadmin-montos"
import type { PaymentStats } from "@/types/superadmin"

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
      const s = escapeOrIlikeTerm(search)
      const { data: matchingOrgs } = await supabaseAdmin
        .from("organizations")
        .select("id")
        .or(`nombre.ilike.%${s}%,slug.ilike.%${s}%`)
        .limit(100)
      searchOrgIds = matchingOrgs?.map((o) => o.id) || []
      if (searchOrgIds.length === 0) {
        // Sin orgs que coincidan no hay pagos que listar ni sumar. Los KPIs son
        // globales (no dependen de la búsqueda), así que no se piden acá.
        const emptyResponse: any = { payments: [], total: 0, page, limit, totalAmountByCurrency: [] }
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

    // Totales: se suman en SQL y por moneda (superadmin_pagos_por_moneda). Antes
    // se traían las filas y se sumaban en JS: PostgREST corta en 1000 filas sin
    // error y además se mezclaban ARS y USD en un solo número.
    // El total respeta los MISMOS filtros que la lista; sin filtro de estado,
    // default a SUCCEEDED (dinero efectivamente cobrado).
    const pagosPorMoneda = (args: {
      p_status: string
      p_provider?: string | null
      p_desde?: string | null
      p_hasta?: string | null
      p_org_ids?: string[] | null
    }) => supabaseAdmin.rpc("superadmin_pagos_por_moneda", args)

    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const [
      { data: payments, error: dbError, count },
      totalesRes,
      mrrRes,
      historicoRes,
      pagosEsteMesRes,
      webhookTotalRes,
      webhookErrorsRes,
      pendientesRes,
    ] = await Promise.all([
      query,
      pagosPorMoneda({
        p_status: status ? status.toUpperCase() : "SUCCEEDED",
        p_provider: provider ? provider.toUpperCase() : null,
        p_desde: dateFrom || null,
        p_hasta: dateTo ? dateTo + "T23:59:59.999Z" : null,
        p_org_ids: searchOrgIds,
      }),
      // KPIs (solo si se piden)
      includeStats ? pagosPorMoneda({ p_status: "SUCCEEDED", p_desde: startOfMonth }) : null,
      includeStats ? pagosPorMoneda({ p_status: "SUCCEEDED" }) : null,
      includeStats
        ? supabaseAdmin
            .from("subscription_payments")
            .select("id", { count: "exact", head: true })
            .eq("status", "SUCCEEDED")
            .gte("paid_at", startOfMonth)
        : null,
      includeStats
        ? supabaseAdmin
            .from("webhook_events")
            .select("id", { count: "exact", head: true })
            .gte("received_at", sevenDaysAgo)
        : null,
      includeStats
        ? supabaseAdmin
            .from("webhook_events")
            .select("id", { count: "exact", head: true })
            .eq("status", "ERROR")
            .gte("received_at", sevenDaysAgo)
        : null,
      includeStats
        ? supabaseAdmin
            .from("subscription_payments")
            .select("id", { count: "exact", head: true })
            .eq("status", "PENDING")
        : null,
    ])

    if (dbError) throw dbError
    // Un total que falla no se muestra como $0: la request entera falla.
    for (const res of [totalesRes, mrrRes, historicoRes, pagosEsteMesRes, webhookTotalRes, webhookErrorsRes, pendientesRes]) {
      if (res?.error) throw res.error
    }

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

    const response: any = {
      payments: result,
      total: count || 0,
      page,
      limit,
      totalAmountByCurrency: montosDesdeRpc(totalesRes.data),
    }

    // Agregar stats si se pidieron
    if (includeStats) {
      const webhookTotal = webhookTotalRes?.count ?? 0
      const webhookErrors = webhookErrorsRes?.count ?? 0
      const webhookErrorRate = webhookTotal > 0
        ? Math.round((webhookErrors / webhookTotal) * 100)
        : 0

      const stats: PaymentStats = {
        mrrPorMoneda: montosDesdeRpc(mrrRes?.data ?? null),
        totalHistoricoPorMoneda: montosDesdeRpc(historicoRes?.data ?? null),
        pagosEsteMes: pagosEsteMesRes?.count ?? 0,
        webhookErrorRate,
        webhookErrors,
        webhookTotal,
        pagosPendientes: pendientesRes?.count ?? 0,
      }
      response.stats = stats
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
