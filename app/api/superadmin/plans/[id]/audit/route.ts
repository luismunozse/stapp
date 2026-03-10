import { NextRequest, NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { parsePagination } from "@/lib/api-utils"
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
    const { searchParams } = new URL(request.url)
    const { page, limit, offset } = parsePagination(searchParams)

    const [planResult, auditResult] = await Promise.all([
      supabaseAdmin
        .from("plans")
        .select("id, nombre, tipo")
        .eq("id", id)
        .single(),
      supabaseAdmin
        .from("plans_audit")
        .select("*", { count: "exact" })
        .eq("plan_id", id)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1),
    ])

    if (planResult.error) {
      return NextResponse.json(
        { error: "Plan no encontrado" },
        { status: 404 }
      )
    }

    if (auditResult.error) {
      console.error("Error fetching audit logs:", auditResult.error)
      return NextResponse.json(
        { error: "Error al obtener historial" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      plan: planResult.data,
      audit: auditResult.data as PlanAudit[],
      total: auditResult.count || 0,
    })
  } catch (error) {
    console.error("Error in GET /api/superadmin/plans/[id]/audit:", error)
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    )
  }
}
