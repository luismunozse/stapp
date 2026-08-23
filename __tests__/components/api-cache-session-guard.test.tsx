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
import { render, waitFor, act } from "@testing-library/react"

const useSessionMock = vi.fn()
vi.mock("next-auth/react", () => ({ useSession: () => useSessionMock() }))

import { ApiCacheSessionGuard, SW_API_IDENTITY_KEY } from "@/components/pwa/api-cache-session-guard"

const USER_A = { id: "u-A", organizationId: "org-1", role: "ADMIN", sucursalId: null }
const USER_B = { id: "u-B", organizationId: "org-2", role: "VENDEDOR", sucursalId: "suc-B" }

let postMessage: ReturnType<typeof vi.fn>
/** Contesta CACHE_CLEARED, como hace el worker cuando termino de borrar. */
let confirmar: () => void
/** Simula clients.claim(): recien ahi hay controller, y llega controllerchange. */
let tomarControl: () => void

function mockSesion(user: unknown, status = "authenticated") {
  useSessionMock.mockReturnValue({ data: user ? { user } : null, status })
}

function instalarServiceWorker({ conControlador = true } = {}) {
  const listeners = new Map<string, Set<(event: any) => void>>()
  const emitir = (tipo: string, event: any) =>
    listeners.get(tipo)?.forEach((cb) => cb(event))
  postMessage = vi.fn()
  const controlador = { postMessage }
  confirmar = () => emitir("message", { data: { type: "CACHE_CLEARED" } })
  const sw = {
    controller: conControlador ? controlador : null,
    addEventListener: (type: string, cb: (event: any) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(cb)
    },
    removeEventListener: (type: string, cb: (event: any) => void) => {
      listeners.get(type)?.delete(cb)
    },
  }
  tomarControl = () => {
    sw.controller = controlador
    emitir("controllerchange", new Event("controllerchange"))
  }
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: sw })
}

/** Renderiza, deja que el worker confirme y espera a que el efecto termine. */
async function renderYConfirmar() {
  render(<ApiCacheSessionGuard />)
  await waitFor(() => expect(postMessage).toHaveBeenCalled())
  confirmar()
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  instalarServiceWorker()
})

afterEach(() => {
  // @ts-expect-error — jsdom's navigator has no serviceWorker to restore.
  delete navigator.serviceWorker
})

describe("ApiCacheSessionGuard", () => {
  it("AC-1 — otro usuario en el mismo equipo: limpia y recien ahi recuerda quien es", async () => {
    window.localStorage.setItem(SW_API_IDENTITY_KEY, "u-A|org-1|ADMIN|")
    mockSesion(USER_B)

    await renderYConfirmar()

    expect(postMessage).toHaveBeenCalledWith({ type: "CLEAR_CACHE", cache: "api" })
    await waitFor(() =>
      expect(window.localStorage.getItem(SW_API_IDENTITY_KEY)).toBe("u-B|org-2|VENDEDOR|suc-B")
    )
  })

  it("AC-8 — sin controller NO guarda la identidad: reintenta en vez de quedar latcheado", async () => {
    // Sin controller el postMessage no ocurre y el borrado nunca pasa: pasa
    // despues de un force-reload, o con un SW nuevo activandose antes de
    // clients.claim(). Si igual se anotara la identidad de B, el guard no
    // volveria a intentar NUNCA y el cache de la org 1 quedaria servido a la
    // org 2 de manera permanente — la fuga, ahora durable.
    instalarServiceWorker({ conControlador: false })
    window.localStorage.setItem(SW_API_IDENTITY_KEY, "u-A|org-1|ADMIN|")
    mockSesion(USER_B)

    render(<ApiCacheSessionGuard />)
    // Un macrotask completo: sin esto la aserccion corre ANTES de que la cadena
    // del clear siga, y pasaria igual aunque el guard anotara la identidad.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(window.localStorage.getItem(SW_API_IDENTITY_KEY)).toBe("u-A|org-1|ADMIN|")
  })

  it("AC-10 — sin controller al montar: reintenta cuando el worker toma control", async () => {
    // AC-8 deja el reintento pendiente, pero el "proximo montaje" no existe:
    // ApiCacheSessionGuard vive en Providers, que no se desmonta en toda la
    // sesion, y el efecto solo re-corre si cambia status/identidad. En la
    // primera visita la pagina esta sin controlar hasta que el SW activa y
    // llama clients.claim(), asi que el clear resuelve false y no se reintenta
    // NUNCA hasta una recarga completa. Escuchar controllerchange lo vuelve un
    // reintento de verdad.
    instalarServiceWorker({ conControlador: false })
    window.localStorage.setItem(SW_API_IDENTITY_KEY, "u-A|org-1|ADMIN|")
    mockSesion(USER_B)

    render(<ApiCacheSessionGuard />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(postMessage).not.toHaveBeenCalled()

    await act(async () => {
      tomarControl()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(postMessage).toHaveBeenCalledWith({ type: "CLEAR_CACHE", cache: "api" })
    confirmar()
    await waitFor(() =>
      expect(window.localStorage.getItem(SW_API_IDENTITY_KEY)).toBe("u-B|org-2|VENDEDOR|suc-B")
    )
  })

  it("AC-11 — una vez limpio, un controllerchange posterior no vuelve a limpiar", async () => {
    // El worker puede cambiar de controlador varias veces por sesion (un
    // deploy activa uno nuevo). Reintentar con la identidad ya anotada tiraria
    // el cache que la propia sesion acaba de llenar, sin proteger a nadie.
    window.localStorage.setItem(SW_API_IDENTITY_KEY, "u-A|org-1|ADMIN|")
    mockSesion(USER_B)

    await renderYConfirmar()
    await waitFor(() =>
      expect(window.localStorage.getItem(SW_API_IDENTITY_KEY)).toBe("u-B|org-2|VENDEDOR|suc-B")
    )
    expect(postMessage).toHaveBeenCalledTimes(1)

    await act(async () => {
      tomarControl()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(postMessage).toHaveBeenCalledTimes(1)
  })

  it("AC-9 — si el worker no confirma, tampoco guarda la identidad", async () => {
    vi.useFakeTimers()
    try {
      window.localStorage.setItem(SW_API_IDENTITY_KEY, "u-A|org-1|ADMIN|")
      mockSesion(USER_B)

      render(<ApiCacheSessionGuard />)
      await vi.advanceTimersByTimeAsync(5_000)

      expect(window.localStorage.getItem(SW_API_IDENTITY_KEY)).toBe("u-A|org-1|ADMIN|")
    } finally {
      vi.useRealTimers()
    }
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

  it("AC-5 — sin marca previa limpia igual: la ausencia de marca no prueba que no hubo nadie", async () => {
    // `recordar()` se traga su propio fallo (Safari en privado, cuota): si la
    // escritura fallo para el usuario A, A igual lleno el cache y no dejo marca.
    // Leer esa ausencia como "equipo nuevo" y saltear la limpieza deja servido
    // el cache de A al usuario B — justo el caso para el que existe el guard.
    // Limpiar de mas en un equipo realmente nuevo cuesta el cache que la propia
    // sesion acaba de traer, que es nada.
    mockSesion(USER_A)

    await renderYConfirmar()

    expect(postMessage).toHaveBeenCalledWith({ type: "CLEAR_CACHE", cache: "api" })
    await waitFor(() =>
      expect(window.localStorage.getItem(SW_API_IDENTITY_KEY)).toBe("u-A|org-1|ADMIN|")
    )
  })

  it.each(["loading", "unauthenticated"])(
    "AC-6 — status %s: NO limpia ni pisa la identidad guardada",
    (status) => {
      // La PWA offline arranca asi mientras SessionRefresher restaura la sesion.
      // Limpiar aca le sacaria al operador lo unico que tiene justo cuando no
      // hay red para volver a llenarlo, y sin ganar nada: al usuario siguiente
      // lo protege el clear de SU login, que ademas ocurre con red disponible.
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
