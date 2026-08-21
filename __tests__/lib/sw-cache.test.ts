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
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { controller },
  })
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

  it("SC-2 — sin worker controlando la pagina no explota (primera carga, o SW no soportado)", () => {
    mockServiceWorker(null)

    expect(() => clearServiceWorkerApiCache()).not.toThrow()
  })

  it("SC-3 — sin serviceWorker en el navegador tampoco explota", () => {
    // @ts-expect-error — jsdom's navigator has no serviceWorker at all.
    delete navigator.serviceWorker

    expect(() => clearServiceWorkerApiCache()).not.toThrow()
  })
})
