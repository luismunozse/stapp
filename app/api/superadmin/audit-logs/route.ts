import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { parsePagination } from "@/lib/api-utils"
import type { AuditLogsResponse } from "@/types/superadmin"

export async function GET(request: Request) {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get("organizationId") || ""
    const entity = searchParams.get("entity") || ""
    const action = searchParams.get("action") || ""
    const dateFrom = searchParams.get("dateFrom") || ""
    const dateTo = searchParams.get("dateTo") || ""
    const tab = searchParams.get("tab") || "all" // all, security, superadmin
    const search = searchParams.get("search") || ""
    const { page, limit, offset } = parsePagination(searchParams, { limit: 50 })

    // Query base para logs
    let query = supabaseAdmin
      .from("audit_logs")
      .select(
        `
        id,
        organization_id,
        user_id,
        action,
        entity,
        entity_id,
        changes,
        ip_address,
        user_agent,
        created_at
      `,
        { count: "exact" }
      )
      .order("created_at", { ascending: false })

    // Filtros por tab
    if (tab === "security") {
      query = query.in("action", ["LOGIN", "LOGOUT", "LOGIN_FAILED"])
    } else if (tab === "superadmin") {
      query = query.in("action", [
        "TOGGLE_STATUS",
        "BROADCAST",
        "EMAIL_CAMPAIGN",
        "CRON_RUN",
        "SUBSCRIPTION_RENEW",
        "TRIAL_EXTENSION",
        "PLAN_TOGGLE",
        "BULK_ACTION",
        "TICKET_REPLY",
        "VERIFY_EMAIL",
        "EXPORT",
      ])
    }

    // Filtros
    if (organizationId) {
      query = query.eq("organization_id", organizationId)
    }

    if (entity) {
      query = query.eq("entity", entity)
    }

    if (action) {
      query = query.eq("action", action.toUpperCase())
    }

    if (dateFrom) {
      query = query.gte("created_at", dateFrom)
    }

    if (dateTo) {
      query = query.lte("created_at", dateTo + "T23:59:59.999Z")
    }

    if (search) {
      query = query.or(
        `action.ilike.%${search}%,entity.ilike.%${search}%,ip_address.ilike.%${search}%,changes->>'performer_email'.ilike.%${search}%,changes->>'description'.ilike.%${search}%`
      )
    }

    // Paginación
    query = query.range(offset, offset + limit - 1)

    const { data: logs, error: dbError, count } = await query

    if (dbError) throw dbError

    // Obtener información de usuarios y organizaciones
    const userIds = [...new Set(logs?.filter((l) => l.user_id).map((l) => l.user_id) || [])]
    const orgIds = [...new Set(
      logs?.map((l) => l.organization_id).filter((id) => id && id !== "00000000-0000-0000-0000-000000000000") || []
    )]

    let usersMap: Record<string, { nombre: string; email: string }> = {}
    let orgsMap: Record<string, { nombre: string; slug: string }> = {}

    const [usersData, orgsData] = await Promise.all([
      userIds.length > 0
        ? supabaseAdmin.from("users").select("id, nombre, email").in("id", userIds)
        : Promise.resolve({ data: null }),
      orgIds.length > 0
        ? supabaseAdmin.from("organizations").select("id, nombre, slug").in("id", orgIds)
        : Promise.resolve({ data: null }),
    ])

    usersMap = (usersData.data || []).reduce(
      (acc, user) => {
        acc[user.id] = { nombre: user.nombre, email: user.email }
        return acc
      },
      {} as Record<string, { nombre: string; email: string }>
    )

    orgsMap = (orgsData.data || []).reduce(
      (acc, org) => {
        acc[org.id] = { nombre: org.nombre, slug: org.slug }
        return acc
      },
      {} as Record<string, { nombre: string; slug: string }>
    )

    // Combinar datos
    const result = (logs || []).map((log) => {
      const changes = log.changes as Record<string, unknown> | null
      return {
        ...log,
        users: log.user_id
          ? usersMap[log.user_id] || null
          : null,
        organizations:
          log.organization_id && log.organization_id !== "00000000-0000-0000-0000-000000000000"
            ? orgsMap[log.organization_id] || null
            : null,
        // Extraer performer email para acciones de superadmin
        performer_email: (changes?.performer_email as string) || null,
        description: (changes?.description as string) || (changes?.action_description as string) || null,
      }
    })

    const response: AuditLogsResponse = {
      logs: result,
      total: count || 0,
      page,
      limit,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error("Error fetching audit logs:", error)
    return NextResponse.json(
      { error: "Error al obtener logs de auditoría" },
      { status: 500 }
    )
  }
}
