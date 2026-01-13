import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
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
    const page = parseInt(searchParams.get("page") || "1")
    const limit = parseInt(searchParams.get("limit") || "50")

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

    // Paginación
    const offset = (page - 1) * limit
    query = query.range(offset, offset + limit - 1)

    const { data: logs, error: dbError, count } = await query

    if (dbError) throw dbError

    // Obtener información de usuarios y organizaciones
    const userIds = [...new Set(logs?.filter((l) => l.user_id).map((l) => l.user_id) || [])]
    const orgIds = [...new Set(logs?.map((l) => l.organization_id) || [])]

    let usersMap: Record<string, { nombre: string; email: string }> = {}
    let orgsMap: Record<string, { nombre: string; slug: string }> = {}

    if (userIds.length > 0) {
      const { data: users } = await supabaseAdmin
        .from("users")
        .select("id, nombre, email")
        .in("id", userIds)

      usersMap = (users || []).reduce(
        (acc, user) => {
          acc[user.id] = { nombre: user.nombre, email: user.email }
          return acc
        },
        {} as Record<string, { nombre: string; email: string }>
      )
    }

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
    const result = (logs || []).map((log) => ({
      ...log,
      users: log.user_id ? usersMap[log.user_id] || null : null,
      organizations: orgsMap[log.organization_id] || null,
    }))

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
