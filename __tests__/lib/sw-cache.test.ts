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
import { clearServiceWorkerCache } from "@/lib/sw-cache"

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

describe("clearServiceWorkerCache", () => {
  it("SC-1 — le pide al worker que borre los caches", () => {
    const postMessage = vi.fn()
    mockServiceWorker({ postMessage })

    clearServiceWorkerCache()

    expect(postMessage).toHaveBeenCalledWith({ type: "CLEAR_CACHE" })
  })

  it("SC-2 — sin worker controlando la pagina no explota (primera carga, o SW no soportado)", () => {
    mockServiceWorker(null)

    expect(() => clearServiceWorkerCache()).not.toThrow()
  })

  it("SC-3 — sin serviceWorker en el navegador tampoco explota", () => {
    // @ts-expect-error — jsdom's navigator has no serviceWorker at all.
    delete navigator.serviceWorker

    expect(() => clearServiceWorkerCache()).not.toThrow()
  })
})
