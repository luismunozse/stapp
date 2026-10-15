import { afterEach, describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { useVariantesForm } from "@/components/inventario/variantes/use-variantes-form"
import type { Inventario } from "@/types"

const item = { id: "r1", codigo: "FX-ROJO", grupoId: "g1" } as unknown as Inventario
const lectura = {
  grupo: { id: "g1", nombre: "Funda X", opciones: [{ nombre: "Color", valores: ["Rojo"] }] },
  variantes: [{ id: "r1", atributos: [{ opcion: "Color", valor: "Rojo" }], codigo: "FX-ROJO", precioVenta: 10, stock: 1 }],
  archivadas: [],
}

const parametros = (alHidratar: () => void) => ({
  permite: true,
  item,
  costoCargado: true,
  codigoBase: "FX",
  precioBase: 10,
  costoBase: 0,
  esKit: false,
  alHidratar,
})

describe("useVariantesForm: reading the group", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("hydrates once the answer arrives", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => lectura }) as Response))
    const alHidratar = vi.fn()
    const { result } = renderHook(() => useVariantesForm(parametros(alHidratar)))
    await waitFor(() => expect(result.current.agrupado).toBe(true))
    expect(alHidratar).toHaveBeenCalledTimes(1)
  })

  it("an answer that arrives after the form closed changes nothing and notifies nobody", async () => {
    let responder: (r: Response) => void = () => {}
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolver) => (responder = resolver))))
    const alHidratar = vi.fn()
    const { unmount } = renderHook(() => useVariantesForm(parametros(alHidratar)))
    unmount()
    responder({ ok: true, status: 200, json: async () => lectura } as Response)
    await new Promise((r) => setTimeout(r, 20))
    expect(alHidratar).not.toHaveBeenCalled()
  })

  it("aborts the request when the form closes", async () => {
    const senales: AbortSignal[] = []
    vi.stubGlobal("fetch", vi.fn((_u: unknown, init?: RequestInit) => {
      if (init?.signal) senales.push(init.signal)
      return new Promise<Response>(() => {})
    }))
    const { unmount } = renderHook(() => useVariantesForm(parametros(vi.fn())))
    expect(senales).toHaveLength(1)
    expect(senales[0].aborted).toBe(false)
    unmount()
    expect(senales[0].aborted).toBe(true)
  })
})
