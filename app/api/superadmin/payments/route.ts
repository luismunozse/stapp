import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { parsePagination } from "@/lib/api-utils"
import type { PaymentsListResponse } from "@/types/superadmin"

export async function GET(request: Request) {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status") || ""
    const dateFrom = searchParams.get("dateFrom") || ""
    const dateTo = searchParams.get("dateTo") || ""
    const { page, limit, offset } = parsePagination(searchParams)

    // Query base para pagos
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
        created_at
      `,
        { count: "exact" }
      )
      .order("paid_at", { ascending: false, nullsFirst: false })

    // Filtro de estado
    if (status) {
      query = query.eq("status", status.toUpperCase())
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

    const [
      { data: payments, error: dbError, count },
      { data: amountsData },
    ] = await Promise.all([query, totalAmountQuery])

    if (dbError) throw dbError

    // Obtener información de organizaciones
    const orgIds = [...new Set(payments?.map((p) => p.organization_id) || [])]

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

    // Combinar datos
    const result = (payments || []).map((payment) => ({
      ...payment,
      organization: orgsMap[payment.organization_id] || null,
    }))

    const totalAmount =
      amountsData?.reduce((sum, p) => sum + (p.amount || 0), 0) || 0

    const response: PaymentsListResponse = {
      payments: result,
      total: count || 0,
      page,
      limit,
      totalAmount,
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
