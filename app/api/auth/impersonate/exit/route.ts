import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { logSuperadminAudit } from "@/lib/superadmin-audit"
import {
  verifyImpersonationToken,
  getSessionCookieName,
  IMPERSONATION_BACKUP_COOKIE,
} from "@/lib/impersonation"

function getCookieDomain(): string | undefined {
  if (process.env.COOKIE_DOMAIN) return process.env.COOKIE_DOMAIN
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_ROOT_DOMAIN) {
    return `.${process.env.NEXT_PUBLIC_ROOT_DOMAIN}`
  }
  return undefined
}

/**
 * Ends an impersonation session. Restores the superadmin's original session
 * cookie byte-identical from the backup cookie (no re-minting → no custom
 * crypto, no chance of a weakened session), deletes the backup, and audits END.
 *
 * Safe to call from any subdomain: the backup cookie is scoped to the root
 * domain, so it travels to tenant subdomains where the banner lives.
 */
export async function POST() {
  try {
    const secret = process.env.NEXTAUTH_SECRET
    const sessionCookieName = getSessionCookieName()
    const cookieDomain = getCookieDomain()
    const secure = process.env.NODE_ENV === "production"
    const cookieStore = await cookies()

    const currentSession = cookieStore.get(sessionCookieName)?.value
    const backup = cookieStore.get(IMPERSONATION_BACKUP_COOKIE)?.value

    // Only proceed if the current session is genuinely an impersonation token.
    // This prevents a normal user from poking the endpoint to swap cookies.
    let claims = null
    if (currentSession && secret) {
      claims = await verifyImpersonationToken(currentSession, secret)
    }

    if (!claims) {
      return NextResponse.json(
        { error: "No hay una sesión de impersonación activa" },
        { status: 400 }
      )
    }

    // Audit BEFORE swapping cookies so an audit failure can't leave an
    // ended-but-unlogged impersonation.
    await logSuperadminAudit({
      email: claims.impersonatorEmail,
      action: "UPDATE",
      entity: "sessions",
      entityId: claims.id,
      organizationId: claims.organizationId,
      description: `Impersonación finalizada (org ${claims.organizationId})`,
      metadata: {
        event: "IMPERSONATION_END",
        impersonatedOrgId: claims.organizationId,
        impersonatedUserId: claims.id,
        restored: !!backup,
      },
    })

    if (backup) {
      // Restore the original superadmin session, byte-identical.
      cookieStore.set(sessionCookieName, backup, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        domain: cookieDomain,
        // Mirror the session cookie lifetime (30 days); the JWT inside carries
        // its own exp and the auth callbacks refresh it as usual.
        maxAge: 30 * 24 * 60 * 60,
      })
      cookieStore.delete({ name: IMPERSONATION_BACKUP_COOKIE, domain: cookieDomain, path: "/" })
    } else {
      // No backup (expired/cleared): fail safe by clearing the session.
      cookieStore.delete({ name: sessionCookieName, domain: cookieDomain, path: "/" })
    }

    const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
    const protocol = process.env.NODE_ENV === "production" ? "https" : "http"
    const url = `${protocol}://admin.${rootDomain}/superadmin/dashboard`

    return NextResponse.json({ success: true, url })
  } catch (error) {
    console.error("Error ending impersonation:", error)
    return NextResponse.json({ error: "Error al finalizar impersonación" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"
