import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"

// POST: Verificar que el usuario pertenece al tenant del slug
export async function POST(request: NextRequest) {
  try {
    const session = await auth()

    if (!session?.user?.organizationId) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 })
    }

    const { slug } = await request.json()

    if (!slug) {
      return NextResponse.json({ error: "Slug requerido" }, { status: 400 })
    }

    // Verificar que el slug corresponde a la organización del usuario
    const { data: org, error } = await supabaseAdmin
      .from("organizations")
      .select("id, slug")
      .eq("slug", slug)
      .eq("id", session.user.organizationId)
      .single()

    if (error || !org) {
      return NextResponse.json(
        {
          valid: false,
          error: "No tienes acceso a esta organización",
        },
        { status: 403 }
      )
    }

    return NextResponse.json({
      valid: true,
      organizationId: org.id,
    })
  } catch (error) {
    console.error("Error verifying tenant:", error)
    return NextResponse.json(
      { error: "Error de verificación" },
      { status: 500 }
    )
  }
}
