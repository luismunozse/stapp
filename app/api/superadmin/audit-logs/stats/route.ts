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

    const [statsRes, recentSecurityRes, alertConfigRes] = await Promise.all([
      supabaseAdmin.rpc("audit_log_stats", {
        p_today: today.toISOString(),
        p_last_7_days: last7Days.toISOString(),
        p_last_30_days: last30Days.toISOString(),
      }),
      // Eventos de seguridad recientes
      supabaseAdmin
        .from("audit_logs")
        .select("id, action, entity, changes, ip_address, created_at")
        .in("action", ["LOGIN_FAILED", "LOGIN", "LOGOUT"])
        .order("created_at", { ascending: false })
        .limit(20),
      // Config de alertas
      supabaseAdmin
        .from("audit_alert_config")
        .select("*")
        .eq("id", "default")
        .single(),
    ])

    if (statsRes.error) throw statsRes.error

    const stats = statsRes.data as {
      total: number
      today: number
      last7Days: number
      last30Days: number
      loginsFailed7Days: number
      loginsSuccess7Days: number
      actionDistribution: Record<string, number>
      entityDistribution: Record<string, number>
      topUsers: Array<{ userId: string; actionCount: number }>
      hourlyDistribution: Array<{ hour: number; count: number }>
      dailyDistribution: Array<{ date: string; count: number }>
      highActivityUsers: Array<{ userId: string; count: number }>
      storageEstimate: { totalRows: number; oldestRecord: string; newestRecord: string }
    }

    // Resolver emails de top users y high activity users
    const topUsers = (stats.topUsers || []).map((u) => ({
      ...u,
      email: null as string | null,
    }))

    const highActivityUsers = (stats.highActivityUsers || []).map((u) => ({
      ...u,
      email: null as string | null,
    }))

    const allUserIds = [
      ...topUsers.map((u) => u.userId),
      ...highActivityUsers.map((u) => u.userId),
    ].filter(Boolean)

    const uniqueUserIds = [...new Set(allUserIds)]

    if (uniqueUserIds.length > 0) {
      const { data: usersData } = await supabaseAdmin
        .from("users")
        .select("id, email")
        .in("id", uniqueUserIds)

      const usersMap = new Map(
        (usersData || []).map((u) => [u.id, u.email])
      )

      for (const user of topUsers) {
        user.email = usersMap.get(user.userId) || null
      }
      for (const user of highActivityUsers) {
        user.email = usersMap.get(user.userId) || null
      }
    }

    // Formatear eventos de seguridad
    const securityEvents = (recentSecurityRes.data || []).map((event) => {
      const changes = event.changes as Record<string, unknown> | null
      return {
        id: event.id,
        action: event.action,
        email:
          (changes?.performer_email as string) ||
          (changes?.metadata as Record<string, unknown>)?.email ||
          null,
        description: (changes?.description as string) || null,
        ipAddress: event.ip_address,
        isSuperadmin:
          (changes?.metadata as Record<string, unknown>)?.isSuperadmin || false,
        createdAt: event.created_at,
      }
    })

    // Alert config (con defaults si no existe)
    const alertConfig = alertConfigRes.data || {
      user_activity_threshold: 100,
      user_activity_window_hours: 1,
      failed_login_threshold: 5,
      failed_login_window_hours: 24,
      retention_days: 90,
    }

    return NextResponse.json({
      ...stats,
      securityEvents,
      topUsers,
      highActivityUsers,
      alertConfig,
    })
  } catch (error) {
    console.error("Error fetching audit stats:", error)
    return NextResponse.json(
      { error: "Error al obtener estadísticas de auditoría" },
      { status: 500 }
    )
  }
}
