import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const { name, config, activo } = body

    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (config !== undefined) updateData.config = config
    if (activo !== undefined) updateData.activo = activo

    const { data, error: dbError } = await supabaseAdmin
      .from("kiosk_tokens")
      .update(updateData)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .select()
      .single()

    if (dbError || !data) {
      return NextResponse.json({ error: "Token no encontrado" }, { status: 404 })
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error("Error updating kiosk token:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params

    const { error: dbError } = await supabaseAdmin
      .from("kiosk_tokens")
      .delete()
      .eq("id", id)
      .eq("organization_id", organizationId!)

    if (dbError) throw dbError

    return NextResponse.json({ message: "Token eliminado" })
  } catch (err) {
    console.error("Error deleting kiosk token:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
