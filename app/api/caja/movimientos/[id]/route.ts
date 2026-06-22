import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"

// DELETE - Eliminar movimiento manual
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, role, session } = await requireAdmin()
    if (error) return error

    const { id } = await params

    // Fetch movimiento with its session state for guards
    const { data: movimiento } = await supabaseAdmin
      .from("movimientos_caja")
      .select("id, sucursal_id, sesion_caja_id, sesiones_caja:sesion_caja_id(id, estado)")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (!movimiento) {
      return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 })
    }

    // Guard: cannot delete from a closed session
    const sesionEstado = (movimiento as any).sesiones_caja?.estado
    if (sesionEstado === "CERRADA") {
      return NextResponse.json(
        { error: "No se puede eliminar un movimiento de una sesión cerrada" },
        { status: 400 }
      )
    }

    // Guard: sucursal scope — branch users can only delete from their own branch
    const filtro = await sucursalParaLectura({
      role,
      userSucursalId: session!.user.sucursalId ?? null,
    })

    if (!filtro.verTodas && filtro.sucursalId) {
      if ((movimiento as any).sucursal_id !== filtro.sucursalId) {
        return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 })
      }
    }

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
