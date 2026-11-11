import { NextResponse } from "next/server"
import { requireInventarioAccess } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// POST /api/inventario/lotes/marcar-vencidos
// Trigger manual de la RPC marcar_lotes_vencidos para los lotes de la
// organización de la sesión (migración 383). Devuelve count.
export async function POST() {
  try {
    const { error, organizationId } = await requireInventarioAccess()
    if (error) return error

    const { data, error: rpcErr } = await supabaseAdmin.rpc("marcar_lotes_vencidos", {
      p_organization_id: organizationId!,
    })
    if (rpcErr) throw rpcErr

    return NextResponse.json({ count: Number(data ?? 0) })
  } catch (err) {
    console.error("Error marcar vencidos:", err)
    return NextResponse.json({ error: "Error al marcar lotes vencidos" }, { status: 500 })
  }
}
