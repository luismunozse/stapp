/**
 * Tests: lib/sw-cache — asking the service worker to drop its caches.
 *
 * The Cache API is keyed by URL alone: no cookie, no user, no org. Nothing the
 * service worker stores knows who it belongs to, so the only thing that can
 * scope it is dropping it when the identity behind those responses changes.
 * This helper is that lever, and every caller of it depends on it being a
 * no-op — never a throw — when there is no worker to talk to.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { clearServiceWorkerApiCache } from "@/lib/sw-cache"

function mockServiceWorker(controller: { postMessage: ReturnType<typeof vi.fn> } | null) {
  const listeners = new Set<(event: { data: unknown }) => void>()
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      controller,
      addEventListener: (type: string, cb: (event: { data: unknown }) => void) => {
        if (type === "message") listeners.add(cb)
      },
      removeEventListener: (_type: string, cb: (event: { data: unknown }) => void) => {
        listeners.delete(cb)
      },
    },
  })
  return {
    /** Simula la respuesta del worker una vez que terminó de borrar. */
    confirmar: () => listeners.forEach((cb) => cb({ data: { type: "CACHE_CLEARED" } })),
    get suscriptos() {
      return listeners.size
    },
  }
}

afterEach(() => {
  // @ts-expect-error — jsdom's navigator has no serviceWorker to restore.
  delete navigator.serviceWorker
})

describe("clearServiceWorkerApiCache", () => {
  it("SC-1 — le pide al worker que borre SOLO el cache de API", () => {
    // Sin el scope se lleva puesto el shell de navegacion y los assets: el
    // equipo del mostrador que rota operadores dejaria de arrancar offline por
    // algo que no tiene nada que ver con la sesion.
    const postMessage = vi.fn()
    mockServiceWorker({ postMessage })

    clearServiceWorkerApiCache()

    expect(postMessage).toHaveBeenCalledWith({ type: "CLEAR_CACHE", cache: "api" })
  })

  it("SC-2 — resuelve true recien cuando el worker confirma el borrado", async () => {
    const postMessage = vi.fn()
    const sw = mockServiceWorker({ postMessage })

    const pendiente = clearServiceWorkerApiCache()
    sw.confirmar()

    expect(await pendiente).toBe(true)
  })

  it("SC-3 — sin controller resuelve FALSE: el mensaje no llego a ningun lado", async () => {
    // Pasa despues de un force-reload, con un SW nuevo todavia activandose antes
    // de clients.claim(), o si el registro fallo. El caller tiene que poder
    // distinguir "limpie" de "no habia a quien pedirselo": tratar esto como
    // exito es lo que dejaba el cache de otra sesion servido para siempre.
    mockServiceWorker(null)

    expect(await clearServiceWorkerApiCache()).toBe(false)
  })

  it("SC-4 — sin serviceWorker en el navegador resuelve false y no explota", async () => {
    // @ts-expect-error — jsdom's navigator has no serviceWorker at all.
    delete navigator.serviceWorker

    expect(await clearServiceWorkerApiCache()).toBe(false)
  })

  it("SC-5 — si el worker nunca contesta, resuelve false en vez de colgarse", async () => {
    vi.useFakeTimers()
    try {
      const postMessage = vi.fn()
      mockServiceWorker({ postMessage })

      const pendiente = clearServiceWorkerApiCache()
      await vi.advanceTimersByTimeAsync(5_000)

      expect(await pendiente).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it("SC-6 — deja de escuchar al terminar (no acumula listeners por cada login)", async () => {
    const postMessage = vi.fn()
    const sw = mockServiceWorker({ postMessage })

    const pendiente = clearServiceWorkerApiCache()
    sw.confirmar()
    await pendiente

    expect(sw.suscriptos).toBe(0)
  })
})
