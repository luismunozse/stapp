// @vitest-environment node
/**
 * The NextAuth session cookie, as the middleware and requireAuth() clear it.
 * Same name and domain rules as lib/auth.ts: the middleware cannot import that
 * file (Edge), so these rules live in lib/session-cookie.ts and both use them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextResponse } from "next/server"
import { clearSessionCookie, sessionCookieDomain, sessionCookieName } from "@/lib/session-cookie"

beforeEach(() => {
  delete process.env.COOKIE_DOMAIN
  delete process.env.NEXT_PUBLIC_ROOT_DOMAIN
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("sessionCookieName / sessionCookieDomain", () => {
  it("development: plain name, no domain", () => {
    vi.stubEnv("NODE_ENV", "development")
    expect(sessionCookieName()).toBe("next-auth.session-token")
    expect(sessionCookieDomain()).toBeUndefined()
  })

  it("production: __Secure- name and the root domain shared by every subdomain", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "stapp.com.ar")
    expect(sessionCookieName()).toBe("__Secure-next-auth.session-token")
    expect(sessionCookieDomain()).toBe(".stapp.com.ar")
  })

  it("COOKIE_DOMAIN wins over the derived domain", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "stapp.com.ar")
    vi.stubEnv("COOKIE_DOMAIN", ".otro.test")
    expect(sessionCookieDomain()).toBe(".otro.test")
  })
})

describe("clearSessionCookie", () => {
  it("expires the cookie on the response it is given and returns that same response", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "stapp.com.ar")
    const res = NextResponse.json({ error: "x" }, { status: 401 })

    const devuelta = clearSessionCookie(res)

    expect(devuelta).toBe(res)
    expect(res.cookies.get("__Secure-next-auth.session-token")).toMatchObject({
      value: "",
      maxAge: 0,
      path: "/",
      domain: ".stapp.com.ar",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
    })
  })

  it("development: no Secure flag and no domain", () => {
    vi.stubEnv("NODE_ENV", "development")
    const res = clearSessionCookie(NextResponse.json({}, { status: 401 }))

    const cookie = res.cookies.get("next-auth.session-token")
    expect(cookie).toMatchObject({ value: "", maxAge: 0, path: "/", httpOnly: true })
    expect(cookie?.secure).toBeFalsy()
    expect(cookie?.domain).toBeUndefined()
  })
})
