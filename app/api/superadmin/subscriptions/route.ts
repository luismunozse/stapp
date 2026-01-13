import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import type { SubscriptionsListResponse } from "@/types/superadmin"

export async function GET(request: Request) {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status") || ""
    const plan = searchParams.get("plan") || ""
    const page = parseInt(searchParams.get("page") || "1")
    const limit = parseInt(searchParams.get("limit") || "20")

    // Query base para suscripciones
    let query = supabaseAdmin
      .from("subscriptions")
      .select(
        `
        id,
        organization_id,
        status,
        billing_period,
        current_period_end,
        cancel_at_period_end,
        created_at,
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

    // Paginación
    const offset = (page - 1) * limit
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

    // Combinar datos - plans puede ser objeto o array según Supabase
    let result = (subscriptions || []).map((sub) => {
      // Supabase puede devolver plans como objeto o array
      const plansData = Array.isArray(sub.plans) ? sub.plans[0] : sub.plans
      return {
        id: sub.id,
        status: sub.status,
        billing_period: sub.billing_period,
        current_period_end: sub.current_period_end,
        cancel_at_period_end: sub.cancel_at_period_end,
        created_at: sub.created_at,
        organization: orgsMap[sub.organization_id] || null,
        plans: plansData || null,
      }
    })

    // Filtro de plan
    if (plan === "free") {
      result = result.filter((sub) => sub.plans?.tipo === "FREE")
    } else if (plan === "premium") {
      result = result.filter((sub) => sub.plans?.tipo === "PREMIUM")
    }

    const response: SubscriptionsListResponse = {
      subscriptions: result as any,
      total: count || 0,
      page,
      limit,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error("Error fetching subscriptions:", error)
    return NextResponse.json(
      { error: "Error al obtener suscripciones" },
      { status: 500 }
    )
  }
}
