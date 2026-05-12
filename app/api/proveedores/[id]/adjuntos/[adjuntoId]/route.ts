import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

const BUCKET = "proveedor-adjuntos"

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; adjuntoId: string }> }
) {
  try {
    const { error, organizationId } = await requireAdminOrVendedor()
    if (error) return error
    const { id, adjuntoId } = await params

    const { data: adj, error: fetchErr } = await supabaseAdmin
      .from("proveedor_adjuntos")
      .select("file_path")
      .eq("id", adjuntoId)
      .eq("proveedor_id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (fetchErr || !adj) {
      return NextResponse.json({ error: "Adjunto no encontrado" }, { status: 404 })
    }

    const { error: dbErr } = await supabaseAdmin
      .from("proveedor_adjuntos")
      .delete()
      .eq("id", adjuntoId)
      .eq("organization_id", organizationId!)

    if (dbErr) throw dbErr

    if (adj.file_path) {
      await supabaseAdmin.storage.from(BUCKET).remove([adj.file_path]).catch(() => {})
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Error deleting adjunto:", err)
    return NextResponse.json({ error: "Error al eliminar adjunto" }, { status: 500 })
  }
}
