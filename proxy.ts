import { NextRequest, NextResponse } from "next/server"
import { redirigirPorRol } from "@/lib/rutas-por-rol"
import { getToken } from "next-auth/jwt"
import {
  rateLimit,
  getApiRateLimit,
  isExemptFromRateLimit,
  extractPublicToken,
  extractPublicCatalogoSlug,
} from "@/lib/rate-limit"
import { getTenantStatusBySlug } from "@/lib/tenant-status-edge"
import { getOrgSlugById } from "@/lib/org-slug-edge"
import { getUserDeletedStatus } from "@/lib/user-status-edge"
import { escrituraPermitidaSinSuscripcion, getSuscripcionBloqueada } from "@/lib/suscripcion-edge"
import { checkSuperadminLoginLimit, checkTenantLoginLimit } from "@/lib/superadmin-login-limit-edge"
import {
  isImpersonationWriteBlocked,
  isImpersonationExpired,
  IMPERSONATION_EXIT_PATH,
} from "@/lib/impersonation"
import { isPublicPath } from "@/lib/public-paths"
import { clearSessionCookie, sessionCookieName } from "@/lib/session-cookie"

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
// Alias que la gente tipea para el panel; redirige al subdominio canónico.
const SUPERADMIN_ALIAS_SUBDOMAIN = "superadmin"

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

// Usuario dado de baja (eliminación de cuenta): su JWT sigue siendo válido
// hasta ~18 h porque solo se revalida en las últimas 6 h de su día de vida.
// Devuelve la respuesta que corta la sesión (401 en /api, redirect a /login en
// páginas, ambas borrando la cookie) o null si hay que seguir. Caché de 30 s y
// fail-open si Supabase no responde; una baja encontrada nunca es fail-open.
// Organización con la suscripción CANCELED o PAST_DUE: el panel la manda a
// /suscripcion-requerida, pero la API seguía aceptando escrituras (crear
// órdenes, cobrar, vender). Se cortan las escrituras de la API y las server
// actions, salvo las que hacen falta para pagar, loguearse o pedir soporte.
// Las lecturas siguen: el taller puede consultar y exportar sus datos.
// Fail-open, como el resto de los chequeos del proxy: un error de Supabase no
// bloquea a nadie. La impersonación ya es de solo lectura.
async function suscripcionBloqueadaResponse(
  request: NextRequest,
  token: { organizationId?: unknown; isImpersonating?: unknown } | null,
  pathname: string,
): Promise<NextResponse | null> {
  if (!token?.organizationId || token.isImpersonating) return null
  const method = request.method.toUpperCase()
  const isWrite =
    !(method === "GET" || method === "HEAD" || method === "OPTIONS") ||
    request.headers.has("next-action")
  if (!isWrite) return null
  if (pathname.startsWith("/api/") && (isPublicPath(pathname) || escrituraPermitidaSinSuscripcion(pathname))) {
    return null
  }
  const lookup = await getSuscripcionBloqueada(token.organizationId as string)
  if (lookup.kind !== "ok" || !lookup.bloqueada) return null
  return NextResponse.json(
    { error: "La suscripción de la organización no está activa", code: "SUBSCRIPTION_REQUIRED" },
    { status: 402 }
  )
}

// Impersonación y rutas públicas quedan fuera (/api/auth tiene que seguir
// andando para poder cerrar sesión).
async function deletedUserResponse(
  request: NextRequest,
  token: { id?: unknown; isImpersonating?: unknown } | null,
  pathname: string,
): Promise<NextResponse | null> {
  if (!token?.id || token.isImpersonating || isPublicPath(pathname)) return null
  const status = await getUserDeletedStatus(token.id as string)
  // Baja o acceso bloqueado desde el panel (397): las dos cortan la sesión viva.
  if (status.kind !== "ok" || (!status.deleted && !status.bloqueado)) return null
  const res = pathname.startsWith("/api/")
    ? NextResponse.json({ error: status.deleted ? "Cuenta eliminada" : "Acceso desactivado" }, { status: 401 })
    : NextResponse.redirect(new URL("/login", request.url))
  return clearSessionCookie(res)
}

async function esSuperadminVigente(token: { id?: unknown; isSuperadmin?: unknown }): Promise<boolean> {
  if (typeof token.id !== "string" || !token.id) return false
  const status = await getUserDeletedStatus(token.id)
  if (status.kind === "ok") return status.esSuperadmin
  return token.isSuperadmin === true
}

// Corte de una sesión de impersonación: vencida (más de 30 min) o intentando
// escribir. El vencimiento se mira acá además del callback `jwt` de auth.ts
// porque getToken() no corre callbacks, y el `exp` del JWT no sirve: Auth.js lo
// reescribe a 30 días cada vez que se lee /api/auth/session. El endpoint de
// salida queda siempre habilitado para poder terminarla.
function impersonationResponse(
  request: NextRequest,
  token: { isImpersonating?: unknown; impersonationExpiresAt?: unknown } | null,
  pathname: string,
): NextResponse | null {
  if (!token?.isImpersonating || pathname === IMPERSONATION_EXIT_PATH) return null
  if (isImpersonationExpired(token)) {
    // En rutas públicas (/login, /api/auth/*) se deja pasar: el token vencido
    // ya no autentica nada (el callback `jwt` lo anula en auth()) y cortar acá
    // haría un loop de redirect a /login o impediría volver a loguearse.
    if (isPublicPath(pathname)) return null
    const res = pathname.startsWith("/api/")
      ? NextResponse.json({ error: "La sesión de impersonación venció" }, { status: 401 })
      : NextResponse.redirect(new URL("/login", request.url))
    return clearSessionCookie(res)
  }
  if (
    isImpersonationWriteBlocked({
      isImpersonating: true,
      method: request.method,
      pathname,
      isServerAction: request.headers.has("next-action"),
    })
  ) {
    return NextResponse.json(
      { error: "Sesión de impersonación en solo-lectura: acción no permitida" },
      { status: 403 }
    )
  }
  return null
}

// Rutas de landing page (solo para dominio principal)
function isLandingPath(pathname: string): boolean {
  return pathname === "/" || pathname.startsWith("/pricing")
}

// Páginas de marketing del dominio principal que, para un usuario logueado,
// no tienen sentido: lo mandamos a su panel. Antes lo hacía cada página con
// auth() + una consulta a Supabase en CADA request (incluidos los anónimos);
// acá solo se paga para quien trae cookie de sesión válida, y la página queda
// libre de auth().
const LANDING_REDIRECT_PATHS = new Set(["/", "/precios"])

async function redirectLoggedInFromLanding(
  request: NextRequest,
  pathname: string,
): Promise<NextResponse | null> {
  if (!LANDING_REDIRECT_PATHS.has(pathname)) return null
  const method = request.method.toUpperCase()
  if (method !== "GET" && method !== "HEAD") return null
  // Sin cookie de sesión no hay nada que decodificar: el visitante anónimo
  // (la mayoría del tráfico de la landing) sale sin costo. Auth.js parte el
  // JWT en `<nombre>.0`, `<nombre>.1`... cuando es grande, así que se miran
  // también los trozos.
  const cookieName = sessionCookieName()
  const hasSession = request.cookies
    .getAll()
    .some((c) => c.name === cookieName || c.name.startsWith(`${cookieName}.`))
  if (!hasSession) return null

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
    cookieName,
  })
  const organizationId = token?.organizationId
  if (typeof organizationId !== "string" || !organizationId) return null

  // Fail-open: si no se puede resolver el slug se muestra la landing, igual
  // que hacía la página cuando la org no tenía slug.
  const lookup = await getOrgSlugById(organizationId)
  if (lookup.kind !== "ok" || !lookup.slug) return null

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
  const protocol = process.env.NODE_ENV === "production" ? "https" : "http"
  return NextResponse.redirect(`${protocol}://${lookup.slug}.${rootDomain}/dashboard`)
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

// ==========================================
// Panel superadmin (subdominio admin.*)
// ==========================================

const SUPERADMIN_LOGIN_CALLBACK = "/api/auth/callback/credentials"
const SUPERADMIN_LOGIN_MAX_ATTEMPTS = 10
const SUPERADMIN_LOGIN_WINDOW_SECONDS = 10 * 60
// Talleres: más holgado que el panel porque varios empleados de un mismo local
// salen con la misma IP (NAT).
const TENANT_LOGIN_MAX_ATTEMPTS = 30
const TENANT_LOGIN_WINDOW_SECONDS = 10 * 60

function isSafeMethod(method: string): boolean {
  const m = method.toUpperCase()
  return m === "GET" || m === "HEAD" || m === "OPTIONS"
}

// Same-origin estricto: el host del Origin tiene que ser el mismo host del
// request. Sin Origin (raro en un navegador para un POST) solo se acepta si
// el navegador declara `Sec-Fetch-Site: same-origin`. `Origin: null`
// (iframe sandbox, redirects cross-origin) no pasa.
export function isSameOriginRequest(request: NextRequest, hostname: string): boolean {
  const origin = request.headers.get("origin")
  if (origin) {
    try {
      return new URL(origin).host === hostname
    } catch {
      return false
    }
  }
  return request.headers.get("sec-fetch-site") === "same-origin"
}

// IP del cliente: en Vercel `x-vercel-forwarded-for` la pone el edge y no se
// puede falsificar; fuera de Vercel se cae al primer valor de XFF.
function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  )
}

// El panel no se puede embeber (clickjacking sobre acciones con un clic,
// como impersonar o correr crons).
function withAdminFrameProtection<T extends NextResponse>(res: T): T {
  res.headers.set("X-Frame-Options", "DENY")
  res.headers.set("Content-Security-Policy", "frame-ancestors 'none'")
  return res
}

async function adminPanel(
  request: NextRequest,
  requestHeaders: Headers,
  hostname: string,
  pathname: string,
): Promise<NextResponse> {
  // Marcar como panel superadmin
  requestHeaders.set("x-superadmin-panel", "true")

  // CSRF: la cookie de sesión es SameSite=lax en `.stapp.com.ar`, así que un
  // POST desde cualquier subdominio de tenant cuenta como same-site y viaja
  // con la cookie del superadmin. Toda escritura al panel tiene que venir de
  // admin.* mismo.
  if (!isSafeMethod(request.method) && !isSameOriginRequest(request, hostname)) {
    return NextResponse.json({ error: "Origen no permitido" }, { status: 403 })
  }

  // Fuerza bruta sobre el login del panel (password y 2FA pasan por acá).
  // El límite general es en memoria por instancia; este se guarda en la base
  // y es compartido (lib/superadmin-login-limit-edge.ts). Por IP, no por cuenta, para no poder bloquear al
  // superadmin desde afuera.
  if (request.method === "POST" && pathname === SUPERADMIN_LOGIN_CALLBACK) {
    const rl = await checkSuperadminLoginLimit(
      clientIp(request),
      SUPERADMIN_LOGIN_MAX_ATTEMPTS,
      SUPERADMIN_LOGIN_WINDOW_SECONDS
    )
    if (!rl.success) {
      return NextResponse.json(
        { error: "Demasiados intentos de inicio de sesión. Esperá unos minutos." },
        { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000))) } }
      )
    }
  }

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
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
    cookieName: sessionCookieName(),
  })

  if (!token) {
    // Redirigir a login del panel admin
    const loginUrl = new URL("/superadmin-login", request.url)
    loginUrl.searchParams.set("callbackUrl", pathname)
    return NextResponse.redirect(loginUrl)
  }

  const adminDeleted = await deletedUserResponse(request, token, pathname)
  if (adminDeleted) return adminDeleted

  // Superadmin = email en SUPERADMIN_EMAILS **y** la fila marcada
  // (users.es_superadmin, 397). La marca se mira en la base (caché de 30 s)
  // para que sacarla corte enseguida; si la consulta falla se usa la del
  // token, que se resincroniza en cada revalidación del JWT. Una sesión de
  // impersonación nunca entra al panel, aunque el usuario impersonado tenga
  // un email de la lista: el token lleva el email del objetivo y acá no se
  // aplica el solo-lectura.
  if (
    token.isImpersonating ||
    !isSuperadminEmail(token.email as string) ||
    !(await esSuperadminVigente(token))
  ) {
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
    const saIp = clientIp(request)
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

export async function proxy(request: NextRequest) {
  const hostname = request.headers.get("host") || ""
  const pathname = request.nextUrl.pathname
  const origin = request.headers.get("origin") || ""
  const subdomain = extractSubdomain(hostname)

  // Headers para pasar contexto
  const requestHeaders = new Headers(request.headers)

  // SEGURIDAD: borrar los headers internos que SOLO este middleware tiene derecho
  // a setear (tras validar JWT/subdominio). Si no se borran aca, un cliente puede
  // inyectarlos desde afuera y, en los paths que no los reescriben (p. ej. el
  // dominio principal sin subdominio), requireSuperadmin() los confiaria -> bypass.
  // Se borran ANTES de cualquier branch; los paths legitimos los vuelven a setear.
  requestHeaders.delete("x-superadmin-panel")
  requestHeaders.delete("x-superadmin-email")
  requestHeaders.delete("x-user-id")
  requestHeaders.delete("x-tenant-slug")

  // Fuerza bruta sobre el login de los talleres: límite por IP guardado en la
  // base y compartido entre instancias (el general de abajo es en memoria).
  // admin.* tiene su propio límite, más estricto, en adminPanel().
  if (
    request.method === "POST" &&
    pathname === SUPERADMIN_LOGIN_CALLBACK &&
    subdomain?.toLowerCase() !== SUPERADMIN_SUBDOMAIN
  ) {
    const rl = await checkTenantLoginLimit(clientIp(request), TENANT_LOGIN_MAX_ATTEMPTS, TENANT_LOGIN_WINDOW_SECONDS)
    if (!rl.success) {
      return NextResponse.json(
        { error: "Demasiados intentos de inicio de sesión. Esperá unos minutos." },
        { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000))) } }
      )
    }
  }

  // Rate limiting para rutas API
  if (pathname.startsWith("/api/") && !isExemptFromRateLimit(pathname)) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    // La IP va siempre en la clave: si el contador fuera solo por organización,
    // un único cliente agotaría el cupo de todos los usuarios del taller.
    const ruta = pathname.split("/").slice(0, 4).join("/")
    const identifier = subdomain ? `org:${subdomain}:ip:${ip}:${ruta}` : `ip:${ip}:${ruta}`
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
    // Las APIs autentican por la cookie de sesión (scopeada al dominio raíz),
    // así que también acá hay que cortar la sesión de un usuario dado de baja.
    //
    // La cookie de impersonación también viaja al dominio raíz: sin subdominio
    // no hay x-tenant-slug y requireAuth() acepta la sesión, así que el
    // solo-lectura y el vencimiento se aplican también acá. Por eso el token se
    // lee además en cualquier escritura o server action, no solo en /api.
    const isApiCall = pathname.startsWith("/api/") && !isPublicPath(pathname)
    const method = request.method.toUpperCase()
    const isWrite =
      !(method === "GET" || method === "HEAD" || method === "OPTIONS") ||
      request.headers.has("next-action")
    if (isApiCall || isWrite) {
      const apexToken = await getToken({
        req: request,
        secret: process.env.NEXTAUTH_SECRET,
        cookieName: sessionCookieName(),
      })
      const apexImpersonation = impersonationResponse(request, apexToken, pathname)
      if (apexImpersonation) return apexImpersonation
      if (isApiCall) {
        const apexDeleted = await deletedUserResponse(request, apexToken, pathname)
        if (apexDeleted) return apexDeleted
      }
      const apexSinSuscripcion = await suscripcionBloqueadaResponse(request, apexToken, pathname)
      if (apexSinSuscripcion) return apexSinSuscripcion
    }

    // Usuario logueado entrando a la landing o a /precios → su panel.
    const landingRedirect = await redirectLoggedInFromLanding(request, pathname)
    if (landingRedirect) return landingRedirect

    // Landing page y rutas públicas permitidas
    return NextResponse.next({
      request: { headers: requestHeaders },
    })
  }

  // ==========================================
  // CASO 1b: Alias superadmin.* → admin.*
  // ==========================================
  // Sin esto, "superadmin" caía en CASO 4 como slug de tenant inexistente y
  // terminaba en /tenant-not-found.
  if (subdomain.toLowerCase() === SUPERADMIN_ALIAS_SUBDOMAIN) {
    const target = request.nextUrl.clone()
    target.host = hostname.replace(/^[^.]+/, SUPERADMIN_SUBDOMAIN)
    if (pathname === "/tenant-not-found") {
      target.pathname = "/"
      target.search = ""
    }
    return NextResponse.redirect(target, 308)
  }

  // ==========================================
  // CASO 2: Subdominio ADMIN (Panel SuperAdmin)
  // ==========================================
  if (subdomain.toLowerCase() === SUPERADMIN_SUBDOMAIN) {
    return withAdminFrameProtection(await adminPanel(request, requestHeaders, hostname, pathname))
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
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
    cookieName: sessionCookieName(),
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

  const deletedRes = await deletedUserResponse(request, token, pathname)
  if (deletedRes) return deletedRes

  // Read-only impersonation enforcement. When a superadmin impersonates a
  // tenant, the minted token carries `isImpersonating` (lib/impersonation.ts).
  // At this point the token is confirmed to belong to THIS tenant (it passed
  // the cross-tenant check above). The decision (block state-changing requests,
  // allow only the exit endpoint) lives in `isImpersonationWriteBlocked` so it
  // can be unit-tested in isolation.
  const impersonationRes = impersonationResponse(request, token, pathname)
  if (impersonationRes) return impersonationRes

  const sinSuscripcion = await suscripcionBloqueadaResponse(request, token, pathname)
  if (sinSuscripcion) return sinSuscripcion

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

  // Protección de rutas por rol. La tabla vive en lib/rutas-por-rol, aparte y
  // sin dependencias, para poder testearla: acá adentro no se puede.
  //
  // Es un gate GRUESO. Los permisos finos por organización (los toggles opt-in
  // como vendedores_administran_inventario y tecnicos_operan_pos) están en la
  // BD, que el Edge no lee: los resuelven la página y la API.
  if (redirigirPorRol(pathname, token.role as string)) {
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
