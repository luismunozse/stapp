/**
 * Tests: public/sw.js API caching decisions.
 *
 * The service worker cache is shared by every session in the browser profile
 * and is keyed by URL alone — no cookie, no session, no role. Anything it
 * stores can therefore be replayed to a *different* user of the same terminal,
 * and to the same user after a sucursal switch. These tests pin the two rules
 * that follow from that:
 *
 *  - role/sucursal-scoped responses (`/api/inventario/*`) are never stored and
 *    never served from the cache;
 *  - org-wide responses that are still cached honour API_CACHE_TTL instead of
 *    living forever, while still falling back to a stale copy when offline.
 *
 * There is no bundler entry for sw.js (it ships verbatim from /public), so the
 * harness below evaluates the file against a fake ServiceWorkerGlobalScope.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import fs from "node:fs"
import path from "node:path"

const SW_SOURCE = fs.readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8")

/** Cache name is read from the source so a version bump does not silently skip tests. */
const API_CACHE_NAME = /const API_CACHE_NAME = '([^']+)'/.exec(SW_SOURCE)![1]

/** Header the SW stamps on cached API responses to age them out. */
const CACHED_AT_HEADER = "x-sw-cached-at"

const ORIGIN = "https://app.test"

type FakeRequest = { url: string; method: string; mode: string }

function cacheKey(request: FakeRequest | string): string {
  return typeof request === "string" ? request : request.url
}

class FakeCache {
  entries = new Map<string, Response>()
  /**
   * Simulates a storage-tight device: `cache.put` rejects with
   * QuotaExceededError, the way it does on a mobile PWA near its quota.
   */
  failPut = false
  async match(request: FakeRequest | string) {
    return this.entries.get(cacheKey(request))
  }
  async put(request: FakeRequest | string, response: Response) {
    if (this.failPut) {
      throw Object.assign(new Error("Quota exceeded"), { name: "QuotaExceededError" })
    }
    this.entries.set(cacheKey(request), response)
  }
  async delete(request: FakeRequest | string) {
    return this.entries.delete(cacheKey(request))
  }
  async addAll() {
    /* static assets are not under test */
  }
}

class FakeCacheStorage {
  stores = new Map<string, FakeCache>()
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache())
    return this.stores.get(name)!
  }
  async keys() {
    return [...this.stores.keys()]
  }
  async delete(name: string) {
    return this.stores.delete(name)
  }
  async match(request: FakeRequest | string) {
    for (const store of this.stores.values()) {
      const hit = await store.match(request)
      if (hit) return hit
    }
    return undefined
  }
}

function loadServiceWorker() {
  const listeners: Record<string, Array<(event: any) => void>> = {}
  const cacheStorage = new FakeCacheStorage()
  let networkHandler: (request: FakeRequest) => Promise<Response> = async () => {
    throw new Error("network not configured for this test")
  }

  const self = {
    addEventListener(type: string, handler: (event: any) => void) {
      ;(listeners[type] ||= []).push(handler)
    },
    skipWaiting() {},
    clients: {
      claim: async () => {},
      matchAll: async () => [],
    },
    registration: { showNotification: async () => {} },
    location: { origin: ORIGIN },
  }

  const factory = new Function(
    "self",
    "caches",
    "location",
    "fetch",
    "indexedDB",
    SW_SOURCE
  )
  factory(
    self,
    cacheStorage,
    { origin: ORIGIN },
    (request: FakeRequest) => networkHandler(request),
    {}
  )

  return {
    caches: cacheStorage,
    setNetwork(handler: (request: FakeRequest) => Promise<Response>) {
      networkHandler = handler
    },
    async dispatchFetch(pathname: string, init: Partial<FakeRequest> = {}) {
      const request: FakeRequest = {
        url: `${ORIGIN}${pathname}`,
        method: init.method ?? "GET",
        mode: init.mode ?? "cors",
      }
      const responded: Array<Promise<Response>> = []
      const event = {
        request,
        respondWith: (value: Promise<Response>) => {
          responded.push(value)
        },
        waitUntil: (value: Promise<unknown>) => value,
      }
      for (const handler of listeners.fetch ?? []) handler(event)
      return responded.length > 0 ? await responded[0] : null
    },
    async dispatchActivate() {
      const pending: Array<Promise<unknown>> = []
      const event = { waitUntil: (value: Promise<unknown>) => pending.push(value) }
      for (const handler of listeners.activate ?? []) handler(event)
      await Promise.all(pending)
    },
  }
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers },
  })
}

describe("service worker — API caching", () => {
  let sw: ReturnType<typeof loadServiceWorker>

  beforeEach(() => {
    sw = loadServiceWorker()
  })

  it("SW-1 — never stores /api/inventario responses (they vary by role and sucursal)", async () => {
    sw.setNetwork(async () => jsonResponse([{ id: "p1", precioCompra: 100 }]))

    const res = await sw.dispatchFetch("/api/inventario/search?q=&scope=venta&ventaInfo=true")

    expect(await res!.json()).toEqual([{ id: "p1", precioCompra: 100 }])
    expect(await sw.caches.match(`${ORIGIN}/api/inventario/search?q=&scope=venta&ventaInfo=true`)).toBeUndefined()
  })

  it("SW-2 — never replays a cached /api/inventario response to a later session", async () => {
    // Simulates an entry written by an ADMIN (or by a previous sucursal
    // selection) that a VENDEDOR on the same terminal must not be served.
    const url = `${ORIGIN}/api/inventario/search?q=&scope=venta`
    const store = await sw.caches.open(API_CACHE_NAME)
    await store.put(url, jsonResponse([{ id: "leaked", precioCompra: 100 }]))
    sw.setNetwork(async () => jsonResponse([{ id: "fresh" }]))

    const res = await sw.dispatchFetch("/api/inventario/search?q=&scope=venta")

    expect(await res!.json()).toEqual([{ id: "fresh" }])
  })

  it("SW-3 — org-wide routes keep stale-while-revalidate (offline PWA is deliberate)", async () => {
    const url = `${ORIGIN}/api/clientes?page=1`
    const store = await sw.caches.open(API_CACHE_NAME)
    await store.put(
      url,
      jsonResponse({ data: ["cached"] }, { [CACHED_AT_HEADER]: String(Date.now()) })
    )
    sw.setNetwork(async () => jsonResponse({ data: ["network"] }))

    const res = await sw.dispatchFetch("/api/clientes?page=1")

    expect(await res!.json()).toEqual({ data: ["cached"] })
  })

  it("SW-4 — a cached entry older than API_CACHE_TTL is not served while online", async () => {
    const url = `${ORIGIN}/api/clientes?page=1`
    const store = await sw.caches.open(API_CACHE_NAME)
    await store.put(
      url,
      jsonResponse({ data: ["stale"] }, { [CACHED_AT_HEADER]: String(Date.now() - 6 * 60 * 1000) })
    )
    sw.setNetwork(async () => jsonResponse({ data: ["network"] }))

    const res = await sw.dispatchFetch("/api/clientes?page=1")

    expect(await res!.json()).toEqual({ data: ["network"] })
  })

  it("SW-5 — an expired entry is still served when the network is unreachable", async () => {
    const url = `${ORIGIN}/api/clientes?page=1`
    const store = await sw.caches.open(API_CACHE_NAME)
    await store.put(
      url,
      jsonResponse({ data: ["stale"] }, { [CACHED_AT_HEADER]: String(Date.now() - 6 * 60 * 1000) })
    )
    sw.setNetwork(async () => {
      throw new Error("offline")
    })

    const res = await sw.dispatchFetch("/api/clientes?page=1")

    expect(await res!.json()).toEqual({ data: ["stale"] })
  })

  it("SW-7 — never stores the sucursal-scoped routes nested under /api/clientes", async () => {
    // deuda-sucursal and ordenes-pendientes both run sucursalParaLectura, so
    // their answer depends on the role and on the active sucursal exactly like
    // /api/inventario does — they just happen to sit under a cacheable prefix.
    sw.setNetwork(async () => jsonResponse({ deuda: 5000 }))

    await sw.dispatchFetch("/api/clientes/cli-1/deuda-sucursal")
    await sw.dispatchFetch("/api/clientes/cli-1/ordenes-pendientes")

    expect(await sw.caches.match(`${ORIGIN}/api/clientes/cli-1/deuda-sucursal`)).toBeUndefined()
    expect(await sw.caches.match(`${ORIGIN}/api/clientes/cli-1/ordenes-pendientes`)).toBeUndefined()
  })

  it("SW-8 — never replays a sucursal-scoped clientes response to a later session", async () => {
    const url = `${ORIGIN}/api/clientes/cli-1/deuda-sucursal`
    const store = await sw.caches.open(API_CACHE_NAME)
    // Freshly stamped on purpose: the TTL must not be what saves us here.
    await store.put(
      url,
      jsonResponse({ deuda: 999999, scope: "org-wide" }, { [CACHED_AT_HEADER]: String(Date.now()) })
    )
    sw.setNetwork(async () => jsonResponse({ deuda: 5000, scope: "sucursal" }))

    const res = await sw.dispatchFetch("/api/clientes/cli-1/deuda-sucursal")

    expect(await res!.json()).toEqual({ deuda: 5000, scope: "sucursal" })
  })

  // A half-connected link — captive portal, dead cell, the normal state of a
  // shop counter — is NOT the offline case: `fetch` neither answers nor rejects,
  // it hangs for the OS connect timeout. Waiting that out before falling back to
  // a usable stale copy is the failure mode offline tests cannot catch, so the
  // network gets a short budget and the cached copy wins once it runs out.
  it("SW-11 — con la red colgada, una entrada vencida se sirve sin esperar el timeout del SO", async () => {
    vi.useFakeTimers()
    try {
      const url = `${ORIGIN}/api/clientes?page=1`
      const store = await sw.caches.open(API_CACHE_NAME)
      await store.put(
        url,
        jsonResponse({ data: ["stale"] }, { [CACHED_AT_HEADER]: String(Date.now() - 6 * 60 * 1000) })
      )
      // Ni resuelve ni rechaza: exactamente lo que hace un fetch sin salida.
      sw.setNetwork(() => new Promise<Response>(() => {}))

      const pendiente = sw.dispatchFetch("/api/clientes?page=1")
      await vi.advanceTimersByTimeAsync(30_000)

      expect(await (await pendiente)!.json()).toEqual({ data: ["stale"] })
    } finally {
      vi.useRealTimers()
    }
  })

  it("SW-12 — sin nada cacheado y la red colgada, se sigue esperando la respuesta (no hay copia que servir)", async () => {
    vi.useFakeTimers()
    try {
      let responder: ((value: Response) => void) | null = null
      sw.setNetwork(() => new Promise<Response>((resolve) => { responder = resolve }))

      const pendiente = sw.dispatchFetch("/api/clientes?page=1")
      await vi.advanceTimersByTimeAsync(30_000)
      // Recien ahora contesta la red: sin copia vencida, el presupuesto no puede
      // degradar el request a un 503 anticipado.
      responder!(jsonResponse({ data: ["network"] }))

      expect(await (await pendiente)!.json()).toEqual({ data: ["network"] })
    } finally {
      vi.useRealTimers()
    }
  })

  // Writing to the cache is a side effect of serving a request, never a
  // precondition for it. On a storage-tight phone `cache.put` rejects with
  // QuotaExceededError, and the two tests below pin that this can only cost the
  // user the *caching*, never the fresh answer they are online to receive.
  it("SW-9 — a failed cache write still returns the fresh network response, not a stale copy", async () => {
    const url = `${ORIGIN}/api/clientes?page=1`
    const store = await sw.caches.open(API_CACHE_NAME)
    await store.put(
      url,
      jsonResponse({ data: ["stale"] }, { [CACHED_AT_HEADER]: String(Date.now() - 6 * 60 * 1000) })
    )
    store.failPut = true
    sw.setNetwork(async () => jsonResponse({ data: ["network"] }))

    const res = await sw.dispatchFetch("/api/clientes?page=1")

    expect(await res!.json()).toEqual({ data: ["network"] })
  })

  it("SW-10 — a failed cache write with nothing cached does not degrade into the 503", async () => {
    const store = await sw.caches.open(API_CACHE_NAME)
    store.failPut = true
    sw.setNetwork(async () => jsonResponse({ data: ["network"] }))

    const res = await sw.dispatchFetch("/api/clientes?page=1")

    expect(res!.status).toBe(200)
    expect(await res!.json()).toEqual({ data: ["network"] })
  })

  it("SW-6 — activate drops the previous API cache, purging already-stored inventario entries", async () => {
    const legacy = await sw.caches.open("stapp-api-v2")
    await legacy.put(`${ORIGIN}/api/inventario/search`, jsonResponse([{ id: "leaked" }]))

    await sw.dispatchActivate()

    expect(await sw.caches.keys()).not.toContain("stapp-api-v2")
  })
})
