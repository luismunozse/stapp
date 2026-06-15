import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import {
  rateLimit,
  getApiRateLimit,
  isExemptFromRateLimit,
  extractPublicToken,
  extractPublicCatalogoSlug,
} from "@/lib/rate-limit"
import { getTenantStatusBySlug } from "@/lib/tenant-status-edge"

// Hashea un string con SHA-256 usando Web Crypto (compatible con Edge Runtime,
// donde `node:crypto` no está disponible). Devuelve los primeros 16 hex chars,
// suficientes como key opaca de rate-limit (no necesita resistencia de colisión
// completa).
async function hashTokenForKey(token: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  )
  const bytes = new Uint8Array(buf)
  let hex = ""
  for (let i = 0; i < 8; i++) {
    hex += bytes[i].toString(16).padStart(2, "0")
  }
  return hex
}

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
    "/api/cron",
    "/api/mercadopago/webhook",
    "/api/rebill/webhook",
    "/_next",
    "/favicon.ico",
    "/manifest.json",
    "/sw.js",
    "/logo.png",
    "/icons",
    "/seguimiento",
    "/cotizacion",
    "/kiosco",
    "/api/whatsapp/webhook",
    "/api/v1",
    "/api/health",
    "/app-entry",
    "/ayuda",
    "/descargar",
    "/google-auth",
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
  const origin = request.headers.get("origin") || ""
  const subdomain = extractSubdomain(hostname)

  // Headers para pasar contexto
  const requestHeaders = new Headers(request.headers)

  // Rate limiting para rutas API
  if (pathname.startsWith("/api/") && !isExemptFromRateLimit(pathname)) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const identifier = subdomain ? `org:${subdomain}:${pathname.split("/").slice(0, 4).join("/")}` : `ip:${ip}:${pathname.split("/").slice(0, 4).join("/")}`
    const config = getApiRateLimit(pathname)
    const result = await rateLimit(identifier, config.max, config.windowMs)

    if (!result.success) {
      return NextResponse.json(
        { error: "Demasiadas solicitudes. Intenta de nuevo más tarde." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil((result.reset - Date.now()) / 1000)),
            "X-RateLimit-Limit": String(result.limit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(result.reset),
          },
        }
      )
    }

    // Rate limit ADICIONAL por public_token para endpoints sin auth.
    // El rate limit por IP de arriba protege contra una sola IP abusando;
    // este protege contra brute-force/scraping de un token específico desde
    // múltiples IPs (botnet). Hasheamos el token antes de usarlo como key
    // para no guardar el secreto en memoria.
    const publicToken = extractPublicToken(pathname)
    if (publicToken) {
      const tokenHash = await hashTokenForKey(publicToken)
      // 40 requests por token cada 5 minutos. Suficiente para que un cliente
      // real cargue la página varias veces y consulte recursos relacionados,
      // pero corta cualquier intento de scraping/brute-force agresivo.
      const tokenResult = await rateLimit(`pt:${tokenHash}`, 40, 5 * 60 * 1000)
      if (!tokenResult.success) {
        return NextResponse.json(
          { error: "Demasiadas solicitudes para este recurso." },
          {
            status: 429,
            headers: {
              "Retry-After": String(Math.ceil((tokenResult.reset - Date.now()) / 1000)),
              "X-RateLimit-Limit": String(tokenResult.limit),
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset": String(tokenResult.reset),
              "X-RateLimit-Scope": "public-token",
            },
          }
        )
      }
    }

    // Rate limit por slug de catálogo público. Defensa contra botnet
    // distribuido scrapeando un catálogo (el per-IP no alcanza). El slug
    // es público (no secreto) pero limita el daño agregado. 300 req/5min
    // permite tráfico real alto (decenas de visitantes simultáneos cada
    // uno cargando ~10 requests al catálogo) y corta abuso masivo.
    const catalogoSlug = extractPublicCatalogoSlug(pathname)
    if (catalogoSlug) {
      const slugResult = await rateLimit(`csl:${catalogoSlug}`, 300, 5 * 60 * 1000)
      if (!slugResult.success) {
        return NextResponse.json(
          { error: "Catálogo recibiendo demasiadas solicitudes. Intentá en unos minutos." },
          {
            status: 429,
            headers: {
              "Retry-After": String(Math.ceil((slugResult.reset - Date.now()) / 1000)),
              "X-RateLimit-Limit": String(slugResult.limit),
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset": String(slugResult.reset),
              "X-RateLimit-Scope": "catalogo-slug",
            },
          }
        )
      }
    }
  }

  // CORS para Capacitor (app nativa)
  const capacitorOrigins = ["capacitor://localhost", "http://localhost"]
  if (capacitorOrigins.includes(origin)) {
    const response = NextResponse.next({
      request: { headers: requestHeaders },
    })
    response.headers.set("Access-Control-Allow-Origin", origin)
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization")
    response.headers.set("Access-Control-Allow-Credentials", "true")

    if (request.method === "OPTIONS") {
      return new NextResponse(null, {
        status: 200,
        headers: response.headers,
      })
    }
  }

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
    // Seguridad: estos headers solo se setean acá, después de validar JWT + email.
    // El middleware corre antes que cualquier API route, no se pueden inyectar externamente.
    requestHeaders.set("x-superadmin-email", token.email as string)
    requestHeaders.set("x-user-id", token.id as string)

    // Rate limiting para APIs de superadmin (más estricto: 60 req/min)
    if (pathname.startsWith("/api/superadmin")) {
      const saIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
      const rlResult = await rateLimit(
        `sa:${saIp}:${pathname.split("/").slice(0, 4).join("/")}`,
        60,
        60000
      )
      if (!rlResult.success) {
        return NextResponse.json(
          { error: "Demasiadas solicitudes" },
          {
            status: 429,
            headers: {
              "Retry-After": String(Math.ceil((rlResult.reset - Date.now()) / 1000)),
            },
          }
        )
      }
      return NextResponse.next({
        request: { headers: requestHeaders },
      })
    }

    // Si NO está en ruta /superadmin/*, redirigir al dashboard
    if (!pathname.startsWith("/superadmin/")) {
      return NextResponse.redirect(new URL("/superadmin/dashboard", request.url))
    }

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

  // Validar que el tenant exista y esté activo. Se hace antes del chequeo de
  // rutas públicas para cortar también intentos de login sobre una org
  // desactivada (el bypass de superadmin en authorize() dejaría pasar igual).
  // El cache tiene TTL de 30s, así que una des/activación desde el panel
  // superadmin tarda a lo sumo ese tiempo en propagarse por todas las Edge
  // instances. `/tenant-not-found` queda siempre accesible para no loopear.
  //
  // Fail-open: si la consulta a Supabase falla (env faltante, timeout, 5xx),
  // dejamos pasar en vez de redirigir. Si redirigiéramos, cualquier glitch
  // transitorio de Supabase tiraría abajo el sitio entero para todos los
  // tenants. Las rutas protegidas igual exigen auth más abajo.
  let tenantStatus: { id: string; activo: boolean } | null = null
  if (pathname !== "/tenant-not-found") {
    const lookup = await getTenantStatusBySlug(subdomain)
    if (lookup.kind === "ok") {
      tenantStatus = lookup.status
      if (!tenantStatus || !tenantStatus.activo) {
        if (pathname.startsWith("/api/")) {
          return NextResponse.json(
            { error: "Organización inactiva o no encontrada" },
            { status: 403 }
          )
        }
        return NextResponse.redirect(new URL("/tenant-not-found", request.url))
      }
    }
  }

  // Leemos el token una sola vez y lo reutilizamos para los chequeos de
  // ownership, landing y rutas protegidas.
  const cookieName =
    process.env.NODE_ENV === "production"
      ? "__Secure-next-auth.session-token"
      : "next-auth.session-token"

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
    cookieName,
  })

  // Chequeo de pertenencia al tenant. La cookie de sesión está scopeada a
  // `.stapp.com.ar` ([lib/auth.ts] COOKIE_DOMAIN), así que el mismo JWT viaja
  // a todos los subdominios. Sin este check, cualquier usuario logueado en
  // tenant-a podría ver tenant-b (y en particular el superadmin podría
  // aterrizar en cualquier tenant por cookie compartida con admin.*).
  // Mandamos a /login para que pueda re-autenticarse como usuario del tenant
  // actual; /login es pública y no expone datos protegidos.
  if (
    tenantStatus &&
    token &&
    (token.organizationId as string) !== tenantStatus.id
  ) {
    // /api/auth y /api/public son públicos por diseño: el primero necesita
    // funcionar para poder re-loguearse como usuario del tenant actual, y el
    // segundo expone info no sensible (nombre/logo del tenant) que el login
    // page consume ANTES de autenticar. Bloquearlos rompe el flujo para
    // cualquier usuario que tenga una cookie de sesión de otra org en
    // `.stapp.com.ar` (cookie compartida entre subdominios).
    if (
      pathname.startsWith("/api/") &&
      !pathname.startsWith("/api/auth") &&
      !pathname.startsWith("/api/public")
    ) {
      return NextResponse.json(
        { error: "No pertenecés a esta organización" },
        { status: 403 }
      )
    }
    if (!isPublicPath(pathname)) {
      return NextResponse.redirect(new URL("/login", request.url))
    }
    // En rutas públicas (incluye /api/auth/* para permitir re-login) dejamos
    // pasar pero NO inyectamos x-organization-id ni headers de usuario.
    return NextResponse.next({
      request: { headers: requestHeaders },
    })
  }

  // Read-only impersonation enforcement. When a superadmin impersonates a
  // tenant, the minted token carries `isImpersonating` (lib/impersonation.ts).
  // At this point the token is confirmed to belong to THIS tenant (it passed
  // the cross-tenant check above), so we block any state-changing request:
  // non-safe HTTP methods AND Next.js server actions (which POST to page
  // routes with a `next-action` header). The exit and signout endpoints are
  // allowlisted so the superadmin can always leave.
  if (token?.isImpersonating) {
    const method = request.method.toUpperCase()
    const isSafeMethod = method === "GET" || method === "HEAD" || method === "OPTIONS"
    const isServerAction = request.headers.has("next-action")
    // Only the sanctioned exit endpoint is allowlisted. We do NOT allowlist
    // /api/auth/signout: a signout during impersonation would fire NextAuth's
    // signOut event with the TENANT user's id. The signOut handler now guards
    // against that, but blocking it here keeps the read-only surface minimal.
    const isExit = pathname === "/api/auth/impersonate/exit"

    if ((!isSafeMethod || isServerAction) && !isExit) {
      return NextResponse.json(
        { error: "Sesión de impersonación en solo-lectura: acción no permitida" },
        { status: 403 }
      )
    }
  }

  // Si es ruta pública, permitir pero pasar contexto
  if (isPublicPath(pathname)) {
    return NextResponse.next({
      request: { headers: requestHeaders },
    })
  }

  // Si es landing page en subdominio, redirigir a dashboard o login
  if (isLandingPath(pathname)) {
    if (token) {
      return NextResponse.redirect(new URL("/dashboard", request.url))
    } else {
      return NextResponse.redirect(new URL("/login", request.url))
    }
  }

  // Para rutas protegidas, verificar autenticación
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
  // Defense in depth: let server-side reads know the session is impersonated
  // and read-only, on top of the central method-based block above.
  if (token.isImpersonating) {
    requestHeaders.set("x-impersonating", "true")
  }

  // Protección de rutas por rol
  const userRole = token.role as string
  const adminOnlyRoutes = ["/tecnicos", "/vendedores", "/configuracion", "/emails", "/facturacion", "/inventario", "/finanzas"]
  const adminOrVendedorRoutes = ["/ventas", "/pos", "/reportes", "/proveedores"]

  const isAdminOnly = adminOnlyRoutes.some(r => pathname === r || pathname.startsWith(r + "/"))
  const isAdminOrVendedor = adminOrVendedorRoutes.some(r => pathname === r || pathname.startsWith(r + "/"))

  if (isAdminOnly && userRole !== "ADMIN") {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }
  if (isAdminOrVendedor && userRole !== "ADMIN" && userRole !== "VENDEDOR") {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

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
