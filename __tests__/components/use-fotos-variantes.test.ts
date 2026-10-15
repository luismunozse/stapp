import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"

const comprimir = vi.hoisted(() => vi.fn())
vi.mock("@/lib/image-compression", () => ({ compressImage: comprimir }))

import { useFotosVariantes, type FilaParaFotos, type FotosVariantes } from "@/components/inventario/variantes/use-fotos-variantes"

const archivo = (nombre = "foto.jpg", tipo = "image/jpeg", tamano = 1000) => new File([new Uint8Array(tamano)], nombre, { type: tipo })
const grande = () => {
  const f = archivo("grande.jpg")
  Object.defineProperty(f, "size", { value: 5 * 1024 * 1024 + 1 })
  return f
}

interface Pedido {
  url: string
  metodo: string
  cuerpo: BodyInit | null | undefined
  resolver: (respuesta: { ok: boolean; status?: number; json?: unknown }) => void
  rechazar: (error: Error) => void
}

let pedidos: Pedido[]
let enVuelo: number
let maximoEnVuelo: number
let urls: string[]
let revocadas: string[]

const respuesta = (ok: boolean, json: unknown = {}) => ({ ok, status: ok ? 200 : 500, json: async () => json })

beforeEach(() => {
  pedidos = []
  enVuelo = 0
  maximoEnVuelo = 0
  urls = []
  revocadas = []
  comprimir.mockReset()
  comprimir.mockImplementation(async (f: File) => f)
  let n = 0
  vi.stubGlobal("URL", Object.assign(URL, {
    createObjectURL: vi.fn(() => {
      const u = `blob:previa-${++n}`
      urls.push(u)
      return u
    }),
    revokeObjectURL: vi.fn((u: string) => {
      revocadas.push(u)
    }),
  }))
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      enVuelo++
      maximoEnVuelo = Math.max(maximoEnVuelo, enVuelo)
      return new Promise((resolve, reject) => {
        pedidos.push({
          url,
          metodo: init?.method ?? "GET",
          cuerpo: init?.body,
          resolver: (r) => {
            enVuelo--
            resolve(respuesta(r.ok, r.json))
          },
          rechazar: (e) => {
            enVuelo--
            reject(e)
          },
        })
      })
    })
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const montar = () => renderHook(() => useFotosVariantes())
const fila = (id: string, over: Partial<FilaParaFotos> = {}): FilaParaFotos => ({ id, imagenUrl: null, archivar: false, ...over })

async function elegir(fotos: { current: FotosVariantes }, id: string, f: File = archivo()) {
  let r!: Awaited<ReturnType<FotosVariantes["elegir"]>>
  await act(async () => {
    r = await fotos.current.elegir(id, f)
  })
  return r
}

const vaciar = () => act(async () => { await Promise.resolve() })

describe("useFotosVariantes: choosing a photo", () => {
  it("rejects a file that is not JPG, PNG or WebP with a message and leaves the state unchanged", async () => {
    const { result } = montar()
    const r = await elegir(result, "a", archivo("a.gif", "image/gif"))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.mensaje).toMatch(/JPG, PNG o WebP/)
    expect(result.current.de("a").pendiente).toBeNull()
    expect(comprimir).not.toHaveBeenCalled()
    expect(urls).toEqual([])
    expect(result.current.idsConFotoPendiente()).toEqual([])
  })

  it("rejects a file over 5 MB with a message and leaves the state unchanged", async () => {
    const { result } = montar()
    const r = await elegir(result, "a", grande())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.mensaje).toMatch(/5 MB/)
    expect(result.current.de("a").pendiente).toBeNull()
    expect(comprimir).not.toHaveBeenCalled()
  })

  it("accepts exactly 5 MB", async () => {
    const { result } = montar()
    const f = archivo("justo.png", "image/png", 5 * 1024 * 1024)
    expect((await elegir(result, "a", f)).ok).toBe(true)
  })

  it("compresses an accepted file and shows the compressed one as pending", async () => {
    const comprimida = archivo("chica.jpg")
    comprimir.mockResolvedValueOnce(comprimida)
    const { result } = montar()
    const original = archivo("original.jpg", "image/jpeg", 4000)
    const r = await elegir(result, "a", original)
    expect(r.ok).toBe(true)
    expect(comprimir).toHaveBeenCalledWith(original)
    expect(URL.createObjectURL).toHaveBeenCalledWith(comprimida)
    expect(result.current.de("a")).toMatchObject({ pendiente: { previa: "blob:previa-1", estado: "pendiente" }, quitar: false })
  })

  it("answers with a message and keeps the state when compression throws", async () => {
    comprimir.mockRejectedValueOnce(new Error("boom"))
    const { result } = montar()
    const r = await elegir(result, "a")
    expect(r.ok).toBe(false)
    expect(result.current.de("a").pendiente).toBeNull()
  })

  it("accepts a WebP", async () => {
    const { result } = montar()
    expect((await elegir(result, "a", archivo("a.webp", "image/webp"))).ok).toBe(true)
  })

  it("choosing again revokes the previous preview", async () => {
    const { result } = montar()
    await elegir(result, "a")
    await elegir(result, "a")
    expect(revocadas).toEqual(["blob:previa-1"])
    expect(result.current.de("a").pendiente?.previa).toBe("blob:previa-2")
  })

  it("descartar drops the pending file and revokes its preview", async () => {
    const { result } = montar()
    await elegir(result, "a")
    act(() => result.current.descartar("a"))
    expect(result.current.de("a").pendiente).toBeNull()
    expect(revocadas).toEqual(["blob:previa-1"])
  })

  it("revokes every preview on unmount", async () => {
    const { result, unmount } = montar()
    await elegir(result, "a")
    await elegir(result, "b")
    unmount()
    expect(revocadas.sort()).toEqual(["blob:previa-1", "blob:previa-2"])
  })

  it("does not revoke anything twice", async () => {
    const { result, unmount } = montar()
    await elegir(result, "a")
    act(() => result.current.descartar("a"))
    unmount()
    expect(revocadas).toEqual(["blob:previa-1"])
  })
})

describe("useFotosVariantes: remove toggle", () => {
  it("alternarQuitar flips the mark", () => {
    const { result } = montar()
    act(() => result.current.alternarQuitar("a"))
    expect(result.current.de("a").quitar).toBe(true)
    act(() => result.current.alternarQuitar("a"))
    expect(result.current.de("a").quitar).toBe(false)
  })

  it("marking for removal discards a pending file; choosing a file clears the mark", async () => {
    const { result } = montar()
    await elegir(result, "a")
    act(() => result.current.alternarQuitar("a"))
    expect(result.current.de("a")).toMatchObject({ pendiente: null, quitar: true })
    expect(revocadas).toEqual(["blob:previa-1"])
    await elegir(result, "a")
    expect(result.current.de("a")).toMatchObject({ quitar: false })
    expect(result.current.de("a").pendiente).not.toBeNull()
  })

  it("an unknown id reads as empty", () => {
    const { result } = montar()
    expect(result.current.de("nada")).toEqual({ pendiente: null, quitar: false, subida: null, errorAlQuitar: null })
  })
})

describe("useFotosVariantes: idsConFotoPendiente", () => {
  it("returns ids only, never a File", async () => {
    const { result } = montar()
    await elegir(result, "a")
    await elegir(result, "b")
    act(() => result.current.alternarQuitar("c"))
    const ids = result.current.idsConFotoPendiente()
    expect(ids.sort()).toEqual(["a", "b"])
    expect(JSON.stringify(ids)).not.toMatch(/blob:|File/)
    expect(ids.every((i) => typeof i === "string")).toBe(true)
  })
})

describe("useFotosVariantes: upload", () => {
  it("POSTs the compressed file to the item's photo route", async () => {
    const comprimida = archivo("c.jpg")
    comprimir.mockResolvedValueOnce(comprimida)
    const { result } = montar()
    await elegir(result, "a")
    let fin!: Promise<unknown>
    act(() => {
      fin = result.current.subirTodas([fila("a")])
    })
    await vaciar()
    expect(pedidos).toHaveLength(1)
    expect(pedidos[0].url).toBe("/api/inventario/a/imagen")
    expect(pedidos[0].metodo).toBe("POST")
    expect((pedidos[0].cuerpo as FormData).get("file")).toBe(comprimida)
    await act(async () => {
      pedidos[0].resolver({ ok: true, json: { imagenUrl: "https://cdn/a.jpg" } })
      await fin
    })
    expect(result.current.de("a")).toMatchObject({ pendiente: null, subida: "https://cdn/a.jpg" })
    expect(revocadas).toEqual(["blob:previa-1"])
    expect(result.current.idsConFotoPendiente()).toEqual([])
  })

  it("never has more than 3 requests in flight for 5 pending files", async () => {
    const { result } = montar()
    const ids = ["a", "b", "c", "d", "e"]
    for (const id of ids) await elegir(result, id)
    let fin!: Promise<{ hechas: string[]; fallidas: string[] }>
    act(() => {
      fin = result.current.subirTodas(ids.map((i) => fila(i)))
    })
    await vaciar()
    expect(pedidos).toHaveLength(3)
    await act(async () => {
      pedidos[0].resolver({ ok: true, json: { imagenUrl: "u1" } })
    })
    await vaciar()
    expect(pedidos).toHaveLength(4)
    await act(async () => {
      pedidos[1].resolver({ ok: true, json: { imagenUrl: "u2" } })
      pedidos[2].resolver({ ok: true, json: { imagenUrl: "u3" } })
    })
    await vaciar()
    expect(pedidos).toHaveLength(5)
    let r!: { hechas: string[]; fallidas: string[] }
    await act(async () => {
      pedidos[3].resolver({ ok: true, json: { imagenUrl: "u4" } })
      pedidos[4].resolver({ ok: true, json: { imagenUrl: "u5" } })
      r = await fin
    })
    expect(maximoEnVuelo).toBe(3)
    expect(r.hechas.sort()).toEqual(ids)
    expect(r.fallidas).toEqual([])
  })

  it("isolates a failure: the others finish and the failed id keeps its file and a message", async () => {
    const { result } = montar()
    await elegir(result, "azul")
    await elegir(result, "rojo")
    let fin!: Promise<{ hechas: string[]; fallidas: string[] }>
    act(() => {
      fin = result.current.subirTodas([fila("azul"), fila("rojo")])
    })
    await vaciar()
    let r!: { hechas: string[]; fallidas: string[] }
    await act(async () => {
      pedidos[0].resolver({ ok: false, json: { error: "Error al subir imagen" } })
      pedidos[1].resolver({ ok: true, json: { imagenUrl: "u-rojo" } })
      r = await fin
    })
    expect(r).toEqual({ hechas: ["rojo"], fallidas: ["azul"] })
    expect(result.current.de("azul").pendiente).toMatchObject({ estado: "error", mensaje: "Error al subir imagen" })
    expect(result.current.de("rojo").subida).toBe("u-rojo")
    expect(result.current.idsConFotoPendiente()).toEqual(["azul"])
  })

  it("a network error is a failure with a message, not a throw", async () => {
    const { result } = montar()
    await elegir(result, "a")
    let fin!: Promise<{ hechas: string[]; fallidas: string[] }>
    act(() => {
      fin = result.current.subirTodas([fila("a")])
    })
    await vaciar()
    let r!: { hechas: string[]; fallidas: string[] }
    await act(async () => {
      pedidos[0].rechazar(new Error("offline"))
      r = await fin
    })
    expect(r.fallidas).toEqual(["a"])
    expect(result.current.de("a").pendiente?.estado).toBe("error")
    expect(result.current.de("a").pendiente?.mensaje).toBeTruthy()
  })

  it("marks a row as uploading while its request is open", async () => {
    const { result } = montar()
    await elegir(result, "a")
    act(() => {
      void result.current.subirTodas([fila("a")])
    })
    await vaciar()
    expect(result.current.de("a").pendiente?.estado).toBe("subiendo")
  })

  it("DELETEs only rows with a saved photo that were marked; POSTs pending; skips archived rows", async () => {
    const { result } = montar()
    await elegir(result, "nueva")
    await elegir(result, "archivada")
    act(() => result.current.alternarQuitar("con-foto"))
    act(() => result.current.alternarQuitar("sin-foto"))
    let fin!: Promise<{ hechas: string[]; fallidas: string[] }>
    act(() => {
      fin = result.current.subirTodas([
        fila("nueva"),
        fila("archivada", { archivar: true }),
        fila("con-foto", { imagenUrl: "https://cdn/x.jpg" }),
        fila("sin-foto"),
        fila("intacta", { imagenUrl: "https://cdn/y.jpg" }),
      ])
    })
    await vaciar()
    expect(pedidos.map((p) => `${p.metodo} ${p.url}`).sort()).toEqual([
      "DELETE /api/inventario/con-foto/imagen",
      "POST /api/inventario/nueva/imagen",
    ])
    let r!: { hechas: string[]; fallidas: string[] }
    await act(async () => {
      for (const p of pedidos) p.resolver({ ok: true, json: { imagenUrl: "u", success: true } })
      r = await fin
    })
    expect(r.hechas.sort()).toEqual(["con-foto", "nueva"])
    expect(result.current.de("con-foto")).toMatchObject({ quitar: false, subida: "" })
    // The archived row's file is untouched: nothing was sent for it.
    expect(result.current.de("archivada").pendiente?.estado).toBe("pendiente")
  })

  it("retrying one id sends only that id's request", async () => {
    const { result } = montar()
    await elegir(result, "azul")
    await elegir(result, "rojo")
    let fin!: Promise<unknown>
    act(() => {
      fin = result.current.subirTodas([fila("azul"), fila("rojo")])
    })
    await vaciar()
    await act(async () => {
      pedidos[0].resolver({ ok: false })
      pedidos[1].resolver({ ok: true, json: { imagenUrl: "u" } })
      await fin
    })
    expect(pedidos).toHaveLength(2)
    let reintento!: Promise<boolean>
    act(() => {
      reintento = result.current.reintentar(fila("azul"))
    })
    await vaciar()
    expect(pedidos).toHaveLength(3)
    expect(pedidos[2].url).toBe("/api/inventario/azul/imagen")
    await act(async () => {
      pedidos[2].resolver({ ok: true, json: { imagenUrl: "u-azul" } })
      expect(await reintento).toBe(true)
    })
    expect(result.current.de("azul").subida).toBe("u-azul")
    expect(result.current.idsConFotoPendiente()).toEqual([])
  })

  it("a failed removal keeps the mark and reports why, and a retry sends the DELETE again", async () => {
    const { result } = montar()
    act(() => result.current.alternarQuitar("a"))
    const f = fila("a", { imagenUrl: "https://cdn/a.jpg" })
    let fin!: Promise<{ hechas: string[]; fallidas: string[] }>
    act(() => {
      fin = result.current.subirTodas([f])
    })
    await vaciar()
    await act(async () => {
      pedidos[0].resolver({ ok: false, json: {} })
      expect((await fin).fallidas).toEqual(["a"])
    })
    expect(result.current.de("a")).toMatchObject({ quitar: true, errorAlQuitar: expect.stringMatching(/quitar/) })
    let reintento!: Promise<boolean>
    act(() => {
      reintento = result.current.reintentar(f)
    })
    await vaciar()
    expect(pedidos).toHaveLength(2)
    expect(pedidos[1].metodo).toBe("DELETE")
    await act(async () => {
      pedidos[1].resolver({ ok: true, json: { success: true } })
      expect(await reintento).toBe(true)
    })
    expect(result.current.de("a")).toMatchObject({ quitar: false, subida: "", errorAlQuitar: null })
  })

  it("retry of an id with nothing to send does nothing", async () => {
    const { result } = montar()
    await act(async () => {
      expect(await result.current.reintentar(fila("a"))).toBe(false)
    })
    expect(pedidos).toHaveLength(0)
  })
})
