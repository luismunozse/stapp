import { encode, decode } from "next-auth/jwt"

type Rol = "ADMIN" | "TECNICO" | "VENDEDOR"

/**
 * Lifetime of an impersonation session token. Kept deliberately short: an
 * impersonation grant is a sensitive, audited action and must not linger.
 */
export const IMPERSONATION_MAX_AGE = 30 * 60 // 30 minutes (seconds)

/**
 * Backup cookie that holds the superadmin's REAL session token while they
 * impersonate a tenant. It has a unique name (NOT the NextAuth session cookie
 * name) so it never shadows the session cookie — both can coexist on the
 * `.stapp.com.ar` domain. On exit we restore it byte-identical, so the
 * superadmin's original session is never re-derived or weakened.
 */
export const IMPERSONATION_BACKUP_COOKIE = "stapp-sa-backup"

/** The only state-changing path allowed during impersonation: ending it. */
export const IMPERSONATION_EXIT_PATH = "/api/auth/impersonate/exit"

/**
 * Central read-only decision for impersonation. Returns true when a request
 * must be blocked (HTTP 403) because the session is impersonating and the
 * request would mutate state. Pure so the security rule can be tested in
 * isolation; the middleware calls this with values pulled from the request.
 *
 * Rules:
 *  - Non-impersonating sessions are never blocked here.
 *  - Safe methods (GET/HEAD/OPTIONS) are allowed.
 *  - Next.js server actions (detected via the `next-action` header) are blocked
 *    regardless of method — they mutate.
 *  - The sanctioned exit endpoint is always allowed so the superadmin can leave.
 *  - signout is intentionally NOT allowlisted: a signout would fire NextAuth's
 *    signOut event against the impersonated tenant user.
 */
export function isImpersonationWriteBlocked(opts: {
  isImpersonating: boolean | undefined
  method: string
  pathname: string
  isServerAction: boolean
}): boolean {
  if (!opts.isImpersonating) return false
  if (opts.pathname === IMPERSONATION_EXIT_PATH) return false
  const method = opts.method.toUpperCase()
  const isSafeMethod =
    method === "GET" || method === "HEAD" || method === "OPTIONS"
  return !isSafeMethod || opts.isServerAction
}

/**
 * Claims carried by an impersonation token. This is a real NextAuth JWT (so the
 * existing middleware/`auth()` accept it transparently) with extra flags:
 *  - `isSuperadmin` is ALWAYS false — impersonation never carries admin power.
 *  - `isImpersonating` is ALWAYS true — middleware uses it to enforce read-only.
 *  - `impersonatorEmail` records WHO is impersonating, for audit + exit.
 */
export interface ImpersonationClaims {
  id: string
  organizationId: string
  role: Rol
  sucursalId?: string | null
  isSuperadmin: false
  isImpersonating: true
  impersonatorEmail: string
  name?: string | null
  email?: string | null
  exp?: number
}

/**
 * NextAuth v5 derives the JWE encryption key from `secret` + `salt`, and
 * `getToken()` uses the cookie name as the salt. So a token meant to be read
 * from the session cookie MUST be encoded with `salt = sessionCookieName`,
 * otherwise the middleware can't decrypt it.
 */
export function getSessionCookieName(): string {
  return process.env.NODE_ENV === "production"
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token"
}

type MintInput = Omit<ImpersonationClaims, "isSuperadmin" | "isImpersonating">

/**
 * Mints an impersonation session token. The caller passes the TARGET user's
 * identity + the impersonator's email. We hard-set the security flags here so
 * a caller can never accidentally (or maliciously) mint a privileged token.
 */
export async function mintImpersonationToken(
  claims: MintInput,
  secret: string
): Promise<string> {
  // Defense in depth: reject any attempt to smuggle elevated privileges in.
  if ((claims as Partial<ImpersonationClaims>).isSuperadmin) {
    throw new Error("Impersonation tokens can never carry superadmin privileges")
  }
  if (!claims.impersonatorEmail) {
    throw new Error("Impersonation tokens require an impersonatorEmail for audit")
  }

  const now = Math.floor(Date.now() / 1000)
  const token: ImpersonationClaims = {
    id: claims.id,
    organizationId: claims.organizationId,
    role: claims.role,
    sucursalId: claims.sucursalId ?? null,
    name: claims.name ?? null,
    email: claims.email ?? null,
    impersonatorEmail: claims.impersonatorEmail,
    isSuperadmin: false,
    isImpersonating: true,
    exp: now + IMPERSONATION_MAX_AGE,
  }

  return encode({
    secret,
    salt: getSessionCookieName(),
    maxAge: IMPERSONATION_MAX_AGE,
    token: token as unknown as Record<string, unknown>,
  })
}

/**
 * Verifies an impersonation token. Returns the claims only if the token
 * decrypts, has not expired, and is genuinely an impersonation token (the
 * `isImpersonating` flag and `impersonatorEmail` are present). Returns null for
 * tampered tokens, wrong secrets, expired tokens, or plain session tokens.
 */
export async function verifyImpersonationToken(
  token: string,
  secret: string
): Promise<ImpersonationClaims | null> {
  let payload: Record<string, unknown> | null = null
  try {
    payload = (await decode({
      secret,
      salt: getSessionCookieName(),
      token,
    })) as Record<string, unknown> | null
  } catch {
    return null
  }

  if (!payload) return null
  if (payload.isImpersonating !== true) return null
  if (typeof payload.impersonatorEmail !== "string" || !payload.impersonatorEmail) return null
  if (typeof payload.id !== "string" || typeof payload.organizationId !== "string") return null

  // Manual expiry guard — do not trust decode() alone for the exp check.
  const exp = typeof payload.exp === "number" ? payload.exp : 0
  if (!exp || exp < Math.floor(Date.now() / 1000)) return null

  return {
    id: payload.id,
    organizationId: payload.organizationId,
    role: payload.role as Rol,
    sucursalId: (payload.sucursalId as string | null) ?? null,
    name: (payload.name as string | null) ?? null,
    email: (payload.email as string | null) ?? null,
    impersonatorEmail: payload.impersonatorEmail,
    isSuperadmin: false,
    isImpersonating: true,
    exp,
  }
}
