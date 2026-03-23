import { NextRequest, NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET() {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { data, error: dbError } = await supabaseAdmin
      .from("changelog_entries")
      .select("*")
      .order("created_at", { ascending: false })

    if (dbError) throw dbError

    return NextResponse.json(data || [])
  } catch (error) {
    console.error("Error fetching changelog:", error)
    return NextResponse.json({ error: "Error al obtener changelog" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const body = await request.json()
    const { titulo, descripcion, tipo, importante } = body

    if (!titulo || !descripcion) {
      return NextResponse.json({ error: "Titulo y descripcion son requeridos" }, { status: 400 })
    }

    const { data, error: dbError } = await supabaseAdmin
      .from("changelog_entries")
      .insert({
        titulo,
        descripcion,
        tipo: tipo || "MEJORA",
        importante: importante || false,
        publicado: false,
      })
      .select()
      .single()

    if (dbError) throw dbError

    return NextResponse.json(data)
  } catch (error) {
    console.error("Error creating changelog:", error)
    return NextResponse.json({ error: "Error al crear entrada" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const body = await request.json()
    const { id, ...updates } = body

    if (!id) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 })
    }

    // Si se publica, setear fecha_publicacion
    if (updates.publicado === true) {
      updates.fecha_publicacion = new Date().toISOString()
    }

    const { data, error: dbError } = await supabaseAdmin
      .from("changelog_entries")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single()

    if (dbError) throw dbError

    return NextResponse.json(data)
  } catch (error) {
    console.error("Error updating changelog:", error)
    return NextResponse.json({ error: "Error al actualizar entrada" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (!id) {
      return NextResponse.json({ error: "ID requerido" }, { status: 400 })
    }

    const { error: dbError } = await supabaseAdmin
      .from("changelog_entries")
      .delete()
      .eq("id", id)

    if (dbError) throw dbError

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting changelog:", error)
    return NextResponse.json({ error: "Error al eliminar entrada" }, { status: 500 })
  }
}
