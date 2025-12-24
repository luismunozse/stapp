import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export async function proxy(request: NextRequest) {
  const session = await auth()

  const isAuthPage = request.nextUrl.pathname.startsWith("/login")
  const isDashboardPage = request.nextUrl.pathname.startsWith("/dashboard") || 
                          request.nextUrl.pathname.startsWith("/ordenes") ||
                          request.nextUrl.pathname.startsWith("/clientes") ||
                          request.nextUrl.pathname.startsWith("/tecnicos") ||
                          request.nextUrl.pathname.startsWith("/inventario") ||
                          request.nextUrl.pathname.startsWith("/facturacion") ||
                          request.nextUrl.pathname.startsWith("/reportes")

  if (isAuthPage) {
    if (session) {
      return NextResponse.redirect(new URL("/dashboard", request.url))
    }
    return NextResponse.next()
  }

  if (isDashboardPage && !session) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
}
