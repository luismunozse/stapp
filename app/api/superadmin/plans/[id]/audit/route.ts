import { NextRequest, NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import type { PlanAudit } from "@/types/superadmin"

interface RouteParams {
  params: Promise<{
    id: string
  }>
}

/**
 * GET /api/superadmin/plans/[id]/audit
 * Obtiene el historial de cambios de un plan
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { error: authError } = await requireSuperadmin()
    if (authError) return authError

    const { id } = await params

    const { data: auditLogs, error } = await supabaseAdmin
      .from("plans_audit")
      .select("*")
      .eq("plan_id", id)
      .order("created_at", { ascending: false })

    if (error) {
      console.error("Error fetching audit logs:", error)
      return NextResponse.json(
        { error: "Error al obtener historial" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      audit: auditLogs as PlanAudit[],
      total: auditLogs?.length || 0,
    })
  } catch (error) {
    console.error("Error in GET /api/superadmin/plans/[id]/audit:", error)
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    )
  }
}
