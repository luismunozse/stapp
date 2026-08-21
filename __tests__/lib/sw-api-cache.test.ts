/**
 * Tests: public/sw.js API caching decisions.
 *
 * The service worker cache is shared by every session in the browser profile
 * and is keyed by URL alone — no cookie, no session, no role, no org. Anything
 * it stores can therefore be replayed to a *different* user of the same
 * terminal, and to the same user after a sucursal switch. These tests pin the
 * two rules that follow from that:
 *
 *  - responses that vary by identity (`/api/inventario/*`, `/api/clientes*`)
 *    are never stored and never served from the cache. Not "cleared later" —
 *    NOT STORED. Clearing is a race: it has to have finished before anything
 *    reads, and it cannot prove it ran;
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

/**
 * Ruta de fixture para el comportamiento generico del caché (TTL, offline,
 * presupuesto). A propósito NO es /api/clientes ni /api/inventario: esas dos
 * dependen de la identidad y no se cachean — ver los tests que lo fijan.
 */
const RUTA_CACHEABLE = "/api/tipos-dispositivo"

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

  /** Everything the SW handed to `event.waitUntil` during a fetch dispatch. */
  const waitUntilCalls: Array<Promise<unknown>> = []

  return {
    caches: cacheStorage,
    waitUntilCalls,
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
        waitUntil: (value: Promise<unknown>) => {
          waitUntilCalls.push(value)
          return value
        },
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

  // Las dos familias que dependen de la identidad. No se cachean, punto: la
  // alternativa (cachear y limpiar cuando cambia la sesion) es una carrera por
  // construccion — tiene que haber TERMINADO antes de que algo lea, y no puede
  // demostrar que corrio. El costo aceptado es que no hay catalogo offline.
  it.each([
    ["/api/inventario/search?q=&scope=venta", "el stock y precioCompra dependen del rol y la sucursal"],
    ["/api/clientes?page=1", "la lista de clientes es de UNA org"],
    ["/api/clientes/cli-1/deuda-sucursal", "corre sucursalParaLectura"],
    ["/api/clientes/cli-1/ordenes-pendientes", "corre sucursalParaLectura"],
  ])("SW-1 — nunca guarda %s (%s)", async (ruta) => {
    sw.setNetwork(async () => jsonResponse([{ id: "p1", precioCompra: 100 }]))

    const res = await sw.dispatchFetch(ruta)

    expect(res!.status).toBe(200)
    expect(await sw.caches.match(`${ORIGIN}${ruta}`)).toBeUndefined()
  })

  it.each([
    "/api/inventario/search?q=&scope=venta",
    "/api/clientes?page=1",
  ])("SW-2 — nunca sirve una entrada guardada de %s a una sesion posterior", async (ruta) => {
    // Simula lo que dejo el ADMIN de la org 1 (o la sucursal anterior) y que el
    // VENDEDOR de la org 2 en el mismo mostrador NO puede recibir.
    const store = await sw.caches.open(API_CACHE_NAME)
    // Recien sellada a proposito: el TTL no puede ser lo que nos salve.
    await store.put(
      `${ORIGIN}${ruta}`,
      jsonResponse([{ id: "filtrado", precioCompra: 100 }], { [CACHED_AT_HEADER]: String(Date.now()) })
    )
    sw.setNetwork(async () => jsonResponse([{ id: "fresco" }]))

    const res = await sw.dispatchFetch(ruta)

    expect(await res!.json()).toEqual([{ id: "fresco" }])
  })

  it("SW-3 — org-wide routes keep stale-while-revalidate (offline PWA is deliberate)", async () => {
    const url = `${ORIGIN}${RUTA_CACHEABLE}`
    const store = await sw.caches.open(API_CACHE_NAME)
    await store.put(
      url,
      jsonResponse({ data: ["cached"] }, { [CACHED_AT_HEADER]: String(Date.now()) })
    )
    sw.setNetwork(async () => jsonResponse({ data: ["network"] }))

    const res = await sw.dispatchFetch(RUTA_CACHEABLE)

    expect(await res!.json()).toEqual({ data: ["cached"] })
  })

  it("SW-4 — a cached entry older than API_CACHE_TTL is not served while online", async () => {
    const url = `${ORIGIN}${RUTA_CACHEABLE}`
    const store = await sw.caches.open(API_CACHE_NAME)
    await store.put(
      url,
      jsonResponse({ data: ["stale"] }, { [CACHED_AT_HEADER]: String(Date.now() - 6 * 60 * 1000) })
    )
    sw.setNetwork(async () => jsonResponse({ data: ["network"] }))

    const res = await sw.dispatchFetch(RUTA_CACHEABLE)

    expect(await res!.json()).toEqual({ data: ["network"] })
  })

  it("SW-5 — an expired entry is still served when the network is unreachable", async () => {
    const url = `${ORIGIN}${RUTA_CACHEABLE}`
    const store = await sw.caches.open(API_CACHE_NAME)
    await store.put(
      url,
      jsonResponse({ data: ["stale"] }, { [CACHED_AT_HEADER]: String(Date.now() - 6 * 60 * 1000) })
    )
    sw.setNetwork(async () => {
      throw new Error("offline")
    })

    const res = await sw.dispatchFetch(RUTA_CACHEABLE)

    expect(await res!.json()).toEqual({ data: ["stale"] })
  })

  // A half-connected link — captive portal, dead cell, the normal state of a
  // shop counter — is NOT the offline case: `fetch` neither answers nor rejects,
  // it hangs for the OS connect timeout. Waiting that out before falling back to
  // a usable stale copy is the failure mode offline tests cannot catch, so the
  // network gets a short budget and the cached copy wins once it runs out.
  it("SW-11 — con la red colgada, una entrada vencida se sirve sin esperar el timeout del SO", async () => {
    vi.useFakeTimers()
    try {
      const url = `${ORIGIN}${RUTA_CACHEABLE}`
      const store = await sw.caches.open(API_CACHE_NAME)
      await store.put(
        url,
        jsonResponse({ data: ["stale"] }, { [CACHED_AT_HEADER]: String(Date.now() - 6 * 60 * 1000) })
      )
      // Ni resuelve ni rechaza: exactamente lo que hace un fetch sin salida.
      sw.setNetwork(() => new Promise<Response>(() => {}))

      const pendiente = sw.dispatchFetch(RUTA_CACHEABLE)
      await vi.advanceTimersByTimeAsync(30_000)

      expect(await (await pendiente)!.json()).toEqual({ data: ["stale"] })
    } finally {
      vi.useRealTimers()
    }
  })

  it("SW-13 — la revalidacion abandonada se registra con waitUntil y termina guardando", async () => {
    // Dejar de esperar la revalidacion no es lo mismo que renunciar a ella:
    // servida la respuesta, el navegador puede matar el worker en cualquier
    // momento. Sin waitUntil el cache.put nunca corre y, en un enlace a medias,
    // cada request paga el presupuesto y vuelve a servir la MISMA copia vencida
    // para siempre — justo el caso para el que se agrego el presupuesto.
    vi.useFakeTimers()
    try {
      const url = `${ORIGIN}${RUTA_CACHEABLE}`
      const store = await sw.caches.open(API_CACHE_NAME)
      await store.put(
        url,
        jsonResponse({ data: ["stale"] }, { [CACHED_AT_HEADER]: String(Date.now() - 6 * 60 * 1000) })
      )
      let responder: ((value: Response) => void) | null = null
      sw.setNetwork(() => new Promise<Response>((resolve) => { responder = resolve }))

      const pendiente = sw.dispatchFetch(RUTA_CACHEABLE)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(await (await pendiente)!.json()).toEqual({ data: ["stale"] })

      expect(sw.waitUntilCalls.length).toBeGreaterThan(0)

      // La red contesta tarde: el trabajo registrado tiene que dejar la fresca.
      responder!(jsonResponse({ data: ["fresh"] }))
      await Promise.all(sw.waitUntilCalls)

      const guardada = await sw.caches.match(url)
      expect(await guardada!.json()).toEqual({ data: ["fresh"] })
    } finally {
      vi.useRealTimers()
    }
  })

  it("SW-12 — sin nada cacheado y la red colgada, se sigue esperando la respuesta (no hay copia que servir)", async () => {
    vi.useFakeTimers()
    try {
      let responder: ((value: Response) => void) | null = null
      sw.setNetwork(() => new Promise<Response>((resolve) => { responder = resolve }))

      const pendiente = sw.dispatchFetch(RUTA_CACHEABLE)
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
    const url = `${ORIGIN}${RUTA_CACHEABLE}`
    const store = await sw.caches.open(API_CACHE_NAME)
    await store.put(
      url,
      jsonResponse({ data: ["stale"] }, { [CACHED_AT_HEADER]: String(Date.now() - 6 * 60 * 1000) })
    )
    store.failPut = true
    sw.setNetwork(async () => jsonResponse({ data: ["network"] }))

    const res = await sw.dispatchFetch(RUTA_CACHEABLE)

    expect(await res!.json()).toEqual({ data: ["network"] })
  })

  it("SW-10 — a failed cache write with nothing cached does not degrade into the 503", async () => {
    const store = await sw.caches.open(API_CACHE_NAME)
    store.failPut = true
    sw.setNetwork(async () => jsonResponse({ data: ["network"] }))

    const res = await sw.dispatchFetch(RUTA_CACHEABLE)

    expect(res!.status).toBe(200)
    expect(await res!.json()).toEqual({ data: ["network"] })
  })

  it("SW-6 — activate drops every previous API cache, so entries from a permissive rule do not survive", async () => {
    // Los caches viejos guardaron /api/clientes y /api/inventario cuando la
    // regla lo permitia. Renombrar es lo unico que los saca de encima al
    // actualizar: en el equipo del mostrador esas entradas son de otra sesion.
    for (const vieja of ["stapp-api-v2", "stapp-api-v3", "stapp-api-v4"]) {
      const legacy = await sw.caches.open(vieja)
      await legacy.put(`${ORIGIN}/api/inventario/search`, jsonResponse([{ id: "leaked" }]))
    }
    await sw.caches.open(API_CACHE_NAME)

    await sw.dispatchActivate()

    expect(await sw.caches.keys()).not.toContain("stapp-api-v2")
    expect(await sw.caches.keys()).not.toContain("stapp-api-v3")
    expect(await sw.caches.keys()).not.toContain("stapp-api-v4")
    expect(await sw.caches.keys()).toContain(API_CACHE_NAME)
  })
})
