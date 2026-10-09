// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useEtiquetaInventario } from "@/components/inventario/use-etiqueta-inventario"
import * as etiquetaSizeOrg from "@/components/ordenes/etiqueta-size-org"
import { resetEtiquetaSizeCache } from "@/components/ordenes/etiqueta-size-org"
import { LABEL_PREFS_KEY } from "@/lib/labels/label-prefs"

const INV = "/api/configuracion/etiqueta-inventario"
const ORD = "/api/configuracion/etiqueta"

function jsonRes(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

interface Respuestas {
  inv?: unknown
  ord?: unknown
  invStatus?: number
  patch?: unknown
  patchStatus?: number
}

/** fetch falso por URL: GET inventario, GET orden y PATCH inventario. */
function stubFetch(r: Respuestas = {}) {
  const f = vi.fn((url: string, init?: RequestInit) => {
    if (url === INV && init?.method === "PATCH") return jsonRes(r.patch ?? {}, r.patchStatus ?? 200)
    if (url === INV) return jsonRes(r.inv ?? { medio: null, tamano: null }, r.invStatus ?? 200)
    if (url === ORD) return jsonRes(r.ord ?? { tamano: null })
    return jsonRes({}, 404)
  })
  vi.stubGlobal("fetch", f)
  return f
}

const patches = (f: ReturnType<typeof stubFetch>) =>
  f.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === "PATCH")

describe("useEtiquetaInventario: orden de resolución", () => {
  beforeEach(() => {
    localStorage.clear()
    resetEtiquetaSizeCache()
  })
  afterEach(() => vi.unstubAllGlobals())

  it("1. la org gana sobre el localStorage del equipo", async () => {
    localStorage.setItem(
      LABEL_PREFS_KEY,
      JSON.stringify({ medium: "thermal", thermalSize: "80mm", sheetSize: "50x30" }),
    )
    stubFetch({ inv: { medio: "sheet", tamano: "40x30" } })
    const { result } = renderHook(() => useEtiquetaInventario())

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.medium).toBe("sheet")
    expect(result.current.sheetSize).toBe("40x30")
    // El otro tamaño sale del localStorage.
    expect(result.current.thermalSize).toBe("80mm")
    expect(result.current.size).toBe("40x30")
  })

  it("org térmica + tamaño: thermalSize es el de la org y sheetSize el default", async () => {
    stubFetch({ inv: { medio: "thermal", tamano: "58mm" } })
    const { result } = renderHook(() => useEtiquetaInventario())
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.medium).toBe("thermal")
    expect(result.current.thermalSize).toBe("58mm")
    expect(result.current.sheetSize).toBe("50x30")
  })

  it("2. sin valor en la org usa el localStorage del equipo", async () => {
    localStorage.setItem(
      LABEL_PREFS_KEY,
      JSON.stringify({ medium: "sheet", thermalSize: "50x30", sheetSize: "38x25" }),
    )
    stubFetch({ ord: { tamano: "80mm" } })
    const { result } = renderHook(() => useEtiquetaInventario())
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.medium).toBe("sheet")
    expect(result.current.sheetSize).toBe("38x25")
  })

  it("3. sin org ni localStorage usa el tamaño de la etiqueta de órdenes, en térmica", async () => {
    stubFetch({ ord: { tamano: "60x40" } })
    const { result } = renderHook(() => useEtiquetaInventario())
    await waitFor(() => expect(result.current.thermalSize).toBe("60x40"))
    expect(result.current.medium).toBe("thermal")
    expect(result.current.ready).toBe(true)
  })

  it("4. sin nada configurado queda en térmica 50x30", async () => {
    stubFetch()
    const { result } = renderHook(() => useEtiquetaInventario())
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.medium).toBe("thermal")
    expect(result.current.thermalSize).toBe("50x30")
    expect(result.current.sheetSize).toBe("50x30")
  })

  it("si la API de la org falla cae al localStorage sin tirar", async () => {
    localStorage.setItem(
      LABEL_PREFS_KEY,
      JSON.stringify({ medium: "thermal", thermalSize: "40x30", sheetSize: "50x30" }),
    )
    stubFetch({ invStatus: 500 })
    const { result } = renderHook(() => useEtiquetaInventario())
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.thermalSize).toBe("40x30")
  })

  it("pide la org y el tamaño de órdenes en paralelo desde el arranque", async () => {
    const urls: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        urls.push(url)
        return new Promise<Response>(() => {})
      }),
    )
    renderHook(() => useEtiquetaInventario())
    await waitFor(() => expect(urls).toContain(INV))
    expect(urls).toContain(ORD)
  })

  it("con org Y tamaño de órdenes resueltos, gana la org", async () => {
    stubFetch({ inv: { medio: "sheet", tamano: "40x30" }, ord: { tamano: "80mm" } })
    const { result } = renderHook(() => useEtiquetaInventario())
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.medium).toBe("sheet")
    expect(result.current.sheetSize).toBe("40x30")
    expect(result.current.thermalSize).toBe("50x30")
  })

  it("si un fetch rechaza, ready igual pasa a true y cae al localStorage", async () => {
    localStorage.setItem(
      LABEL_PREFS_KEY,
      JSON.stringify({ medium: "thermal", thermalSize: "40x30", sheetSize: "50x30" }),
    )
    stubFetch()
    // Un fetch que rechaza no alcanza: fetchOrgEtiquetaSize lo atrapa adentro.
    // Lo que tiene que cubrir el hook es que la función misma rechace.
    const spy = vi
      .spyOn(etiquetaSizeOrg, "fetchOrgEtiquetaSize")
      .mockRejectedValue(new Error("boom"))
    try {
      const { result } = renderHook(() => useEtiquetaInventario())
      await waitFor(() => expect(result.current.ready).toBe(true))
      expect(result.current.thermalSize).toBe("40x30")
    } finally {
      spy.mockRestore()
    }
  })

  it("resolver el valor de la org NO dispara ningún PATCH", async () => {
    const f = stubFetch({ inv: { medio: "sheet", tamano: "40x30" } })
    const { result } = renderHook(() => useEtiquetaInventario())
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(patches(f)).toHaveLength(0)
  })

  it("una respuesta tardía de la org no pisa lo que el operador ya eligió", async () => {
    let release: (r: Response) => void = () => {}
    const f = vi.fn((url: string, init?: RequestInit) => {
      if (url === INV && init?.method === "PATCH") return jsonRes({})
      if (url === INV) return new Promise<Response>((r) => (release = r))
      return jsonRes({ tamano: null })
    })
    vi.stubGlobal("fetch", f)
    const { result } = renderHook(() => useEtiquetaInventario())

    await act(async () => {
      result.current.onSizeChange("60x40")
    })
    await act(async () => {
      release(new Response(JSON.stringify({ medio: "sheet", tamano: "40x30" })))
    })

    expect(result.current.medium).toBe("thermal")
    expect(result.current.thermalSize).toBe("60x40")
  })
})

describe("useEtiquetaInventario: guardar", () => {
  beforeEach(() => {
    localStorage.clear()
    resetEtiquetaSizeCache()
  })
  afterEach(() => vi.unstubAllGlobals())

  it("cambiar el tamaño lo refleja al instante y guarda el par activo en la org", async () => {
    const f = stubFetch()
    const { result } = renderHook(() => useEtiquetaInventario())
    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      result.current.onSizeChange("58mm")
    })

    expect(result.current.thermalSize).toBe("58mm")
    expect(patches(f)).toHaveLength(1)
    expect(JSON.parse(patches(f)[0][1]!.body as string)).toEqual({ medio: "thermal", tamano: "58mm" })
  })

  it("cambiar a hoja guarda el tamaño de hoja, no el del rollo", async () => {
    const f = stubFetch({ inv: { medio: "thermal", tamano: "80mm" } })
    const { result } = renderHook(() => useEtiquetaInventario())
    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      result.current.onMediumChange("sheet")
    })

    expect(result.current.medium).toBe("sheet")
    expect(JSON.parse(patches(f)[0][1]!.body as string)).toEqual({ medio: "sheet", tamano: "50x30" })
  })

  it("si el guardado en la org falla avisa y deja el valor local", async () => {
    stubFetch({ patchStatus: 503 })
    const onSaveFailed = vi.fn()
    const { result } = renderHook(() => useEtiquetaInventario({ onSaveFailed }))
    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      result.current.onSizeChange("40x30")
    })

    await waitFor(() => expect(onSaveFailed).toHaveBeenCalledTimes(1))
    expect(result.current.thermalSize).toBe("40x30")
    expect(JSON.parse(localStorage.getItem(LABEL_PREFS_KEY)!).thermalSize).toBe("40x30")
  })

  it("si TODOS los guardados fallan avisa una sola vez", async () => {
    stubFetch({ patchStatus: 503 })
    const onSaveFailed = vi.fn()
    const { result } = renderHook(() => useEtiquetaInventario({ onSaveFailed }))
    await waitFor(() => expect(result.current.ready).toBe(true))
    await act(async () => {
      result.current.onSizeChange("40x30")
    })
    await waitFor(() => expect(onSaveFailed).toHaveBeenCalledTimes(1))
    await act(async () => {
      result.current.onSizeChange("60x40")
    })
    await act(async () => {
      result.current.onMediumChange("sheet")
    })
    await new Promise((r) => setTimeout(r, 30))
    expect(onSaveFailed).toHaveBeenCalledTimes(1)
  })

  it("si el guardado anda no avisa nada", async () => {
    stubFetch()
    const onSaveFailed = vi.fn()
    const { result } = renderHook(() => useEtiquetaInventario({ onSaveFailed }))
    await waitFor(() => expect(result.current.ready).toBe(true))
    await act(async () => {
      result.current.onSizeChange("40x30")
    })
    expect(onSaveFailed).not.toHaveBeenCalled()
  })
})

describe("useEtiquetaInventario: eco de Radix Select", () => {
  beforeEach(() => {
    localStorage.clear()
    resetEtiquetaSizeCache()
  })
  afterEach(() => vi.unstubAllGlobals())

  it("un '' del select oculto se ignora: no borra el campo ni guarda nada", async () => {
    const f = stubFetch({ inv: { medio: "thermal", tamano: "60x40" } })
    const { result } = renderHook(() => useEtiquetaInventario())
    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      result.current.onSizeChange("")
      result.current.onMediumChange("")
    })

    expect(result.current.thermalSize).toBe("60x40")
    expect(result.current.medium).toBe("thermal")
    expect(patches(f)).toHaveLength(0)
  })

  it("un valor que no está en la lista válida se ignora", async () => {
    const f = stubFetch()
    const { result } = renderHook(() => useEtiquetaInventario())
    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      result.current.onSizeChange("99x99")
      result.current.onMediumChange("laser")
    })

    expect(result.current.thermalSize).toBe("50x30")
    expect(patches(f)).toHaveLength(0)
  })

  it("en hoja, un rollo (58mm) no es un tamaño válido y se ignora", async () => {
    const f = stubFetch({ inv: { medio: "sheet", tamano: "40x30" } })
    const { result } = renderHook(() => useEtiquetaInventario())
    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      result.current.onSizeChange("58mm")
    })

    expect(result.current.sheetSize).toBe("40x30")
    expect(patches(f)).toHaveLength(0)
  })

  it("la resolución asíncrona de la org no guarda ni borra nada", async () => {
    const f = stubFetch({ inv: { medio: "sheet", tamano: "38x25" } })
    const { result } = renderHook(() => useEtiquetaInventario())
    await waitFor(() => expect(result.current.sheetSize).toBe("38x25"))
    // Eco típico: Radix reemite "" tras setear el valor desde afuera.
    await act(async () => {
      result.current.onSizeChange("")
    })
    expect(result.current.sheetSize).toBe("38x25")
    expect(patches(f)).toHaveLength(0)
  })
})
