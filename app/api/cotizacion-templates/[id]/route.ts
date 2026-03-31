import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, role } = await requireAdmin()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden eliminar plantillas" },
        { status: 403 }
      )
    }

    const { id } = await params

    const { error: deleteError } = await supabaseAdmin
      .from("cotizacion_templates")
      .delete()
      .eq("id", id)
      .eq("organization_id", organizationId!)

    if (deleteError) throw deleteError

    return NextResponse.json({ message: "Plantilla eliminada" })
  } catch (error) {
    console.error("Error deleting template:", error)
    return NextResponse.json(
      { error: "Error al eliminar plantilla" },
      { status: 500 }
    )
  }
}
