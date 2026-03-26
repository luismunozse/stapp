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

    // Obtener stats agregadas con una sola query via RPC
    const [statsRes, recentSecurityRes] = await Promise.all([
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
    }

    // Resolver emails de top users
    const topUsers = (stats.topUsers || []).map((u) => ({
      ...u,
      email: null as string | null,
    }))

    const topUserIds = topUsers.map((u) => u.userId).filter(Boolean)
    if (topUserIds.length > 0) {
      const { data: usersData } = await supabaseAdmin
        .from("users")
        .select("id, email")
        .in("id", topUserIds)

      const usersMap = new Map(
        (usersData || []).map((u) => [u.id, u.email])
      )

      for (const user of topUsers) {
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

    return NextResponse.json({
      ...stats,
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
