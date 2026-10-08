// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useEtiquetaSize } from "@/components/ordenes/use-etiqueta-size"
import { resetEtiquetaSizeCache } from "@/components/ordenes/etiqueta-size-org"

function jsonRes(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

describe("useEtiquetaSize", () => {
  beforeEach(() => {
    localStorage.clear()
    resetEtiquetaSizeCache()
  })
  afterEach(() => vi.unstubAllGlobals())

  it("arranca en el default y adopta el valor de la org al cargar", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes({ tamano: "58mm" })))
    const { result } = renderHook(() => useEtiquetaSize())
    expect(result.current.size).toBe("60x40")
    await waitFor(() => expect(result.current.size).toBe("58mm"))
  })

  it("cambiar el tamaño lo refleja al instante y lo guarda en la org", async () => {
    const f = vi.fn((_u: string, init?: RequestInit) =>
      init?.method === "PATCH" ? jsonRes({ tamano: "80mm" }) : jsonRes({ tamano: null }),
    )
    vi.stubGlobal("fetch", f)
    const { result } = renderHook(() => useEtiquetaSize())
    await waitFor(() => expect(f).toHaveBeenCalled())

    let ok = false
    await act(async () => {
      ok = await result.current.update("80mm")
    })

    expect(ok).toBe(true)
    expect(result.current.size).toBe("80mm")
    expect(f.mock.calls.some(([, i]) => i?.method === "PATCH")).toBe(true)
  })

  it("la respuesta tardía de la org no pisa lo que el usuario ya eligió", async () => {
    let release: (r: Response) => void = () => {}
    const f = vi.fn((_u: string, init?: RequestInit) =>
      init?.method === "PATCH"
        ? jsonRes({ tamano: "50x30" })
        : new Promise<Response>((r) => {
            release = r
          }),
    )
    vi.stubGlobal("fetch", f)
    const { result } = renderHook(() => useEtiquetaSize())

    await act(async () => {
      await result.current.update("50x30")
    })
    await act(async () => {
      release(new Response(JSON.stringify({ tamano: "80mm" })))
    })

    expect(result.current.size).toBe("50x30")
  })

  it("ready es false hasta que la org responde, y true después", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes({ tamano: "58mm" })))
    const { result } = renderHook(() => useEtiquetaSize())
    expect(result.current.ready).toBe(false)
    await waitFor(() => expect(result.current.ready).toBe(true))
  })

  it("ready pasa a true apenas el usuario elige, aunque la org no haya respondido", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_u: string, init?: RequestInit) =>
        init?.method === "PATCH" ? jsonRes({ tamano: "50x30" }) : new Promise<Response>(() => {}),
      ),
    )
    const { result } = renderHook(() => useEtiquetaSize())
    await act(async () => {
      await result.current.update("50x30")
    })
    expect(result.current.ready).toBe(true)
  })
})
