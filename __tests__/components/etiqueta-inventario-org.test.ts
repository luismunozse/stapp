// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  fetchOrgEtiquetaInventario,
  saveOrgEtiquetaInventario,
} from "@/lib/labels/etiqueta-inventario-org"
import { LABEL_PREFS_KEY } from "@/lib/labels/label-prefs"

function jsonRes(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

describe("fetchOrgEtiquetaInventario", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("devuelve el par configurado en la org", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes({ medio: "sheet", tamano: "40x30" })))
    expect(await fetchOrgEtiquetaInventario()).toEqual({ medio: "sheet", tamano: "40x30" })
  })

  it("devuelve null cuando la org no configuró nada", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes({ medio: null, tamano: null })))
    expect(await fetchOrgEtiquetaInventario()).toBeNull()
  })

  it("un par inválido o incompatible cuenta como sin configurar", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes({ medio: "sheet", tamano: "58mm" })))
    expect(await fetchOrgEtiquetaInventario()).toBeNull()
  })

  it("devuelve undefined si la API falla (500) o la red cae", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes({ error: "x" }, 500)))
    expect(await fetchOrgEtiquetaInventario()).toBeUndefined()
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))))
    expect(await fetchOrgEtiquetaInventario()).toBeUndefined()
  })

  it("un fetch colgado se corta a los 3s y devuelve undefined", async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})))
      const p = fetchOrgEtiquetaInventario()
      await vi.advanceTimersByTimeAsync(3100)
      expect(await p).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("saveOrgEtiquetaInventario", () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.unstubAllGlobals())

  const prefs = { medium: "sheet", thermalSize: "58mm", sheetSize: "40x30" } as const

  it("hace PATCH con el medio activo y su tamaño, y guarda también en localStorage", async () => {
    const f = vi.fn((_u: string, _i?: RequestInit) => jsonRes({ medio: "sheet", tamano: "40x30" }))
    vi.stubGlobal("fetch", f)

    expect(await saveOrgEtiquetaInventario(prefs)).toBe(true)

    const [url, init] = f.mock.calls[0]
    expect(url).toBe("/api/configuracion/etiqueta-inventario")
    expect(init?.method).toBe("PATCH")
    expect(JSON.parse(init?.body as string)).toEqual({ medio: "sheet", tamano: "40x30" })
    expect(JSON.parse(localStorage.getItem(LABEL_PREFS_KEY)!)).toEqual(prefs)
  })

  it("si el PATCH falla devuelve false pero deja el valor en localStorage", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes({ code: "COLUMNA_NO_DISPONIBLE" }, 503)))
    expect(await saveOrgEtiquetaInventario(prefs)).toBe(false)
    expect(JSON.parse(localStorage.getItem(LABEL_PREFS_KEY)!)).toEqual(prefs)
  })

  it("si la red cae devuelve false sin tirar", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))))
    expect(await saveOrgEtiquetaInventario(prefs)).toBe(false)
  })
})
