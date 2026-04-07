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
    }

    // Combinar datos. El filtro de plan ya se aplicó a nivel SQL más arriba
    // (ver bloque premiumOrgIds), no hace falta filtrar en memoria acá.
    const result = (organizations || []).map((org) => ({
      ...org,
      usersCount: usersCountMap[org.id] || 0,
      subscription: subscriptionsMap[org.id] || null,
    }))

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
