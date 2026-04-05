import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// DELETE - Eliminar movimiento manual
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params

    const { error: deleteError } = await supabaseAdmin
      .from("movimientos_caja")
      .delete()
      .eq("id", id)
      .eq("organization_id", organizationId!)

    if (deleteError) {
      console.error("Error deleting movimiento:", deleteError)
      return NextResponse.json({ error: "Error al eliminar movimiento" }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("Error deleting movimiento:", err)
    return NextResponse.json({ error: "Error al eliminar movimiento" }, { status: 500 })
  }
}
