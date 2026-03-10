import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { parsePagination } from "@/lib/api-utils"
import type { OrganizationsListResponse } from "@/types/superadmin"

export async function GET(request: Request) {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search") || ""
    const status = searchParams.get("status") || ""
    const plan = searchParams.get("plan") || ""
    const { page, limit, offset } = parsePagination(searchParams)

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
      .order("created_at", { ascending: false })

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
    }

    // Paginación
    query = query.range(offset, offset + limit - 1)

    const { data: organizations, error: dbError, count } = await query

    if (dbError) throw dbError

    // Obtener suscripciones y conteo de usuarios para cada organización
    const orgIds = organizations?.map((o) => o.id) || []

    let subscriptionsMap: Record<string, { id: string; status: string; plans: { id: string; nombre: string; tipo: string } | null }> = {}
    let usersCountMap: Record<string, number> = {}

    if (orgIds.length > 0) {
      // Obtener suscripciones con planes y conteo de usuarios en paralelo
      const [{ data: subscriptions }, { data: usersCounts }] = await Promise.all([
        supabaseAdmin
          .from("subscriptions")
          .select(
            `
            id,
            organization_id,
            status,
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
      ])

      subscriptionsMap = (subscriptions || []).reduce(
        (acc, sub) => {
          const plansData = Array.isArray(sub.plans) ? sub.plans[0] : sub.plans
          acc[sub.organization_id] = {
            id: sub.id,
            status: sub.status as string,
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
    }

    // Combinar datos
    let result = (organizations || []).map((org) => ({
      ...org,
      usersCount: usersCountMap[org.id] || 0,
      subscription: subscriptionsMap[org.id] || null,
    }))

    // Filtro de plan (después de obtener suscripciones)
    if (plan === "free") {
      result = result.filter(
        (org) => !org.subscription || org.subscription.plans?.tipo === "FREE"
      )
    } else if (plan === "premium") {
      result = result.filter(
        (org) => org.subscription?.plans?.tipo === "PREMIUM"
      )
    }

    const response: OrganizationsListResponse = {
      organizations: result as OrganizationsListResponse["organizations"],
      total: count || 0,
      page,
      limit,
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
