import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET() {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const last7Days = new Date(today)
    last7Days.setDate(last7Days.getDate() - 7)
    const last30Days = new Date(today)
    last30Days.setDate(last30Days.getDate() - 30)

    const [
      totalRes,
      todayRes,
      last7Res,
      last30Res,
      loginFailedRes,
      loginSuccessRes,
      byActionRes,
      byEntityRes,
      recentSecurityRes,
      topUsersRes,
    ] = await Promise.all([
      // Total de logs
      supabaseAdmin
        .from("audit_logs")
        .select("id", { count: "exact", head: true }),

      // Logs de hoy
      supabaseAdmin
        .from("audit_logs")
        .select("id", { count: "exact", head: true })
        .gte("created_at", today.toISOString()),

      // Últimos 7 días
      supabaseAdmin
        .from("audit_logs")
        .select("id", { count: "exact", head: true })
        .gte("created_at", last7Days.toISOString()),

      // Últimos 30 días
      supabaseAdmin
        .from("audit_logs")
        .select("id", { count: "exact", head: true })
        .gte("created_at", last30Days.toISOString()),

      // Login fallidos últimos 7 días
      supabaseAdmin
        .from("audit_logs")
        .select("id", { count: "exact", head: true })
        .eq("action", "LOGIN_FAILED")
        .gte("created_at", last7Days.toISOString()),

      // Login exitosos últimos 7 días
      supabaseAdmin
        .from("audit_logs")
        .select("id", { count: "exact", head: true })
        .eq("action", "LOGIN")
        .gte("created_at", last7Days.toISOString()),

      // Distribución por acción (últimos 30 días)
      supabaseAdmin
        .from("audit_logs")
        .select("action")
        .gte("created_at", last30Days.toISOString()),

      // Distribución por entidad (últimos 30 días)
      supabaseAdmin
        .from("audit_logs")
        .select("entity")
        .gte("created_at", last30Days.toISOString()),

      // Eventos de seguridad recientes (logins fallidos)
      supabaseAdmin
        .from("audit_logs")
        .select("id, action, entity, changes, ip_address, created_at")
        .in("action", ["LOGIN_FAILED", "LOGIN", "LOGOUT"])
        .order("created_at", { ascending: false })
        .limit(20),

      // Usuarios más activos (últimos 30 días)
      supabaseAdmin
        .from("audit_logs")
        .select("user_id, changes")
        .gte("created_at", last30Days.toISOString())
        .not("user_id", "is", null)
        .limit(1000),
    ])

    // Contar distribución por acción
    const actionCounts: Record<string, number> = {}
    for (const row of byActionRes.data || []) {
      actionCounts[row.action] = (actionCounts[row.action] || 0) + 1
    }

    // Contar distribución por entidad
    const entityCounts: Record<string, number> = {}
    for (const row of byEntityRes.data || []) {
      entityCounts[row.entity] = (entityCounts[row.entity] || 0) + 1
    }

    // Contar usuarios más activos
    const userActivityMap: Record<string, number> = {}
    const userEmails: Record<string, string> = {}
    for (const row of topUsersRes.data || []) {
      if (row.user_id) {
        userActivityMap[row.user_id] = (userActivityMap[row.user_id] || 0) + 1
        // Extraer email del performer si está en changes
        const changes = row.changes as Record<string, unknown> | null
        if (changes?.performer_email) {
          userEmails[row.user_id] = changes.performer_email as string
        }
      }
    }

    // Top 10 usuarios
    const topUsers = Object.entries(userActivityMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([userId, count]) => ({
        userId,
        email: userEmails[userId] || null,
        actionCount: count,
      }))

    // Obtener nombres de los top users
    const topUserIds = topUsers.map((u) => u.userId).filter(Boolean)
    if (topUserIds.length > 0) {
      const { data: usersData } = await supabaseAdmin
        .from("users")
        .select("id, nombre, email")
        .in("id", topUserIds)

      const usersMap = new Map(
        (usersData || []).map((u) => [u.id, { nombre: u.nombre, email: u.email }])
      )

      for (const user of topUsers) {
        const userData = usersMap.get(user.userId)
        if (userData) {
          user.email = userData.email
        }
      }
    }

    // Formatear eventos de seguridad
    const securityEvents = (recentSecurityRes.data || []).map((event) => {
      const changes = event.changes as Record<string, unknown> | null
      return {
        id: event.id,
        action: event.action,
        email: (changes?.performer_email as string) || (changes?.metadata as Record<string, unknown>)?.email || null,
        description: (changes?.description as string) || null,
        ipAddress: event.ip_address,
        isSuperadmin: (changes?.metadata as Record<string, unknown>)?.isSuperadmin || false,
        createdAt: event.created_at,
      }
    })

    return NextResponse.json({
      total: totalRes.count || 0,
      today: todayRes.count || 0,
      last7Days: last7Res.count || 0,
      last30Days: last30Res.count || 0,
      loginsFailed7Days: loginFailedRes.count || 0,
      loginsSuccess7Days: loginSuccessRes.count || 0,
      actionDistribution: actionCounts,
      entityDistribution: entityCounts,
      securityEvents,
      topUsers,
    })
  } catch (error) {
    console.error("Error fetching audit stats:", error)
    return NextResponse.json(
      { error: "Error al obtener estadísticas de auditoría" },
      { status: 500 }
    )
  }
}
