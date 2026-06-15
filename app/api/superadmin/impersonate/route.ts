import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { logSuperadminAudit } from "@/lib/superadmin-audit"
import {
  mintImpersonationToken,
  getSessionCookieName,
  IMPERSONATION_BACKUP_COOKIE,
  IMPERSONATION_MAX_AGE,
} from "@/lib/impersonation"

type Rol = "ADMIN" | "TECNICO" | "VENDEDOR"

// Same derivation as lib/auth.ts so impersonation cookies share the session
// cookie's scope (all subdomains in production).
function getCookieDomain(): string | undefined {
  if (process.env.COOKIE_DOMAIN) return process.env.COOKIE_DOMAIN
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_ROOT_DOMAIN) {
    return `.${process.env.NEXT_PUBLIC_ROOT_DOMAIN}`
  }
  return undefined
}

/**
 * Starts a READ-ONLY impersonation session for a superadmin.
 *
 * Flow:
 *   1. requireSuperadmin() (only reachable on admin.* via middleware headers).
 *   2. Resolve the target org + the user to impersonate (org ADMIN by default).
 *   3. Back up the superadmin's REAL session cookie into a uniquely-named
 *      cookie (no shadowing) so exit can restore it byte-identical.
 *   4. Overwrite the session cookie with a minted impersonation JWT
 *      (organizationId = target org → passes the middleware cross-tenant check;
 *      isImpersonating = true → middleware enforces read-only).
 *   5. Audit START. Return the tenant URL for the client to navigate to.
 */
export async function POST(request: Request) {
  try {
    const { error: authError, email: superadminEmail } = await requireSuperadmin()
    if (authError) return authError

    const secret = process.env.NEXTAUTH_SECRET
    if (!secret) {
      return NextResponse.json({ error: "Auth no configurado" }, { status: 500 })
    }

    const body = await request.json().catch(() => ({}))
    const organizationId: string | undefined = body.organizationId
    const requestedUserId: string | undefined = body.userId

    if (!organizationId) {
      return NextResponse.json({ error: "organizationId es requerido" }, { status: 400 })
    }

    // Resolve the org. Refuse to impersonate the admin panel org itself.
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("id, slug, nombre")
      .eq("id", organizationId)
      .single()

    if (!org) {
      return NextResponse.json({ error: "Organización no encontrada" }, { status: 404 })
    }
    if (org.slug === "superadmin") {
      return NextResponse.json(
        { error: "No se puede impersonar la organización del panel admin" },
        { status: 403 }
      )
    }

    // Resolve the target user: the requested one (must belong to the org) or
    // the org's first ADMIN as a sensible default.
    let userQuery = supabaseAdmin
      .from("users")
      .select("id, nombre, email, rol, sucursal_id, organization_id")
      .eq("organization_id", organizationId)

    userQuery = requestedUserId
      ? userQuery.eq("id", requestedUserId)
      : userQuery.eq("rol", "ADMIN")

    const { data: targetUser } = await userQuery
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()

    if (!targetUser) {
      return NextResponse.json(
        { error: "No se encontró un usuario para impersonar en esta organización" },
        { status: 404 }
      )
    }

    // Mint the impersonation token (salt = session cookie name so the
    // middleware/auth() can decode it from the session cookie).
    const token = await mintImpersonationToken(
      {
        id: targetUser.id,
        organizationId: org.id,
        role: targetUser.rol as Rol,
        sucursalId: targetUser.sucursal_id ?? null,
        name: targetUser.nombre,
        email: targetUser.email,
        impersonatorEmail: superadminEmail as string,
      },
      secret
    )

    // Audit BEFORE mutating cookies: if the audit write fails we must not be
    // left with an active (but unlogged) impersonation. Over-logging a start
    // that then fails to set cookies is the acceptable failure mode.
    await logSuperadminAudit({
      email: superadminEmail,
      action: "UPDATE",
      entity: "sessions",
      entityId: targetUser.id,
      organizationId: org.id,
      description: `Impersonación iniciada (solo-lectura) en "${org.nombre}" como ${targetUser.email}`,
      metadata: {
        event: "IMPERSONATION_START",
        impersonatedOrg: org.nombre,
        impersonatedOrgId: org.id,
        impersonatedUserId: targetUser.id,
        impersonatedUserEmail: targetUser.email,
        readOnly: true,
      },
    })

    const sessionCookieName = getSessionCookieName()
    const cookieDomain = getCookieDomain()
    const secure = process.env.NODE_ENV === "production"
    const cookieStore = await cookies()

    // Back up the superadmin's current session token before overwriting it.
    // Same lifetime as the impersonation token: once the token expires, exit
    // can't restore from backup anyway (verifyImpersonationToken rejects an
    // expired token), so a longer-lived backup would only widen exposure.
    const current = cookieStore.get(sessionCookieName)?.value
    if (current) {
      cookieStore.set(IMPERSONATION_BACKUP_COOKIE, current, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        domain: cookieDomain,
        maxAge: IMPERSONATION_MAX_AGE,
      })
    }

    // Overwrite the session cookie with the impersonation token.
    cookieStore.set(sessionCookieName, token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      domain: cookieDomain,
      maxAge: IMPERSONATION_MAX_AGE,
    })

    const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
    const protocol = process.env.NODE_ENV === "production" ? "https" : "http"
    const url = `${protocol}://${org.slug}.${rootDomain}/dashboard`

    return NextResponse.json({ success: true, url })
  } catch (error) {
    console.error("Error starting impersonation:", error)
    return NextResponse.json({ error: "Error al iniciar impersonación" }, { status: 500 })
  }
}
