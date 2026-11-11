import { NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { validateRefreshToken } from "@/lib/auth-tokens"
import { sessionCookieName } from "@/lib/session-cookie"

/**
 * Devuelve el refresh token de la sesión actual para que la PWA lo guarde y
 * pueda restaurar la sesión si el navegador borra la cookie.
 *
 * El token sale del JWT cifrado de la cookie de esta misma sesión: en la base
 * solo queda su hash. No se entrega durante una impersonación, porque esa
 * sesión no es del usuario.
 */
export async function GET(request: Request) {
  try {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
      cookieName: sessionCookieName(),
    })

    if (!token?.id) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 })
    }

    if (token.isImpersonating) {
      return NextResponse.json({ error: "No disponible durante una impersonación" }, { status: 403 })
    }

    if (typeof token.refreshToken !== "string" || !token.refreshToken) {
      return NextResponse.json({ error: "No hay refresh token" }, { status: 404 })
    }

    const usuario = await validateRefreshToken(token.refreshToken)
    if (!usuario || usuario.id !== token.id) {
      return NextResponse.json({ error: "Token expirado" }, { status: 401 })
    }

    return NextResponse.json(
      { refreshToken: token.refreshToken, expiresAt: usuario.refreshTokenExpira },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    console.error("[get-refresh-token] Error:", error)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
