import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// GET /api/inventario/lotes/proximos-vencer?dias=30
// Wrapper sobre RPC lotes_proximos_vencer. Incluye vencidos si dias_restantes < 0.
export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const url = new URL(request.url)
    const diasParam = Number(url.searchParams.get("dias"))
    const dias = Number.isFinite(diasParam) && diasParam > 0 ? Math.min(diasParam, 365) : 30

    const { data, error: rpcErr } = await supabaseAdmin.rpc("lotes_proximos_vencer", {
      p_organization_id: organizationId!,
      p_dias_anticipacion: dias,
    })

    if (rpcErr) throw rpcErr

    return NextResponse.json({ data: data ?? [], dias })
  } catch (err) {
    console.error("Error proximos a vencer:", err)
    return NextResponse.json({ error: "Error al obtener lotes" }, { status: 500 })
  }
}
