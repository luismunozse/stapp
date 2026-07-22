import { NextResponse } from "next/server"
import { requireInventarioAccess } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// ============================================================
// POST /api/inventario/[id]/consolidar-variantes
// Wrapper de eliminar_variantes_y_consolidar.
// Soft-deletea todas las variantes y suma sus stocks al parent.
// ============================================================

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId } = await requireInventarioAccess()
    if (error) return error

    const { id } = await params

    const { data, error: rpcErr } = await supabaseAdmin.rpc("eliminar_variantes_y_consolidar", {
      p_inv_id: id,
      p_org: organizationId!,
      p_user: userId!,
    })

    if (rpcErr) {
      if (rpcErr.code === "P0002") {
        return NextResponse.json({ error: "Item no encontrado" }, { status: 404 })
      }
      throw rpcErr
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error("Error consolidando variantes:", err)
    return NextResponse.json({ error: "Error al consolidar variantes" }, { status: 500 })
  }
}
