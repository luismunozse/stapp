import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, render, screen } from "@testing-library/react"

const signIn = vi.fn()
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated", update: vi.fn() }),
  signIn: (...args: unknown[]) => signIn(...args),
  signOut: vi.fn(),
}))

const ruta = vi.hoisted(() => ({ actual: "/google-auth" }))
vi.mock("next/navigation", () => ({
  usePathname: () => ruta.actual,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

import { SessionRefresher, esRutaSinSesion } from "@/components/auth/session-refresher"

describe("esRutaSinSesion", () => {
  it.each([
    "/",
    "/pricing",
    "/login",
    "/google-auth",
    "/app-entry",
    "/tenant-not-found",
    "/reset-password/abc123",
    "/registro/verificar",
    "/superadmin-login",
    "/seguimiento/tok",
    "/api/ordenes",
  ])("%s no requiere sesión", (path) => {
    expect(esRutaSinSesion(path)).toBe(true)
  })

  it.each(["/dashboard", "/ordenes/123", "/inventario"])("%s requiere sesión", (path) => {
    expect(esRutaSinSesion(path)).toBe(false)
  })
})

describe("SessionRefresher en /google-auth", () => {
  beforeEach(() => {
    ruta.actual = "/google-auth"
    signIn.mockReset()
    localStorage.clear()
    localStorage.setItem("pwa_refresh_token", "token")
    localStorage.setItem("pwa_refresh_token_expires", new Date(Date.now() + 86_400_000).toISOString())
  })
  afterEach(() => localStorage.clear())

  // Closing Google's popup gives the focus back to the page. Restoring the session
  // there unmounted the screen mid-login and showed the Google button again.
  it("al volver el foco no intenta restaurar la sesión ni desmonta la pantalla", async () => {
    render(
      <SessionRefresher>
        <p>pantalla de google</p>
      </SessionRefresher>
    )
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })
    expect(signIn).not.toHaveBeenCalled()
    expect(screen.getByText("pantalla de google")).toBeInTheDocument()
    expect(screen.queryByText("Restaurando sesión...")).not.toBeInTheDocument()
  })

  it("en una ruta del panel sí intenta restaurar (control)", async () => {
    ruta.actual = "/dashboard"
    signIn.mockResolvedValue({ ok: false, error: "x" })
    render(
      <SessionRefresher>
        <p>panel</p>
      </SessionRefresher>
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(signIn).toHaveBeenCalled()
  })
})
