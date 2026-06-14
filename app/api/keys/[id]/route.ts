import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error
    const { id } = await params
    const { error: dbError } = await supabaseAdmin
      .from("api_keys")
      .update({ activo: false, revoked_at: new Date().toISOString() })
      .eq("id", id)
      .eq("organization_id", organizationId!)
    if (dbError) throw dbError
    return NextResponse.json({ message: "API key revocada" })
  } catch (e) {
    console.error("Error revoking api key:", e)
    return NextResponse.json({ error: "Error al revocar API key" }, { status: 500 })
  }
}
