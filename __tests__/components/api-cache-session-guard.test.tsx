/**
 * Tests: ApiCacheSessionGuard — dropping the SW cache when the session identity
 * changes.
 *
 * The service worker cache is shared by every session in the browser profile
 * and keyed by URL alone. On a shared counter tablet, user A of org 1 loads the
 * client list and logs out; user B of org 2 logs in minutes later and
 * stale-while-revalidate hands them org 1's clients. No route-by-route
 * exclusion fixes that — the cache simply has no idea whose data it holds.
 *
 * The guard is the piece that gives it one: it remembers the identity behind
 * the cached responses and drops everything when a DIFFERENT identity shows up.
 * The tests below pin both halves — it must clear when it has to, and it must
 * NOT clear when it does not, because an unnecessary clear takes the offline
 * PWA's data with it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render } from "@testing-library/react"

const useSessionMock = vi.fn()
vi.mock("next-auth/react", () => ({ useSession: () => useSessionMock() }))

import { ApiCacheSessionGuard, SW_API_IDENTITY_KEY } from "@/components/pwa/api-cache-session-guard"

const USER_A = { id: "u-A", organizationId: "org-1", role: "ADMIN", sucursalId: null }
const USER_B = { id: "u-B", organizationId: "org-2", role: "VENDEDOR", sucursalId: "suc-B" }

let postMessage: ReturnType<typeof vi.fn>

function mockSesion(user: unknown, status = "authenticated") {
  useSessionMock.mockReturnValue({ data: user ? { user } : null, status })
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  postMessage = vi.fn()
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { controller: { postMessage } },
  })
})

afterEach(() => {
  // @ts-expect-error — jsdom's navigator has no serviceWorker to restore.
  delete navigator.serviceWorker
})

describe("ApiCacheSessionGuard", () => {
  it("AC-1 — otro usuario en el mismo equipo: limpia el cache antes de que pueda leerlo", () => {
    window.localStorage.setItem(SW_API_IDENTITY_KEY, "u-A|org-1|ADMIN|")
    mockSesion(USER_B)

    render(<ApiCacheSessionGuard />)

    expect(postMessage).toHaveBeenCalledWith({ type: "CLEAR_CACHE", cache: "api" })
    expect(window.localStorage.getItem(SW_API_IDENTITY_KEY)).toBe("u-B|org-2|VENDEDOR|suc-B")
  })

  it("AC-2 — otra ORG en el mismo equipo: limpia (la fuga entre tenants es la peor)", () => {
    window.localStorage.setItem(SW_API_IDENTITY_KEY, "u-A|org-1|ADMIN|")
    mockSesion({ ...USER_A, organizationId: "org-2" })

    render(<ApiCacheSessionGuard />)

    expect(postMessage).toHaveBeenCalledWith({ type: "CLEAR_CACHE", cache: "api" })
  })

  it("AC-3 — le cambian la sucursal asignada al usuario: limpia (el scope de lectura cambio)", () => {
    window.localStorage.setItem(SW_API_IDENTITY_KEY, "u-B|org-2|VENDEDOR|suc-B")
    mockSesion({ ...USER_B, sucursalId: "suc-C" })

    render(<ApiCacheSessionGuard />)

    expect(postMessage).toHaveBeenCalledWith({ type: "CLEAR_CACHE", cache: "api" })
  })

  it("AC-4 — misma identidad: NO limpia (cada navegacion no puede tirar el cache offline)", () => {
    window.localStorage.setItem(SW_API_IDENTITY_KEY, "u-A|org-1|ADMIN|")
    mockSesion(USER_A)

    render(<ApiCacheSessionGuard />)

    expect(postMessage).not.toHaveBeenCalled()
  })

  it("AC-5 — primer login del equipo: NO limpia, solo recuerda quien es", () => {
    mockSesion(USER_A)

    render(<ApiCacheSessionGuard />)

    expect(postMessage).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(SW_API_IDENTITY_KEY)).toBe("u-A|org-1|ADMIN|")
  })

  it.each(["loading", "unauthenticated"])(
    "AC-6 — status %s: NO limpia ni pisa la identidad guardada",
    (status) => {
      // La PWA offline arranca asi mientras SessionRefresher restaura la sesion.
      // Limpiar aca le vaciaria el catalogo al operador justo cuando el cache es
      // lo unico que tiene, y sin ganar nada: al usuario siguiente lo protege el
      // clear de SU login, que es el momento en que se puede volver a llenar.
      window.localStorage.setItem(SW_API_IDENTITY_KEY, "u-A|org-1|ADMIN|")
      mockSesion(null, status)

      render(<ApiCacheSessionGuard />)

      expect(postMessage).not.toHaveBeenCalled()
      expect(window.localStorage.getItem(SW_API_IDENTITY_KEY)).toBe("u-A|org-1|ADMIN|")
    }
  )

  it("AC-7 — sin poder leer quien estuvo antes, limpia igual (no se puede afirmar que es el mismo)", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("localStorage bloqueado")
    })
    try {
      mockSesion(USER_A)

      render(<ApiCacheSessionGuard />)

      expect(postMessage).toHaveBeenCalledWith({ type: "CLEAR_CACHE", cache: "api" })
    } finally {
      getItem.mockRestore()
    }
  })
})
