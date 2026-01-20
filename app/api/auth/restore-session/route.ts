import { NextRequest, NextResponse } from "next/server"
import { validateRefreshToken, rotateRefreshToken } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"

export async function POST(req: NextRequest) {
  try {
    const { refreshToken } = await req.json()

    if (!refreshToken) {
      return NextResponse.json(
        { error: "Refresh token requerido" },
        { status: 400 }
      )
    }

    // Validar el refresh token
    const user = await validateRefreshToken(refreshToken)

    if (!user) {
      return NextResponse.json(
        { error: "Token inválido o expirado" },
        { status: 401 }
      )
    }

    // Obtener datos completos del usuario con organización
    const { data: fullUser, error: userError } = await supabaseAdmin
      .from("users")
      .select(`
        id,
        email,
        nombre,
        rol,
        organization_id,
        organizations (
          id,
          nombre,
          slug,
          activo
        )
      `)
      .eq("id", user.id)
      .single()

    if (userError || !fullUser) {
      return NextResponse.json(
        { error: "Usuario no encontrado" },
        { status: 404 }
      )
    }

    // Verificar organización activa (Supabase puede retornar objeto o array)
    const orgs = fullUser.organizations as unknown
    const org = Array.isArray(orgs) ? orgs[0] : orgs
    if (!org || !(org as { activo: boolean }).activo) {
      return NextResponse.json(
        { error: "Organización inactiva" },
        { status: 403 }
      )
    }

    // Rotar el refresh token para mayor seguridad
    const newRefreshToken = await rotateRefreshToken(user.id, true)

    // Devolver datos del usuario para que el cliente pueda hacer signIn
    return NextResponse.json({
      success: true,
      user: {
        id: fullUser.id,
        email: fullUser.email,
        name: fullUser.nombre,
        role: fullUser.rol,
        organizationId: fullUser.organization_id,
      },
      refreshToken: newRefreshToken,
    })
  } catch (error) {
    console.error("[restore-session] Error:", error)
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    )
  }
}
