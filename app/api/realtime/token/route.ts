import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createHmac } from "node:crypto"

/**
 * GET /api/realtime/token
 *
 * Mints a short-lived Supabase-compatible HS256 JWT for use with
 * supabase.realtime.setAuth(token). Allows the Realtime socket to connect
 * as Postgres role `authenticated` so org-scoped authenticated policies apply.
 *
 * Claims shape (matches what get_current_organization_id() reads from
 * request.jwt.claims):
 *   sub            – NextAuth user.id
 *   role           – "authenticated"
 *   aud            – "authenticated"
 *   organization_id – NextAuth user.organizationId
 *   iat            – issued-at (seconds)
 *   exp            – iat + 30 min
 *
 * Signing: HS256 with SUPABASE_JWT_SECRET (server-only env var).
 * Uses node:crypto — no extra dependency. jose is ESM-only WebCrypto and
 * adds unnecessary complexity for a simple HMAC operation in a Node.js env.
 *
 * IMPORTANT: Apply migration 202_rls_authenticated_realtime.sql BEFORE
 * deploying this endpoint so the authenticated role has a policy when the
 * socket switches.
 */

const TTL_SECONDS = 30 * 60 // 30 minutes

function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

function mintJwt(
  userId: string,
  organizationId: string,
  secret: string
): { token: string; exp: number; iat: number } {
  const iat = Math.floor(Date.now() / 1000)
  const exp = iat + TTL_SECONDS

  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const payload = b64url(
    JSON.stringify({
      sub: userId,
      role: "authenticated",
      aud: "authenticated",
      organization_id: organizationId,
      iat,
      exp,
    })
  )

  const signingInput = `${header}.${payload}`
  const signature = createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(signingInput)
    .digest("base64url")

  return { token: `${signingInput}.${signature}`, exp, iat }
}

export async function GET(_req: NextRequest): Promise<NextResponse> {
  // 1. Require authenticated NextAuth session
  const session = await auth()
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // 2. Require the JWT secret
  const secret = process.env.SUPABASE_JWT_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: "Server misconfiguration: SUPABASE_JWT_SECRET not set" },
      { status: 500 }
    )
  }

  // 3. Mint the token
  const { token, exp } = mintJwt(session.user.id, session.user.organizationId, secret)

  return NextResponse.json({
    token,
    expiresAt: new Date(exp * 1000).toISOString(),
  })
}
