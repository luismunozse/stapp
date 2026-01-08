import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"

// GET: Obtener la organización del usuario autenticado
export async function GET() {
  try {
    const session = await auth()

    if (!session?.user?.organizationId) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 })
    }

    const { data: org, error } = await supabaseAdmin
      .from("organizations")
      .select("id, slug, nombre, nombre_mostrar")
      .eq("id", session.user.organizationId)
      .single()

    if (error || !org) {
      return NextResponse.json(
        { error: "Organización no encontrada" },
        { status: 404 }
      )
    }

    return NextResponse.json({
      organization: {
        id: org.id,
        slug: org.slug,
        nombre: org.nombre_mostrar || org.nombre,
      },
    })
  } catch (error) {
    console.error("Error getting user organization:", error)
    return NextResponse.json(
      { error: "Error interno" },
      { status: 500 }
    )
  }
}
