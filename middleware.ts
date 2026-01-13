import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"

// Subdominio especial para el panel de superadmin
const SUPERADMIN_SUBDOMAIN = "admin"

// Verificar si un email es superadmin (desde env)
function isSuperadminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const superadminEmails =
    process.env.SUPERADMIN_EMAILS?.split(",").map((e) => e.trim().toLowerCase()) || []
  return superadminEmails.includes(email.toLowerCase())
}

// Subdominios reservados que no pueden usarse por tenants
// "admin" se maneja de forma especial más abajo
const RESERVED_SUBDOMAINS = new Set([
  "www",
  "api",
  "app",
  "dashboard",
  "mail",
  "email",
  "ftp",
  "cdn",
  "static",
  "assets",
  "blog",
  "help",
  "support",
  "status",
  "docs",
  "dev",
  "staging",
  "test",
  "login",
  "registro",
  "signup",
  "signin",
])

// Rutas públicas que no requieren autenticación
function isPublicPath(pathname: string): boolean {
  const publicPaths = [
    "/login",
    "/registro",
    "/forgot-password",
    "/reset-password",
    "/verificar-email",
    "/tenant-not-found",
    "/api/auth",
    "/api/public",
    "/api/inngest",
    "/api/cron",
    "/api/mercadopago/webhook",
    "/_next",
    "/favicon.ico",
    "/manifest.json",
    "/sw.js",
    "/logo.png",
    "/icons",
  ]
  return publicPaths.some((path) => pathname.startsWith(path))
}

// Rutas de landing page (solo para dominio principal)
function isLandingPath(pathname: string): boolean {
  return pathname === "/" || pathname.startsWith("/pricing")
}

// Extraer subdomain del hostname
function extractSubdomain(hostname: string): string | null {
  // Quitar puerto si existe
  const host = hostname.split(":")[0]

  // Desarrollo local
  if (host === "localhost" || host === "127.0.0.1") {
    return null
  }

  // Soporte para desarrollo con .local
  // demo.stapp.local → "demo"
  if (host.endsWith(".local")) {
    const parts = host.split(".")
    if (parts.length >= 2) {
      const subdomain = parts[0]
      if (subdomain !== "stapp" && subdomain !== "www") {
        return subdomain
      }
    }
    return null
  }

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
  const rootParts = rootDomain.split(".").length // stapp.com.ar = 3

  const parts = host.split(".")

  // stapp.com.ar o www.stapp.com.ar
  if (parts.length <= rootParts) {
    return null
  }

  // guru-tech.stapp.com.ar → "guru-tech"
  const subdomain = parts[0]

  // www no es subdominio de tenant
  if (subdomain === "www") {
    return null
  }

  return subdomain
}

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get("host") || ""
  const pathname = request.nextUrl.pathname
  const subdomain = extractSubdomain(hostname)

  // Headers para pasar contexto
  const requestHeaders = new Headers(request.headers)

  // ==========================================
  // CASO 1: Dominio principal (sin subdominio)
  // ==========================================
  if (!subdomain) {
    // Landing page y rutas públicas permitidas
    return NextResponse.next({
      request: { headers: requestHeaders },
    })
  }

  // ==========================================
  // CASO 2: Subdominio ADMIN (Panel SuperAdmin)
  // ==========================================
  if (subdomain.toLowerCase() === SUPERADMIN_SUBDOMAIN) {
    // Marcar como panel superadmin
    requestHeaders.set("x-superadmin-panel", "true")

    // Rutas públicas del panel admin (login, auth)
    if (
      pathname === "/superadmin-login" ||
      pathname.startsWith("/api/auth")
    ) {
      return NextResponse.next({
        request: { headers: requestHeaders },
      })
    }

    // Verificar autenticación
    const adminCookieName =
      process.env.NODE_ENV === "production"
        ? "__Secure-next-auth.session-token"
        : "next-auth.session-token"

    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
      cookieName: adminCookieName,
    })

    if (!token) {
      // Redirigir a login del panel admin
      const loginUrl = new URL("/superadmin-login", request.url)
      loginUrl.searchParams.set("callbackUrl", pathname)
      return NextResponse.redirect(loginUrl)
    }

    // Verificar que el email está en SUPERADMIN_EMAILS
    if (!isSuperadminEmail(token.email as string)) {
      // No es superadmin, redirigir al dominio principal
      const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
      const protocol = process.env.NODE_ENV === "production" ? "https" : "http"
      return NextResponse.redirect(new URL("/", `${protocol}://${rootDomain}`))
    }

    // Agregar headers de superadmin para las APIs
    requestHeaders.set("x-superadmin-email", token.email as string)
    requestHeaders.set("x-user-id", token.id as string)

    return NextResponse.next({
      request: { headers: requestHeaders },
    })
  }

  // ==========================================
  // CASO 3: Subdominio reservado
  // ==========================================
  if (RESERVED_SUBDOMAINS.has(subdomain.toLowerCase())) {
    const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
    return NextResponse.redirect(new URL("/", `https://${rootDomain}`))
  }

  // ==========================================
  // CASO 4: Subdominio de tenant
  // ==========================================

  // Agregar slug del tenant a headers
  requestHeaders.set("x-tenant-slug", subdomain)

  // Si es ruta pública, permitir pero pasar contexto
  if (isPublicPath(pathname)) {
    return NextResponse.next({
      request: { headers: requestHeaders },
    })
  }

  // Si es landing page en subdominio, redirigir a dashboard o login
  if (isLandingPath(pathname)) {
    const landingCookieName = process.env.NODE_ENV === "production"
      ? "__Secure-next-auth.session-token"
      : "next-auth.session-token"

    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
      cookieName: landingCookieName,
    })

    if (token) {
      return NextResponse.redirect(new URL("/dashboard", request.url))
    } else {
      return NextResponse.redirect(new URL("/login", request.url))
    }
  }

  // Para rutas protegidas, verificar autenticación
  const cookieName = process.env.NODE_ENV === "production"
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token"

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
    cookieName,
  })

  if (!token) {
    // Redirigir a login del subdominio
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("callbackUrl", pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Agregar info del usuario a headers para APIs
  requestHeaders.set("x-organization-id", token.organizationId as string)
  requestHeaders.set("x-user-id", token.id as string)
  requestHeaders.set("x-user-role", token.role as string)

  return NextResponse.next({
    request: { headers: requestHeaders },
  })
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - Public files with extensions
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}
