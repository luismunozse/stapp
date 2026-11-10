import type { NextResponse } from "next/server"

// The NextAuth session cookie: same name and domain rules as lib/auth.ts. It
// lives in its own file because the middleware runs on the Edge and cannot
// import auth.ts; requireAuth() needs the same rules to clear the cookie of a
// stale session, and the two must not drift apart.

export function sessionCookieName(): string {
  return process.env.NODE_ENV === "production"
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token"
}

export function sessionCookieDomain(): string | undefined {
  if (process.env.COOKIE_DOMAIN) return process.env.COOKIE_DOMAIN
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_ROOT_DOMAIN) {
    return `.${process.env.NEXT_PUBLIC_ROOT_DOMAIN}`
  }
  return undefined
}

/** Expires the session cookie on `res` (and returns it) so the next navigation lands on /login. */
export function clearSessionCookie<T extends NextResponse>(res: T): T {
  res.cookies.set(sessionCookieName(), "", {
    maxAge: 0,
    path: "/",
    domain: sessionCookieDomain(),
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
  })
  return res
}
