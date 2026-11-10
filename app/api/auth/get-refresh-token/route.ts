import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"

// Este endpoint devuelve el refresh token actual del usuario autenticado
// para guardarlo en localStorage y permitir restauración de sesión en PWA
export async function GET() {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "No autenticado" },
        { status: 401 }
      )
    }

    // Durante una impersonación el usuario de la sesión es el del tenant: su
    // refresh token real abriría una sesión completa (lectura/escritura, sin
    // el límite de 30 min y sin rastro de impersonación) a nombre suyo.
    if (session.user.isImpersonating) {
      return NextResponse.json(
        { error: "No disponible durante una impersonación" },
        { status: 403 }
      )
    }

    // Obtener el refresh token del usuario
    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("refresh_token, refresh_token_expires")
      .eq("id", session.user.id)
      .single()

    if (error || !user?.refresh_token) {
      return NextResponse.json(
        { error: "No hay refresh token" },
        { status: 404 }
      )
    }

    // Verificar que no haya expirado
    const expires = new Date(user.refresh_token_expires)
    if (expires < new Date()) {
      return NextResponse.json(
        { error: "Token expirado" },
        { status: 401 }
      )
    }

    return NextResponse.json({
      refreshToken: user.refresh_token,
      expiresAt: user.refresh_token_expires,
    })
  } catch (error) {
    console.error("[get-refresh-token] Error:", error)
    return NextResponse.json(
      { error: "Error interno" },
      { status: 500 }
    )
  }
}
