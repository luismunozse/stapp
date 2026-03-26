import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { createSuperadminAuditLogger } from "@/lib/superadmin-audit"

export async function GET(request: Request) {
  try {
    const { error, email } = await requireSuperadmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const entity = searchParams.get("entity") || ""
    const action = searchParams.get("action") || ""
    const organizationId = searchParams.get("organizationId") || ""
    const dateFrom = searchParams.get("dateFrom") || ""
    const dateTo = searchParams.get("dateTo") || ""
    const search = searchParams.get("search") || ""

    let query = supabaseAdmin
      .from("audit_logs")
      .select("id, organization_id, user_id, action, entity, entity_id, changes, ip_address, user_agent, created_at")
      .order("created_at", { ascending: false })
      .limit(5000)

    if (entity) query = query.eq("entity", entity)
    if (action) query = query.eq("action", action.toUpperCase())
    if (organizationId) query = query.eq("organization_id", organizationId)
    if (dateFrom) query = query.gte("created_at", dateFrom)
    if (dateTo) query = query.lte("created_at", dateTo + "T23:59:59.999Z")
    if (search) {
      query = query.or(
        `action.ilike.%${search}%,entity.ilike.%${search}%,ip_address.ilike.%${search}%,changes->>'performer_email'.ilike.%${search}%,changes->>'description'.ilike.%${search}%`
      )
    }

    const { data: logs, error: dbError } = await query
    if (dbError) throw dbError

    // Obtener usuarios y organizaciones
    const userIds = [...new Set(logs?.filter((l) => l.user_id).map((l) => l.user_id) || [])]
    const orgIds = [...new Set(logs?.map((l) => l.organization_id).filter(Boolean) || [])]

    const [usersData, orgsData] = await Promise.all([
      userIds.length > 0
        ? supabaseAdmin.from("users").select("id, nombre, email").in("id", userIds)
        : Promise.resolve({ data: null }),
      orgIds.length > 0
        ? supabaseAdmin.from("organizations").select("id, nombre, slug").in("id", orgIds)
        : Promise.resolve({ data: null }),
    ])

    const usersMap = new Map((usersData.data || []).map((u) => [u.id, u]))
    const orgsMap = new Map((orgsData.data || []).map((o) => [o.id, o]))

    // Generar CSV
    const csvRows = [
      ["Fecha", "Acción", "Entidad", "Organización", "Usuario", "Email", "IP", "Descripción", "Entity ID"].join(","),
    ]

    for (const log of logs || []) {
      const user = log.user_id ? usersMap.get(log.user_id) : null
      const org = orgsMap.get(log.organization_id)
      const changes = log.changes as Record<string, unknown> | null
      const description = (changes?.description as string) ||
        (changes?.action_description as string) ||
        ""

      csvRows.push(
        [
          log.created_at,
          log.action,
          log.entity,
          org?.nombre || "-",
          user?.nombre || (changes?.performer_email as string) || "-",
          user?.email || (changes?.performer_email as string) || "-",
          log.ip_address || "-",
          `"${description.replace(/"/g, '""')}"`,
          log.entity_id || "-",
        ].join(",")
      )
    }

    // Audit log de la exportación
    const auditLogger = createSuperadminAuditLogger(email || null, request)
    auditLogger.log({
      action: "EXPORT",
      entity: "system",
      description: `Exportación de audit logs (${csvRows.length - 1} registros)`,
      metadata: { filters: { entity, action, organizationId, dateFrom, dateTo, search }, count: csvRows.length - 1 },
    }).catch(() => {})

    const csv = csvRows.join("\n")

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-logs-${new Date().toISOString().split("T")[0]}.csv"`,
      },
    })
  } catch (error) {
    console.error("Error exporting audit logs:", error)
    return NextResponse.json(
      { error: "Error al exportar logs de auditoría" },
      { status: 500 }
    )
  }
}
