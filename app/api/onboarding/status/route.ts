import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * GET /api/onboarding/status
 *
 * Devuelve el estado de completitud del onboarding para la organización
 * del usuario autenticado. Usado por el SetupChecklist en el dashboard
 * para guiar a usuarios nuevos / inactivos hacia su primera orden.
 */
export async function GET() {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const [clientesRes, inventarioRes, ordenesRes, orgRes] = await Promise.all([
      supabaseAdmin
        .from("clientes")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId!),
      supabaseAdmin
        .from("inventario")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId!),
      supabaseAdmin
        .from("ordenes_servicio")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId!),
      supabaseAdmin
        .from("organizations")
        .select("logo_url")
        .eq("id", organizationId!)
        .single(),
    ])

    const hasClients = (clientesRes.count ?? 0) > 0
    const hasProducts = (inventarioRes.count ?? 0) > 0
    const hasFirstOrder = (ordenesRes.count ?? 0) > 0
    const hasLogo = !!orgRes.data?.logo_url

    const completed = [hasClients, hasProducts, hasFirstOrder, hasLogo].filter(Boolean).length
    const completionPct = Math.round((completed / 4) * 100)

    return NextResponse.json({
      hasClients,
      hasProducts,
      hasFirstOrder,
      hasLogo,
      completionPct,
    })
  } catch (err) {
    console.error("Error fetching onboarding status:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
