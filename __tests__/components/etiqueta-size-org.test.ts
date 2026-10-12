// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  resolveEtiquetaSize,
  saveOrgEtiquetaSize,
  resetEtiquetaSizeCache,
} from "@/components/ordenes/etiqueta-size-org"
import { DEFAULT_LABEL_SIZE } from "@/lib/etiqueta-tamano"

function jsonRes(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

describe("resolveEtiquetaSize: org, luego localStorage, luego default", () => {
  beforeEach(() => {
    localStorage.clear()
    resetEtiquetaSizeCache()
  })
  afterEach(() => vi.unstubAllGlobals())

  it("prioriza el valor de la org sobre localStorage", async () => {
    localStorage.setItem("stapp:etiqueta-size", "80mm")
    vi.stubGlobal("fetch", vi.fn(() => jsonRes({ tamano: "50x30" })))
    expect(await resolveEtiquetaSize()).toBe("50x30")
  })

  it("sin valor en la org usa el localStorage legado", async () => {
    localStorage.setItem("stapp:etiqueta-size", "58mm")
    vi.stubGlobal("fetch", vi.fn(() => jsonRes({ tamano: null })))
    expect(await resolveEtiquetaSize()).toBe("58mm")
  })

  it("sin org ni localStorage usa el default", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes({ tamano: null })))
    expect(await resolveEtiquetaSize()).toBe(DEFAULT_LABEL_SIZE)
  })

  it("si la API falla (403, 500 o red caída) cae al localStorage sin tirar", async () => {
    localStorage.setItem("stapp:etiqueta-size", "40x30")
    vi.stubGlobal("fetch", vi.fn(() => jsonRes({ error: "x" }, 500)))
    expect(await resolveEtiquetaSize()).toBe("40x30")
    resetEtiquetaSizeCache()
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))))
    expect(await resolveEtiquetaSize()).toBe("40x30")
  })

  it("un valor inválido de la API se ignora", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes({ tamano: "99x99" })))
    expect(await resolveEtiquetaSize()).toBe(DEFAULT_LABEL_SIZE)
  })

  it("cachea una respuesta buena: la segunda llamada no vuelve a la red", async () => {
    const f = vi.fn(() => jsonRes({ tamano: "50x40" }))
    vi.stubGlobal("fetch", f)
    await resolveEtiquetaSize()
    await resolveEtiquetaSize()
    expect(f).toHaveBeenCalledTimes(1)
  })

  it("NO cachea un fallo: reintenta en la próxima impresión", async () => {
    const f = vi
      .fn()
      .mockImplementationOnce(() => jsonRes({ error: "x" }, 500))
      .mockImplementation(() => jsonRes({ tamano: "50x40" }))
    vi.stubGlobal("fetch", f)
    expect(await resolveEtiquetaSize()).toBe(DEFAULT_LABEL_SIZE)
    expect(await resolveEtiquetaSize()).toBe("50x40")
  })
})

describe("saveOrgEtiquetaSize", () => {
  beforeEach(() => {
    localStorage.clear()
    resetEtiquetaSizeCache()
  })
  afterEach(() => vi.unstubAllGlobals())

  it("guarda en la org (PATCH) y también en localStorage", async () => {
    const f = vi.fn(() => jsonRes({ tamano: "58mm" }))
    vi.stubGlobal("fetch", f)

    expect(await saveOrgEtiquetaSize("58mm")).toBe(true)

    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("/api/configuracion/etiqueta")
    expect(init.method).toBe("PATCH")
    expect(JSON.parse(init.body as string)).toEqual({ tamano: "58mm" })
    expect(localStorage.getItem("stapp:etiqueta-size")).toBe("58mm")
  })

  it("el valor recién guardado se usa al imprimir sin volver a pedirlo", async () => {
    const f = vi.fn(() => jsonRes({ tamano: "58mm" }))
    vi.stubGlobal("fetch", f)
    await saveOrgEtiquetaSize("58mm")
    f.mockClear()
    expect(await resolveEtiquetaSize()).toBe("58mm")
    expect(f).not.toHaveBeenCalled()
  })

  it("si el servidor rechaza (503 sin migración) devuelve false pero deja el localStorage", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes({ error: "x", code: "COLUMNA_NO_DISPONIBLE" }, 503)))
    expect(await saveOrgEtiquetaSize("80mm")).toBe(false)
    expect(localStorage.getItem("stapp:etiqueta-size")).toBe("80mm")
    // y como la org no lo guardó, resolver cae al localStorage
    vi.stubGlobal("fetch", vi.fn(() => jsonRes({ tamano: null })))
    expect(await resolveEtiquetaSize()).toBe("80mm")
  })

  it("si la red cae devuelve false sin tirar", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))))
    expect(await saveOrgEtiquetaSize("80mm")).toBe(false)
  })
})

describe("resolveEtiquetaSize: robustez", () => {
  beforeEach(() => {
    localStorage.clear()
    resetEtiquetaSizeCache()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("un fetch colgado no bloquea: a los 3s cae al localStorage", async () => {
    vi.useFakeTimers()
    localStorage.setItem("stapp:etiqueta-size", "58mm")
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})))

    const p = resolveEtiquetaSize()
    await vi.advanceTimersByTimeAsync(3100)

    expect(await p).toBe("58mm")
  })

  it("un guardado gana sobre un GET que arrancó antes y responde después", async () => {
    let releaseGet: (r: Response) => void = () => {}
    const f = vi.fn((_u: string, init?: RequestInit) =>
      init?.method === "PATCH"
        ? jsonRes({ tamano: "50x30" })
        : new Promise<Response>((r) => {
            releaseGet = r
          }),
    )
    vi.stubGlobal("fetch", f)

    const viejo = resolveEtiquetaSize()
    expect(await saveOrgEtiquetaSize("50x30")).toBe(true)
    releaseGet(new Response(JSON.stringify({ tamano: "80mm" })))
    await viejo

    f.mockClear()
    expect(await resolveEtiquetaSize()).toBe("50x30")
    expect(f).not.toHaveBeenCalled()
  })

  it("el valor cacheado de la org vence a los 60s y se vuelve a pedir", async () => {
    vi.useFakeTimers()
    const f = vi.fn(() => jsonRes({ tamano: "50x40" }))
    vi.stubGlobal("fetch", f)
    await resolveEtiquetaSize()
    await vi.advanceTimersByTimeAsync(61_000)
    await resolveEtiquetaSize()
    expect(f).toHaveBeenCalledTimes(2)
  })

  it("si el PATCH falla, este equipo usa igual el tamaño elegido (todos los callers)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes({ tamano: "80mm" })))
    await resolveEtiquetaSize() // la org tenía 80mm cacheado
    vi.stubGlobal("fetch", vi.fn(() => jsonRes({ error: "x" }, 503)))

    expect(await saveOrgEtiquetaSize("40x30")).toBe(false)

    const f = vi.fn(() => jsonRes({ tamano: "80mm" }))
    vi.stubGlobal("fetch", f)
    expect(await resolveEtiquetaSize()).toBe("40x30")
    expect(f).not.toHaveBeenCalled()
  })
})
