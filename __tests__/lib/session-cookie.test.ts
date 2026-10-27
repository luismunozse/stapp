// @vitest-environment node
/**
 * The NextAuth session cookie, as the middleware and requireAuth() clear it.
 * Same name and domain rules as lib/auth.ts: the middleware cannot import that
 * file (Edge), so these rules live in lib/session-cookie.ts and both use them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextResponse } from "next/server"
import { clearSessionCookie, sessionCookieDomain, sessionCookieName } from "@/lib/session-cookie"
import { leerFuentes, sinComentarios } from "../helpers/fuentes"

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

// lib/auth.ts cannot be imported in tests (next-auth does not load here), so the
// cookie rules are pinned statically: they live in lib/session-cookie.ts and
// every other place that needs them imports them.
describe("one source for the cookie rules", () => {
  const fuentes = leerFuentes(["app", "lib", "components", "hooks", "contexts"], ["middleware.ts"])

  it("scans the real tree (guards against a ghost loop)", () => {
    expect(fuentes.length).toBeGreaterThan(500)
    expect(fuentes.some((f) => f.rel === "lib/auth.ts")).toBe(true)
  })

  it.each([
    "lib/auth.ts",
    "lib/impersonation.ts",
    "middleware.ts",
    "app/api/superadmin/impersonate/route.ts",
    "app/api/auth/impersonate/exit/route.ts",
  ])("%s takes the cookie name and domain from lib/session-cookie.ts", (rel) => {
    const f = fuentes.find((x) => x.rel === rel)
    expect(f, rel).toBeDefined()
    expect(sinComentarios(f!.src)).toMatch(/from "@\/lib\/session-cookie"/)
  })

  it("nothing else hardcodes the session cookie name or reads process.env.COOKIE_DOMAIN", () => {
    const duplicados = fuentes
      .filter((f) => f.rel !== "lib/session-cookie.ts")
      .filter((f) => /next-auth\.session-token|process\.env\.COOKIE_DOMAIN/.test(sinComentarios(f.src)))
      .map((f) => f.rel)
      .sort()
    expect(duplicados).toEqual([])
  })
})
