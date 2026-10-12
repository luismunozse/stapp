import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, waitFor } from "@testing-library/react"

const signIn = vi.fn()
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated", update: vi.fn() }),
  signIn: (...args: unknown[]) => signIn(...args),
  signOut: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  usePathname: () => "/inventario",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

import { SessionRefresher } from "@/components/auth/session-refresher"

const reload = vi.fn()

describe("SessionRefresher — restauración PWA", () => {
  beforeEach(() => {
    reload.mockClear()
    signIn.mockReset().mockResolvedValue({ ok: true, error: null })
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem("pwa_refresh_token", "token-valido")
    localStorage.setItem(
      "pwa_refresh_token_expires",
      new Date(Date.now() + 86_400_000).toISOString()
    )
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }))
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("recarga una vez para aplicar la sesión restaurada", async () => {
    render(
      <SessionRefresher>
        <div>contenido</div>
      </SessionRefresher>
    )
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
  })

  it("no vuelve a recargar si ya se restauró en esta pestaña (corta el bucle)", async () => {
    render(
      <SessionRefresher>
        <div>contenido</div>
      </SessionRefresher>
    )
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))

    // Simula el estado tras la recarga: misma pestaña, sesión sigue sin
    // reconocerse. Sin guarda, esto reinicia el ciclo recarga → restaurar.
    reload.mockClear()
    render(
      <SessionRefresher>
        <div>contenido</div>
      </SessionRefresher>
    )

    await new Promise((r) => setTimeout(r, 300))
    expect(reload).not.toHaveBeenCalled()
  })
})
